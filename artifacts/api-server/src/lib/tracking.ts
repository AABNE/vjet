// Normalised flight tracking. Two providers feed one shape so the ops layer
// doesn't care where the data came from:
//   • SimLink (PC)  — real. We know presence (msfsRunning + lastSeenAt) from the
//                     desktop heartbeat, plus the active timetable sector's timing.
//                     (Live lat/lon lives client-side; the server tracks timing +
//                     presence. Position-in-heartbeat is a planned enhancement.)
//   • Volanta (Xbox) — username stored; there is no public Volanta live-tracking
//                      API, so this adapter reports "unsupported" rather than
//                      fabricating positions. Swap in real data here when available.
import {
  db, inArray,
  timetableTable, flightsTable, usersTable,
} from "@workspace/db";
import { departureInstant } from "./route-scheduler";

export type TrackStatus =
  | "on_time" | "possible_delay" | "confirmed_delay"
  | "tracking_unavailable" | "completed" | "cancelled" | "unknown";

export interface TrackedFlight {
  pilotUserId: number;
  pilotUsername: string;
  provider: "simlink" | "volanta" | "none";
  providerSupported: boolean;
  timetableId: number;
  flightId: number;
  flightNumber: string;
  departure: string;
  arrival: string;
  aircraftType: string;
  flightStatus: string; // timetable status
  scheduledDepAt: Date | null;
  scheduledArrAt: Date | null;
  startedAt: Date | null;
  estimatedArrAt: Date | null;
  status: TrackStatus;
  trackingStatus: "live" | "stale" | "none";
  lastUpdateAt: Date | null;
  confidence: "high" | "medium" | "low";
  delayMinutes: number | null;
}

const PRESENCE_FRESH_MS = 3 * 60_000;

function schedDep(flight: typeof flightsTable.$inferSelect): Date | null {
  if (flight.departsAt) return flight.departsAt;
  try { return departureInstant(flight as any); } catch { return null; }
}

// Delay thresholds (configurable defaults).
export const DELAY = {
  possibleMin: 15,   // past slot by this many minutes with no progress → possible
  confirmedMin: 30,  // past slot / overrun by this many minutes → confirmed
};

// Build the normalised tracking feed for every pilot with an open sector.
export async function collectTracking(now = new Date()): Promise<TrackedFlight[]> {
  const open = await db.select().from(timetableTable)
    .where(inArray(timetableTable.status, ["pending", "active"]));
  if (open.length === 0) return [];

  const userIds = [...new Set(open.map((e) => e.userId))];
  const flightIds = [...new Set(open.map((e) => e.flightId))];
  const users = userIds.length ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds)) : [];
  const flights = flightIds.length ? await db.select().from(flightsTable).where(inArray(flightsTable.id, flightIds)) : [];
  const uById = new Map(users.map((u) => [u.id, u]));
  const fById = new Map(flights.map((f) => [f.id, f]));

  const out: TrackedFlight[] = [];
  for (const e of open) {
    const u = uById.get(e.userId);
    const f = fById.get(e.flightId);
    if (!u || !f) continue;

    // PC / SimLink is the only supported tracking provider.
    const provider: "simlink" | "volanta" = "simlink";
    const providerSupported = true;

    const depAt = schedDep(f);
    const arrAt = depAt ? new Date(depAt.getTime() + f.durationMinutes * 60_000) : null;
    const estArr = e.startedAt ? new Date(e.startedAt.getTime() + f.durationMinutes * 60_000) : arrAt;

    // Presence (SimLink only; Volanta has no live feed yet).
    const fresh = providerSupported && u.msfsRunning && u.lastSeenAt && (now.getTime() - u.lastSeenAt.getTime() < PRESENCE_FRESH_MS);
    const trackingStatus: "live" | "stale" | "none" =
      !providerSupported ? "none" : fresh ? "live" : (u.msfsRunning ? "stale" : "none");

    let status: TrackStatus = "unknown";
    let delayMinutes: number | null = null;
    const st = e.status.toLowerCase();

    if (st === "active") {
      // Overrun past the estimated arrival → delay.
      if (estArr) {
        const over = Math.round((now.getTime() - estArr.getTime()) / 60_000);
        if (over >= DELAY.confirmedMin) { status = "confirmed_delay"; delayMinutes = over; }
        else if (over >= DELAY.possibleMin) { status = "possible_delay"; delayMinutes = over; }
        else status = "on_time";
      } else status = "on_time";
    } else if (st === "pending") {
      if (depAt) {
        const past = Math.round((now.getTime() - depAt.getTime()) / 60_000);
        if (past >= DELAY.confirmedMin) status = fresh ? "confirmed_delay" : "tracking_unavailable";
        else if (past >= DELAY.possibleMin) status = "possible_delay";
        else status = "on_time";
        if (past >= DELAY.possibleMin) delayMinutes = past;
      } else status = "unknown";
      // A pilot who hasn't connected at all near the slot is tracking-unavailable,
      // NOT a confirmed delay (we don't conflate the two).
      if (!providerSupported) status = status === "on_time" ? "on_time" : "tracking_unavailable";
    }

    out.push({
      pilotUserId: u.id, pilotUsername: u.username,
      provider, providerSupported,
      timetableId: e.id, flightId: f.id,
      flightNumber: f.flightNumber, departure: f.departure, arrival: f.arrival, aircraftType: f.aircraft,
      flightStatus: e.status,
      scheduledDepAt: depAt, scheduledArrAt: arrAt, startedAt: e.startedAt ?? null, estimatedArrAt: estArr,
      status, trackingStatus,
      lastUpdateAt: u.lastSeenAt ?? null,
      confidence: providerSupported ? (fresh ? "high" : "low") : "low",
      delayMinutes,
    });
  }
  return out;
}

// For a specific pilot (profile / dashboard).
export async function trackingForUser(userId: number, now = new Date()): Promise<TrackedFlight[]> {
  const all = await collectTracking(now);
  return all.filter((t) => t.pilotUserId === userId);
}
