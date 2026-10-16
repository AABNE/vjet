import { Router, type IRouter } from "express";
import { db, flightsTable, timetableTable, usersTable, eq, inArray } from "@workspace/db";
import { GetAvailableFlightsResponse } from "@workspace/api-zod";
import { isAvailableAt } from "../lib/route-scheduler";

const router: IRouter = Router();

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

  const now = new Date();

  const available = allFlights.filter(f => {
    if (takenFlightIds.has(f.id)) return false;
    // Hide routes within 30 minutes of (or past) their scheduled UTC departure.
    return isAvailableAt(f.flightDate, f.departureTime, now);
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
