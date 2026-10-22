// Virtual operations — the airline flies itself. Any scheduled flight that no
// human picks up before the pickup cutoff is flown by a pool of "virtual
// pilots" through the exact same timetable → tracking path a real pilot uses,
// so the ops layer (and its AI) can't tell a virtual flight from a human one:
// nothing here ever tags a flight as virtual in anything an AI reads.
//
// Each operated flight gets a randomised plan — it can leave early, on time or
// late, pick up extra enroute time to route around adverse weather, and is
// occasionally cancelled (more likely in bad weather). Flights are advanced
// pending → active → completed on the clock so the day's schedule finishes.
import {
  db, and, eq, inArray, gte, lte, lt,
  usersTable, flightsTable, timetableTable,
} from "@workspace/db";
import { runAgentTask, logEvent, isPaused, aiSummarize } from "./ops-core";
import { getWeather, isAdverse } from "./weather";

// Pool of system pilots that fly unclaimed sectors. Hidden from the human
// roster. Names are only ever seen by the admin, never by any AI prompt.
const VIRTUAL_PILOTS = Array.from({ length: 12 }, (_, i) => `autopilot-${i + 1}`);
const VIRTUAL_HASH = "!virtual-no-login"; // not a valid bcrypt hash → can't log in

// Claim a flight once it's inside the pickup cutoff (humans can no longer take
// it) and up to 90 min after departure (so missed sectors still get flown).
const CLAIM_AHEAD_MS = 28 * 60_000;
const CLAIM_BEHIND_MS = 90 * 60_000;
const CLEANUP_AGE_MS = 3 * 24 * 60 * 60_000;

const ri = (lo: number, hi: number) => Math.floor(lo + Math.random() * (hi - lo + 1));

// Ensure the virtual-pilot pool exists and looks "present" (so tracking shows
// their sectors as live, exactly like a pilot with the hub running).
async function ensureVirtualPilots(now: Date): Promise<{ id: number }[]> {
  const existing = await db.select().from(usersTable).where(eq(usersTable.isVirtual, true));
  const have = new Set(existing.map((u) => u.username));
  const toAdd = VIRTUAL_PILOTS.filter((n) => !have.has(n));
  if (toAdd.length) {
    await db.insert(usersTable).values(toAdd.map((username) => ({
      username, passwordHash: VIRTUAL_HASH, aircraft: "A320,A321,A20N,A21N,B788",
      isVirtual: true, msfsRunning: true, lastSeenAt: now,
    }))).onConflictDoNothing();
  }
  // Keep presence fresh every tick.
  await db.update(usersTable).set({ msfsRunning: true, lastSeenAt: now }).where(eq(usersTable.isVirtual, true));
  return db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.isVirtual, true));
}

interface Plan { cancelled: boolean; depAt: Date; arrAt: Date; delayMin: number; weather: boolean; }

// Roll a realistic operating plan for one flight, biased by airport weather.
async function rollPlan(dep: string, arr: string, departsAt: Date, durationMin: number): Promise<Plan> {
  const [wx1, wx2] = await Promise.all([getWeather(dep).catch(() => null), getWeather(arr).catch(() => null)]);
  const depAdverse = !!(wx1 && isAdverse(wx1).adverse);
  const arrAdverse = !!(wx2 && isAdverse(wx2).adverse);
  const weather = depAdverse || arrAdverse;

  // Cancellation: rare normally, more likely with weather at either end.
  const cancelP = Math.min(0.25, 0.03 + (depAdverse ? 0.08 : 0) + (arrAdverse ? 0.07 : 0));
  if (Math.random() < cancelP) {
    return { cancelled: true, depAt: departsAt, arrAt: departsAt, delayMin: 0, weather };
  }

  // Departure offset vs the scheduled slot.
  let depOffset: number;
  const r = Math.random();
  if (r < 0.15) depOffset = -ri(3, 8);        // early
  else if (r < 0.65) depOffset = ri(-2, 5);   // on time
  else if (r < 0.88) depOffset = ri(6, 20);   // minor delay
  else depOffset = ri(20, 45);                // notable delay
  if (depAdverse) depOffset += ri(10, 30);

  // Enroute time: weather routing adds minutes; occasional ATC flow; tailwinds
  // can bring it in early when the skies are clear.
  let enroute = 0;
  if (weather) enroute += ri(6, 22);
  if (Math.random() < 0.12) enroute += ri(4, 12);
  if (!weather && Math.random() < 0.15) enroute -= ri(3, 8);
  enroute = Math.max(-10, enroute);

  const depAt = new Date(departsAt.getTime() + depOffset * 60_000);
  const arrAt = new Date(depAt.getTime() + Math.max(5, durationMin + enroute) * 60_000);
  return { cancelled: false, depAt, arrAt, delayMin: Math.max(0, depOffset), weather };
}

