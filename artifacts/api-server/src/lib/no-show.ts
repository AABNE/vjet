// No-show paging: if a pilot's aircraft isn't detected (no live Sim Link
// heartbeat) ~30 min before a pending sector's departure, dispatch pages them.
// This is a warning only — it is NOT a strike.
import { db, timetableTable, flightsTable, usersTable, eq, and, gte, lte } from "@workspace/db";
import { notify } from "./ops";
import { logger } from "./logger";

const TICK_MS = 60_000;
const LEAD_MS = 30 * 60_000;      // page within 30 min of departure
const PRESENCE_MS = 3 * 60_000;   // heartbeat older than this = not connected

function detected(user: { msfsRunning: boolean; lastSeenAt: Date | null }): boolean {
  if (!user.msfsRunning || !user.lastSeenAt) return false;
  return Date.now() - user.lastSeenAt.getTime() < PRESENCE_MS;
}

async function tick(): Promise<void> {
  const now = new Date();
  const soon = new Date(now.getTime() + LEAD_MS);

  const rows = await db
    .select()
    .from(timetableTable)
    .innerJoin(flightsTable, eq(timetableTable.flightId, flightsTable.id))
    .where(and(
      eq(timetableTable.status, "pending"),
      eq(timetableTable.noShowNotified, false),
      gte(flightsTable.departsAt, now),
      lte(flightsTable.departsAt, soon),
    ));

  for (const row of rows) {
    const entry = row.timetable;
    const flight = row.flights;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, entry.userId));
    if (!user) continue;
    if (detected(user)) continue; // aircraft is up — nothing to do

    const mins = Math.max(0, Math.round((flight.departsAt!.getTime() - now.getTime()) / 60_000));
    await notify(user.id, "ops", `Ops paging — ${flight.flightNumber}`,
      `We don't see your aircraft connected and ${flight.departure}→${flight.arrival} is due out in ${mins} min. Load into MSFS and start Sim Link.`);
    await db.update(timetableTable).set({ noShowNotified: true }).where(eq(timetableTable.id, entry.id));
  }
}

export function startNoShowWatch(): void {
  const run = () => tick().catch((err) => logger.error({ err }, "no-show watch tick failed"));
  run();
  setInterval(run, TICK_MS);
  logger.info({ everyMs: TICK_MS }, "no-show watch started");
}
