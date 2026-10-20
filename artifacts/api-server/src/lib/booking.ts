// Booking window rule: once a pilot takes a flight they're tied up from its
// departure until 30 minutes after it's due to land (departsAt + flight time +
// 30m turnaround). They can't schedule another flight that falls inside that
// window. Flights with no known departure time can't be placed on the clock, so
// they're skipped (the rule only applies when both sides have a departure).
import { db, eq, and, inArray, timetableTable, flightsTable } from "@workspace/db";

export const TURNAROUND_MIN = 30;

export interface BookingConflict { flightNumber: string; busyUntil: Date; }

function windowEnd(departsAt: Date, durationMinutes: number | null): number {
  return departsAt.getTime() + ((durationMinutes ?? 0) + TURNAROUND_MIN) * 60_000;
}

// Returns the current flight a proposed booking would clash with (the one whose
// busy window it overlaps), or null if the pilot is free to take it.
export async function findBookingConflict(
  userId: number,
  newDepartsAt: Date | null | undefined,
  newDurationMinutes: number | null | undefined,
  ignoreTimetableId?: number,
): Promise<BookingConflict | null> {
  if (!newDepartsAt) return null; // can't place it in time → don't block
  const newStart = newDepartsAt.getTime();
  const newEnd = windowEnd(newDepartsAt, newDurationMinutes ?? 0);

  const rows = await db
    .select({ tt: timetableTable, f: flightsTable })
    .from(timetableTable)
    .innerJoin(flightsTable, eq(timetableTable.flightId, flightsTable.id))
    .where(and(eq(timetableTable.userId, userId), inArray(timetableTable.status, ["pending", "active"])));

  let clash: BookingConflict | null = null;
  for (const { tt, f } of rows) {
    if (ignoreTimetableId && tt.id === ignoreTimetableId) continue;
    if (!f.departsAt) continue;
    const start = f.departsAt.getTime();
    const end = windowEnd(f.departsAt, f.durationMinutes);
    if (newStart < end && start < newEnd) { // windows overlap
      const busyUntil = new Date(end);
      if (!clash || busyUntil > clash.busyUntil) clash = { flightNumber: f.flightNumber, busyUntil };
    }
  }
  return clash;
}

function fmtUtc(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}Z`;
}

// A ready-to-send 409 message for a conflict.
export function conflictMessage(c: BookingConflict): string {
  return `You're rostered on ${c.flightNumber} until ${fmtUtc(c.busyUntil)} (landing + 30 min turnaround). Your next flight has to depart after then.`;
}
