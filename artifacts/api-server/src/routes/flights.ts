import { Router, type IRouter } from "express";
import { db, flightsTable, timetableTable, usersTable, eq, inArray } from "@workspace/db";
import { GetAvailableFlightsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

router.get("/flights", async (req, res): Promise<void> => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const aircraftTypes = user.aircraft.split(",").map(s => s.trim()).filter(Boolean);

  const allFlights = await db.select().from(flightsTable)
    .where(aircraftTypes.length === 1
      ? eq(flightsTable.aircraft, aircraftTypes[0])
      : inArray(flightsTable.aircraft, aircraftTypes))
    .orderBy(flightsTable.departureTime);

  // Routes already in anyone's active/pending timetable disappear
  const takenEntries = await db.select().from(timetableTable);
  const takenFlightIds = new Set(
    takenEntries.filter(e => e.status !== "completed").map(e => e.flightId)
  );

  const currentMins = nowMinutes();

  const available = allFlights.filter(f => {
    if (takenFlightIds.has(f.id)) return false;

    // Parse HH:MM departure time
    const parts = f.departureTime.split(":");
    const depHour = parseInt(parts[0] ?? "0", 10);
    const depMin = parseInt(parts[1] ?? "0", 10);
    const depMins = depHour * 60 + depMin;

    // Remove 30 minutes before scheduled departure
    return depMins - currentMins > 30;
  });

  res.json(GetAvailableFlightsResponse.parse(
    available.map(f => ({
      id: f.id,
      flightNumber: f.flightNumber,
      departure: f.departure,
      arrival: f.arrival,
      aircraft: f.aircraft,
      departureTime: f.departureTime,
      flightDate: f.flightDate,
      durationMinutes: f.durationMinutes,
    }))
  ));
});

export default router;
