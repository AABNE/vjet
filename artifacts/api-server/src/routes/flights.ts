import { Router, type IRouter } from "express";
import { db, flightsTable, timetableTable, usersTable, eq, inArray, and, gt, lt, asc } from "@workspace/db";
import { GetAvailableFlightsResponse } from "@workspace/api-zod";
import { isFlightAvailable } from "../lib/route-scheduler";

const router: IRouter = Router();

router.get("/flights", async (req, res): Promise<void> => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user) { res.status(401).json({ error: "User not found" }); return; }

  const aircraftTypes = user.aircraft.split(",").map(s => s.trim()).filter(Boolean);
  if (aircraftTypes.length === 0) { res.json(GetAvailableFlightsResponse.parse([])); return; }

  const now = new Date();
  const cutoff = new Date(now.getTime() + 30 * 60_000);   // hide within 30 min of departure
  const horizon = new Date(now.getTime() + 3 * 24 * 60 * 60_000); // only the planning window

  // Filter in the DB (type + departure window) and cap the result — far less to
  // load, serialise and render than pulling every flight.
  const typeCond = aircraftTypes.length === 1
    ? eq(flightsTable.aircraft, aircraftTypes[0])
    : inArray(flightsTable.aircraft, aircraftTypes);
  const allFlights = await db.select().from(flightsTable)
    .where(and(typeCond, gt(flightsTable.departsAt, cutoff), lt(flightsTable.departsAt, horizon)))
    .orderBy(asc(flightsTable.departsAt))
    .limit(400);

  // Routes already in anyone's active/pending timetable disappear — EXCEPT a
  // sector the AI is only slated to fly (a virtual entry that hasn't departed
  // yet). Those stay on the timetable so a pilot can still take one over; once
  // the AI flight is airborne (active) or done, it drops off like any other.
  const takenEntries = await db.select().from(timetableTable);
  const takenFlightIds = new Set(
    takenEntries
      .filter(e => e.status !== "completed")
      .filter(e => !(e.isVirtual && e.status === "pending"))
      .map(e => e.flightId)
  );

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