export async function virtualOpsTick(): Promise<void> {
  if (await isPaused("auto-ops")) return;
  await runAgentTask("auto-ops", "Fly unclaimed sectors + advance virtual flights", async ({ taskRunId }) => {
    const now = new Date();
    const pilots = await ensureVirtualPilots(now);
    if (pilots.length === 0) return { facts: {}, summary: "No virtual pilots.", outcome: "skip" };

    let claimed = 0, operated = 0, cancelled = 0, activated = 0, completed = 0;

    // ── Claim unclaimed flights inside the operating window ──────────────────
    const windowFlights = await db.select().from(flightsTable).where(and(
      gte(flightsTable.departsAt, new Date(now.getTime() - CLAIM_BEHIND_MS)),
      lte(flightsTable.departsAt, new Date(now.getTime() + CLAIM_AHEAD_MS)),
    ));
    if (windowFlights.length) {
      const ids = windowFlights.map((f) => f.id);
      const entries = await db.select({ flightId: timetableTable.flightId }).from(timetableTable)
        .where(inArray(timetableTable.flightId, ids));
      const taken = new Set(entries.map((e) => e.flightId));
      // Balance load across the pool: track current active count per pilot.
      const active = await db.select({ userId: timetableTable.userId }).from(timetableTable)
        .where(and(eq(timetableTable.isVirtual, true), inArray(timetableTable.status, ["pending", "active"])));
      const load = new Map<number, number>(pilots.map((p) => [p.id, 0]));
      for (const a of active) load.set(a.userId, (load.get(a.userId) ?? 0) + 1);

      for (const f of windowFlights) {
        if (taken.has(f.id) || !f.departsAt) continue;
        const plan = await rollPlan(f.departure, f.arrival, f.departsAt, f.durationMinutes);
        // Least-loaded pilot gets the sector.
        const pilotId = [...load.entries()].sort((a, b) => a[1] - b[1])[0][0];
        load.set(pilotId, (load.get(pilotId) ?? 0) + 1);
        claimed++;

        if (plan.cancelled) {
          await db.insert(timetableTable).values({
            userId: pilotId, flightId: f.id, status: "cancelled", isVirtual: true,
            virtualDepAt: plan.depAt, virtualArrAt: plan.arrAt,
          });
          cancelled++;
          await logEvent({
            kind: "report_created", severity: "warn", agentKey: "auto-ops",
            title: `Flight cancelled — ${f.flightNumber}`,
            body: `${f.departure}→${f.arrival} cancelled${plan.weather ? " (weather)" : ""}.`,
            refType: "flight", refId: String(f.id), taskRunId,
          });
        } else {
          await db.insert(timetableTable).values({
            userId: pilotId, flightId: f.id, status: "pending", isVirtual: true,
            virtualDepAt: plan.depAt, virtualArrAt: plan.arrAt,
          });
          operated++;
          if (plan.weather || plan.delayMin >= 15) {
            await logEvent({
              kind: "report_created", severity: "info", agentKey: "auto-ops",
              title: `${plan.weather ? "Weather routing" : "Delay"} — ${f.flightNumber}`,
              body: `${f.departure}→${f.arrival}${plan.delayMin ? `, +${plan.delayMin} min off blocks` : ""}${plan.weather ? ", routing around weather" : ""}.`,
              refType: "flight", refId: String(f.id), taskRunId,
            });
          }
        }
      }
    }

    // ── Advance pending → active ─────────────────────────────────────────────
    const toStart = await db.select().from(timetableTable).where(and(
      eq(timetableTable.isVirtual, true), eq(timetableTable.status, "pending"),
      lte(timetableTable.virtualDepAt, now),
    ));
    for (const e of toStart) {
      await db.update(timetableTable).set({ status: "active", startedAt: e.virtualDepAt ?? now })
        .where(eq(timetableTable.id, e.id));
      activated++;
    }

    // ── Advance active → completed ───────────────────────────────────────────
    const toFinish = await db.select().from(timetableTable).where(and(
      eq(timetableTable.isVirtual, true), eq(timetableTable.status, "active"),
      lte(timetableTable.virtualArrAt, now),
    ));
    for (const e of toFinish) {
      const secs = e.startedAt && e.virtualArrAt ? Math.round((e.virtualArrAt.getTime() - e.startedAt.getTime()) / 1000) : null;
      await db.update(timetableTable).set({ status: "completed", finishedAt: e.virtualArrAt ?? now, flightDurationSeconds: secs })
        .where(eq(timetableTable.id, e.id));
      completed++;
    }

    // ── Clean up old virtual records so the tables don't grow forever ────────
    const cutoff = new Date(now.getTime() - CLEANUP_AGE_MS);
    const old = await db.select({ id: timetableTable.id, flightId: timetableTable.flightId })
      .from(timetableTable).where(and(
        eq(timetableTable.isVirtual, true),
        inArray(timetableTable.status, ["completed", "cancelled"]),
        lt(timetableTable.virtualArrAt, cutoff),
      ));
    if (old.length) {
      const entryIds = old.map((o) => o.id);
      await db.delete(timetableTable).where(inArray(timetableTable.id, entryIds));
      // Drop flights no other timetable row still references.
      const flightIds = [...new Set(old.map((o) => o.flightId))];
      const still = await db.select({ flightId: timetableTable.flightId }).from(timetableTable)
        .where(inArray(timetableTable.flightId, flightIds));
      const keep = new Set(still.map((s) => s.flightId));
      const dropFlights = flightIds.filter((id) => !keep.has(id));
      if (dropFlights.length) await db.delete(flightsTable).where(inArray(flightsTable.id, dropFlights));
    }

    const facts = { claimed, operated, cancelled, activated, completed, pool: pilots.length };
    const fallback = `Auto-ops: operated ${operated}, cancelled ${cancelled}, ${activated} departed, ${completed} arrived.`;
    const summary = (claimed || completed)
      ? await aiSummarize("auto-ops", `Autonomous operations this cycle: ${JSON.stringify(facts)}. One sentence, like an ops controller.`, fallback)
      : fallback;
    return { facts, summary, outcome: `${operated} op, ${cancelled} cx, ${completed} done` };
  });
}
