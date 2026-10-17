// Real Jetstar daily timetable generator for the pilot hub.
//
// Builds the actual day's flights from the published Jetstar network
// (src/data/jetstar-network.ts) for TODAY and the NEXT 2 DAYS (so pilots can
// plan ahead), reconciling the flights table on a short interval. Because each
// flight's day-of-operation and departure time are evaluated in the ORIGIN
// airport's own timezone, a port only sees service on the days it actually
// operates, and the day rolls over at that port's local midnight.
//
// Routes disappear 30 minutes before departure. Flights already in a pilot's
// timetable are never deleted (that would wipe their logbook).

import { db, flightsTable, timetableTable, inArray, type InsertFlight } from "@workspace/db";
import { logger } from "./logger";
import { ROUTE_PAIRS, AIRPORT_TZ, type RoutePair } from "../data/jetstar-network";

const CUTOFF_MIN = 30;        // hide/prune this long before departure
const PLAN_DAYS = 3;          // today + next 2 days
const TICK_MS = 10 * 60 * 1000;
const FLIGHT_NO_BASE = 500;
const FLIGHT_NO_STEP = 16;    // > max freq, so numbers never collide between routes

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

// ── Expand the pairs into directional "services" with stable flight numbers ──

interface Service {
  flightNoBase: number;
  from: string;
  to: string;
  aircraft: string;
  durationMin: number;
  days: number[];
  freq: number;
  window: [number, number];
  phase: number; // minutes offset so the return leg doesn't mirror the outbound
}

function buildServices(): Service[] {
  const services: Service[] = [];
  let idx = 0;
  const addDir = (from: string, to: string, p: RoutePair, phase: number) => {
    services.push({
      flightNoBase: FLIGHT_NO_BASE + idx * FLIGHT_NO_STEP,
      from, to,
      aircraft: p.ac,
      durationMin: p.durationMin,
      days: p.days,
      freq: p.freq,
      window: p.window ?? [6, 21],
      phase,
    });
    idx++;
  };
  for (const p of ROUTE_PAIRS) {
    addDir(p.a, p.b, p, 0);
    addDir(p.b, p.a, p, 37); // return leg departs offset from the outbound
  }
  return services;
}

const SERVICES = buildServices();

// Departure time (minutes past midnight, origin-local) for the i-th flight.
function departureMinutes(svc: Service, i: number): number {
  const [s, e] = svc.window;
  const startMin = s * 60;
  const spanMin = (e - s) * 60;
  const step = spanMin / Math.max(1, svc.freq);
  let m = startMin + Math.round((step * i + svc.phase) / 5) * 5;
  // keep inside the window
  const maxMin = e * 60 - 5;
  if (m > maxMin) m = maxMin - (svc.freq - 1 - i) * 5;
  return Math.max(startMin, m);
}

// ── Reconcile ────────────────────────────────────────────────────────────────

function keyOf(flightNumber: string, flightDate: string): string {
  return `${flightNumber}|${flightDate}`;
}

// Pure: the full set of flights that SHOULD exist right now (today + next 2 days,
// per origin-local operation, excluding anything already within the cutoff).
// Keyed by "flightNumber|flightDate". No DB access — directly unit-testable.
export function computeDesiredFlights(now: Date = new Date()): Map<string, InsertFlight> {
  const cutoffMs = CUTOFF_MIN * 60 * 1000;
  const desired = new Map<string, InsertFlight>();
  for (const svc of SERVICES) {
    const tz = AIRPORT_TZ[svc.from];
    if (!tz) continue;
    const today = localCalendarDate(now, tz);
    for (let off = 0; off < PLAN_DAYS; off++) {
      const date = addDays(today, off);
      if (!svc.days.includes(weekday(date))) continue;
      for (let i = 0; i < svc.freq; i++) {
        const mins = departureMinutes(svc, i);
        const hh = Math.floor(mins / 60);
        const mm = mins % 60;
        const departsAt = zonedToUtc(date.y, date.mo, date.d, hh, mm, tz);
        // Don't create flights that are already within the cutoff / in the past.
        if (departsAt.getTime() - now.getTime() <= cutoffMs) continue;
        const flightNumber = `JQ${svc.flightNoBase + i}`;
        const flightDate = dateStr(date);
        desired.set(keyOf(flightNumber, flightDate), {
          flightNumber,
          departure: svc.from,
          arrival: svc.to,
          aircraft: svc.aircraft,
          departureTime: `${pad(hh)}:${pad(mm)}`,
          flightDate,
          durationMinutes: svc.durationMin,
          departsAt,
        });
      }
    }
  }
  return desired;
}

async function tick(): Promise<void> {
  const now = new Date();

  // Build the desired set of flights for the planning window.
  const desired = computeDesiredFlights(now);

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

  // Prune flights that are no longer part of the schedule (stale day, past the
  // cutoff, or a removed route) and aren't protected by a timetable entry.
  const toDelete = existing
    .filter((f) => !protectedIds.has(f.id) && !desired.has(keyOf(f.flightNumber, f.flightDate)))
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
  logger.info({ everyMs: TICK_MS, services: SERVICES.length }, "route-scheduler started (real Jetstar timetable)");
}
