// Rotation-first daily timetable generator for the pilot hub.
//
// Ops builds the schedule FROM the fleet: every active (not grounded / not on a
// maintenance hold) aircraft is flown a connected rotation for the day — a
// chain of sectors where each leg departs the airport the previous leg landed
// at, with a turnaround in between. That yields exactly the way tails are
// rostered in real life, e.g.
//
//   VH-A5A   06:00 BNE-MEL   08:00 MEL-ADL   10:30 ADL-SYD   13:00 SYD-BNE
//
// Narrow-bodies fly up to 6 sectors a day; the 787 flies a single long-haul
// route (occasionally an out-and-back), never more than 2. A grounded aircraft
// is simply not given a rotation, so it gets no flights until it's back in
// service. Routes disappear 30 minutes before departure; flights already in a
// pilot's timetable are never deleted (that would wipe their logbook).

import { db, flightsTable, timetableTable, aircraftTable, inArray, eq, type InsertFlight } from "@workspace/db";
import { logger } from "./logger";
import { ROUTE_PAIRS, AIRPORT_TZ } from "../data/jetstar-network";

// Default fleet used only when no live fleet is supplied (unit tests). Mirrors
// the seeded registrations so default assignments reference real tails.
export const DEFAULT_FLEET: Record<string, string[]> = {
  A320: "ABCDEFGHJKLMNP".split("").map((l) => `VH-VG${l}`),
  A321: ["VH-VWQ", "VH-VWW", "VH-VWX", "VH-VWN"],
  A20N: "ABCDEFGHJK".split("").map((l) => `VH-A5${l}`),
  A21N: "ABCDEFGH".split("").map((l) => `VH-OF${l}`),
  B788: "ABCDEF".split("").map((l) => `VH-VK${l}`),
};

const CUTOFF_MIN = 30;        // hide/prune this long before departure
const PLAN_DAYS = 3;          // today + next 2 days
const TICK_MS = 10 * 60 * 1000;

// 24/7 operation: departures can happen at any hour, night the same as day.
const DAY_START_MIN = 0;           // earliest first departure (origin-local)
const LAST_DEP_MIN = 24 * 60 - 5;  // latest departure of the day (23:55 local)
const NARROW_TURN_MS = 30 * 60_000;
const WIDE_TURN_MS = 60 * 60_000;
const NARROW_MAX_SECTORS = 8;
const WIDE_MAX_SECTORS = 2;
const WIDEBODY = new Set(["B788"]);
const SPARE_FRACTION = 0.2; // share of each fleet type kept idle as spares
const ANCHOR_TZ = "Australia/Sydney"; // reference zone for the operational day

// ── Timezone helpers (handle AEST/AEDT, ACST, AWST, NZ and Asia/Pacific + DST)

function tzOffsetMs(date: Date, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const asUTC = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUTC - date.getTime();
}

// Convert an origin-local wall-clock time to its true UTC instant.
function zonedToUtc(y: number, mo: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  const off = tzOffsetMs(new Date(guess), tz);
  return new Date(guess - off);
}

// Minute-of-day (origin-local) for a UTC instant.
function localMinuteOfDay(utcMs: number, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(utcMs));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return g("hour") * 60 + g("minute");
}

interface CalDate { y: number; mo: number; d: number; }

function localCalendarDate(now: Date, tz: string): CalDate {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { y: g("year"), mo: g("month"), d: g("day") };
}

