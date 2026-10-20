import { Router, type IRouter } from "express";
import { db, flightsTable, timetableTable, usersTable, eq, inArray } from "@workspace/db";
import { GetAvailableFlightsResponse } from "@workspace/api-zod";
import { isFlightAvailable } from "../lib/route-scheduler";

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
    .orderBy(flightsTable.flightDate, flightsTable.departureTime);

  // Routes already in anyone's active/pending timetable disappear
  const takenEntries = await db.select().from(timetableTable);
  const takenFlightIds = new Set(
    takenEntries.filter(e => e.status !== "completed").map(e => e.flightId)
  );

  const now = new Date();

  // Realistic routing: if the pilot has it on, they continue from where their
  // last flight landed — only show flights departing that airport.
  let currentAirport: string | null = null;
  if (user.routeContinuity) {
    const mine = await db.select().from(timetableTable).where(eq(timetableTable.userId, user.id));
    const flightIds = [...new Set(mine.map((e) => e.flightId))];
    if (flightIds.length) {
      const myFlights = await db.select().from(flightsTable).where(inArray(flightsTable.id, flightIds));
      let latestMs = -Infinity;
      for (const f of myFlights) {
        const ms = f.departsAt ? new Date(f.departsAt).getTime() : new Date(`${f.flightDate}T${f.departureTime}:00Z`).getTime();
        if (ms > latestMs) { latestMs = ms; currentAirport = f.arrival; }
      }
    }
  }

  const available = allFlights.filter(f => {
    if (takenFlightIds.has(f.id)) return false;
    if (currentAirport && f.departure !== currentAirport) return false;
    // Hide routes within 30 minutes of (or past) their scheduled departure.
    return isFlightAvailable(f, now);
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