function addDays(date: CalDate, n: number): CalDate {
  const dt = new Date(Date.UTC(date.y, date.mo - 1, date.d) + n * 86400000);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function weekday(date: CalDate): number {
  return new Date(Date.UTC(date.y, date.mo - 1, date.d)).getUTCDay();
}

function pad(n: number): string { return String(n).padStart(2, "0"); }
function dateStr(date: CalDate): string { return `${date.y}-${pad(date.mo)}-${pad(date.d)}`; }
function keyOf(flightNumber: string, flightDate: string): string { return `${flightNumber}|${flightDate}`; }

// ── Sector catalogue for a given weekday ─────────────────────────────────────

interface Sector { from: string; to: string; durationMin: number; window: [number, number]; }

// type → origin port → directional sectors operating that weekday.
function dayCatalog(wd: number): Record<string, Record<string, Sector[]>> {
  const byType: Record<string, Record<string, Sector[]>> = {};
  for (const p of ROUTE_PAIRS) {
    if (!p.days.includes(wd)) continue;
    // 24/7: every route may operate at any hour (no daytime-only windows).
    const window: [number, number] = [0, 24];
    for (const [from, to] of [[p.a, p.b], [p.b, p.a]] as [string, string][]) {
      ((byType[p.ac] ??= {})[from] ??= []).push({ from, to, durationMin: p.durationMin, window });
    }
  }
  for (const t in byType) for (const f in byType[t]) byType[t][f].sort((a, b) => a.to.localeCompare(b.to));
  return byType;
}

// ── Rotation-first schedule ──────────────────────────────────────────────────

// Pure: the full set of flights that SHOULD exist right now (today + next 2
// days), built as a connected rotation per active tail, excluding anything
// already within the cutoff. Deterministic for a given (now, fleet). Keyed by
// "flightNumber|flightDate". No DB access — directly unit-testable.
export function computeDesiredFlights(now: Date = new Date(), fleet: Record<string, string[]> = DEFAULT_FLEET): Map<string, InsertFlight> {
  const cutoffMs = CUTOFF_MIN * 60 * 1000;
  const desired = new Map<string, InsertFlight>();
  // Deterministic iteration order regardless of how `fleet` was assembled.
  const types = Object.keys(fleet).sort();
  const anchor = localCalendarDate(now, ANCHOR_TZ);

  let seq = 0; // global leg counter → stable flight numbers
  for (let off = 0; off < PLAN_DAYS; off++) {
    const date = addDays(anchor, off);
    const cat = dayCatalog(weekday(date));

    for (const type of types) {
      const adj = cat[type];
      if (!adj) continue;
      // Don't roster the whole fleet — keep ~20% idle as spares (so there's cover
      // when one goes tech), rotating which tails rest from day to day.
      const sorted = [...fleet[type]].sort();
      const useCount = Math.max(1, Math.round(sorted.length * (1 - SPARE_FRACTION)));
      const dayNum = Math.floor(Date.UTC(date.y, date.mo - 1, date.d) / 86400000);
      const startIdx = sorted.length ? dayNum % sorted.length : 0;
      const tails = Array.from({ length: Math.min(useCount, sorted.length) }, (_, k) => sorted[(startIdx + k) % sorted.length]);
      const wide = WIDEBODY.has(type);
      const maxSectors = wide ? WIDE_MAX_SECTORS : NARROW_MAX_SECTORS;
      const turn = wide ? WIDE_TURN_MS : NARROW_TURN_MS;
      // Start ports: busiest first, so tails tend to begin at hubs.
      const ports = Object.keys(adj).sort((a, b) => adj[b].length - adj[a].length || a.localeCompare(b));
      if (ports.length === 0) continue;

      tails.forEach((reg, ti) => {
        let cur = ports[ti % ports.length];
        let prev = "";
        const startTz = AIRPORT_TZ[cur];
        if (!startTz) return;
        // Spread first departures across the whole 24h (plus a small per-type
        // offset) so the network has flights airborne day and night, rather
        // than every tail launching in the morning.
        const phase = (type.charCodeAt(0) * 37) % 90;
        const startMin = (DAY_START_MIN + Math.round((ti / tails.length) * 24 * 60) + phase) % (24 * 60);
        let clock = zonedToUtc(date.y, date.mo, date.d, Math.floor(startMin / 60), startMin % 60, startTz).getTime();

        for (let leg = 0; leg < maxSectors; leg++) {
          const fromTz = AIRPORT_TZ[cur];
          if (!fromTz) break;
          const depEarliest = clock + (leg === 0 ? 0 : turn);
          const lm = localMinuteOfDay(depEarliest, fromTz);
          const list = adj[cur] ?? [];
          const cands = list.filter((s) => { const [ws, we] = s.window; return Math.max(ws * 60, lm) <= Math.min(we * 60 - 5, LAST_DEP_MIN); });
          if (cands.length === 0) break;
          // Prefer not to fly straight back where we came from (nicer rotations).
          const fwd = cands.filter((c) => c.to !== prev);
          const pool = fwd.length ? fwd : cands;
          const s = pool[(ti + leg) % pool.length];

          const [ws, we] = s.window;
          let dm = Math.max(ws * 60, lm);
          dm = Math.ceil(dm / 5) * 5; // round up to 5-min slot
          if (dm > we * 60 - 5) break;
          const departsAtMs = depEarliest + (dm - lm) * 60_000; // strictly forward from the clock
          const departsAt = new Date(departsAtMs);
          const lmd = localMinuteOfDay(departsAtMs, fromTz);

          const flightNumber = `JQ${200 + seq}`;
          seq++;
          const flightDate = dateStr(date);
          if (departsAtMs - now.getTime() > cutoffMs) {
            desired.set(keyOf(flightNumber, flightDate), {
              flightNumber, departure: s.from, arrival: s.to, aircraft: type,
              departureTime: `${pad(Math.floor(lmd / 60))}:${pad(lmd % 60)}`,
              flightDate, durationMinutes: s.durationMin, departsAt, registration: reg,
            });
          }
          prev = cur;
          cur = s.to;
          clock = departsAtMs + s.durationMin * 60_000;
        }
      });
    }
  }
  return desired;
}

// ── Reconcile ────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  const now = new Date();

  // Live fleet: only ACTIVE aircraft are available for rotations, so an aircraft
  // on a maintenance hold / grounded automatically gets no flights. Reserve
  // aircraft (those with a home base set) are kept idle at their hub.
  const fleetRows = await db.select().from(aircraftTable).where(eq(aircraftTable.status, "active"));
  const fleet: Record<string, string[]> = {};
  for (const a of fleetRows) { if (a.base) continue; (fleet[a.type] ??= []).push(a.registration); }
  const fleetByType = Object.keys(fleet).length ? fleet : DEFAULT_FLEET;

  // Build the desired set of flights for the planning window.
  const desired = computeDesiredFlights(now, fleetByType);

  // Current DB state.
  const existing = await db.select().from(flightsTable);
  const existingKeys = new Set(existing.map((f) => keyOf(f.flightNumber, f.flightDate)));

  // Protect flights that are in anyone's timetable (logbooks).
  const timetable = await db.select().from(timetableTable);
  const protectedIds = new Set(timetable.map((t) => t.flightId));

  // Insert desired flights that don't exist yet.
  const toInsert = [...desired.entries()]
    .filter(([k]) => !existingKeys.has(k))
    .map(([, v]) => v);

  for (let i = 0; i < toInsert.length; i += 250) {
    await db.insert(flightsTable).values(toInsert.slice(i, i + 250));
  }

  // Keep tails on existing, not-yet-picked-up flights in sync with the solver
  // (so a newly-held aircraft's upcoming flights get reassigned). Protected
  // flights (in a pilot's timetable) are left to the fleet manager / swaps.
  for (const f of existing) {
    if (protectedIds.has(f.id)) continue;
    const want = desired.get(keyOf(f.flightNumber, f.flightDate));
    if (want && (want.registration ?? null) !== (f.registration ?? null)) {
      await db.update(flightsTable).set({ registration: want.registration ?? null }).where(eq(flightsTable.id, f.id));
    }
  }

  // Prune flights that are no longer part of the schedule (stale day, past the
  // cutoff, or a removed route) and aren't protected by a timetable entry.
  // Keep near-term flights (just inside the pickup cutoff through recently
  // departed) alive so virtual-ops can claim and fly the ones no pilot took.
  const liveFrom = now.getTime() - 3 * 60 * 60_000;   // up to 3h after departure
  const liveTo = now.getTime() + 45 * 60_000;         // up to 45 min before
  const inLiveWindow = (f: typeof existing[number]) => {
    const t = f.departsAt ? f.departsAt.getTime() : departureInstant(f as any).getTime();
    return t >= liveFrom && t <= liveTo;
  };
  const toDelete = existing
    .filter((f) => !protectedIds.has(f.id) && !desired.has(keyOf(f.flightNumber, f.flightDate)) && !inLiveWindow(f))
    .map((f) => f.id);

  for (let i = 0; i < toDelete.length; i += 200) {
    await db.delete(flightsTable).where(inArray(flightsTable.id, toDelete.slice(i, i + 200)));
  }

  if (toInsert.length || toDelete.length) {
    logger.info(
      { added: toInsert.length, pruned: toDelete.length, desired: desired.size },
      "route-scheduler reconcile",
    );
  }
}

// ── Availability (used by GET /api/flights) ──────────────────────────────────

export function departureInstant(flight: {
  flightDate: string; departureTime: string; departsAt?: Date | string | null;
}): Date {
  if (flight.departsAt) return new Date(flight.departsAt);
  // Legacy rows without a stored instant: assume the local time was UTC.
  return new Date(`${flight.flightDate}T${flight.departureTime}:00Z`);
}

export function isFlightAvailable(
  flight: { flightDate: string; departureTime: string; departsAt?: Date | string | null },
  now: Date = new Date(),
): boolean {
  return departureInstant(flight).getTime() - now.getTime() > CUTOFF_MIN * 60 * 1000;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | undefined;

export function startRouteScheduler(): void {
  if (timer) return;
  const run = () => {
    tick().catch((err) => logger.error({ err }, "route-scheduler tick failed"));
  };
  run(); // reconcile immediately on boot
  timer = setInterval(run, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ everyMs: TICK_MS }, "route-scheduler started (rotation-first timetable)");
}
