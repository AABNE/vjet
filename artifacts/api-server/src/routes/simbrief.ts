import { Router, type IRouter } from "express";

import { db, flightsTable, timetableTable, usersTable, eq, and } from "@workspace/db";
import { GetTimetableResponse } from "@workspace/api-zod";

const router: IRouter = Router();
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function firstText(source: JsonObject, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return undefined;
}

function mapAircraft(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const code = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (["A320", "A320200"].includes(code)) return "A320";
  if (["A20N", "A320N", "A320NEO"].includes(code)) return "A20N";
  if (["A21N", "A321", "A321NEO", "A321LR", "A321NEOLR"].includes(code)) return "A21N";
  if (["B788", "B7878", "7878"].includes(code)) return "B788";
  return undefined;
}

function asDate(value: unknown): Date | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000);
  if (/^\d{13}$/.test(raw)) return new Date(Number(raw));
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function durationMinutes(times: JsonObject, general: JsonObject, out: Date, inTime?: Date): number {
  if (inTime && inTime > out) return Math.max(1, Math.round((inTime.getTime() - out.getTime()) / 60_000));

  const raw = firstText(times, "est_enroute", "sched_enroute")
    ?? firstText(general, "time_enroute", "enroute_time");
  if (raw) {
    const colon = raw.match(/^(\d{1,3}):(\d{2})$/);
    if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
    const hhmm = raw.match(/^(\d{1,3})(\d{2})$/);
    if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2]);
  }
  return 60;
}

function airportLabel(airport: JsonObject, generalCode?: string): string | undefined {
  const iata = firstText(airport, "iata");
  const icao = firstText(airport, "icao") ?? generalCode;
  const name = firstText(airport, "name", "airport_name");
  const code = iata ?? icao;
  if (!code) return undefined;
  if (name && name.toUpperCase() !== code.toUpperCase()) return `${name} (${code})`;
  return code;
}

router.post("/simbrief/import", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  if (!user.simbriefUsername) {
    res.status(400).json({ error: "Add your SimBrief/Navigraph username in Pilot Settings first." });
    return;
  }

  let payload: JsonObject;
  try {
    const url = new URL("https://www.simbrief.com/api/xml.fetcher.php");
    url.searchParams.set("username", user.simbriefUsername);
    url.searchParams.set("json", "v2");
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      res.status(response.status === 400 ? 400 : 502).json({
        error: response.status === 400
          ? "SimBrief could not find a current plan for that username."
          : "SimBrief is temporarily unavailable. Try again shortly.",
      });
      return;
    }
    payload = object(await response.json());
  } catch (error) {
    req.log.warn({ err: error }, "SimBrief plan fetch failed");
    res.status(502).json({ error: "Could not reach SimBrief. Try again shortly." });
    return;
  }

  const fetchInfo = object(payload.fetch);
  if (firstText(fetchInfo, "status")?.toLowerCase() === "error") {
    res.status(400).json({ error: "SimBrief has no current flight plan for that username." });
    return;
  }

  const general = object(payload.general);
  const times = object(payload.times);
  const origin = object(payload.origin);
  const destination = object(payload.destination);
  const originCode = firstText(general, "origin");
  const destinationCode = firstText(general, "destination");
  const departure = airportLabel(origin, originCode);
  const arrival = airportLabel(destination, destinationCode);
  const scheduledOut = asDate(times.sched_out) ?? asDate(times.est_out);
  const scheduledIn = asDate(times.sched_in) ?? asDate(times.est_in);
  if (!departure || !arrival || !scheduledOut) {
    res.status(502).json({ error: "The latest SimBrief plan is missing a usable route or departure time." });
    return;
  }

  const assignedAircraft = user.aircraft.split(",").map((code) => code.trim()).filter(Boolean);
  const planAircraft = mapAircraft(firstText(general, "icao_aircraft", "aircraft", "type"));
  const aircraft = planAircraft ?? assignedAircraft[0];
  if (!aircraft || !assignedAircraft.includes(aircraft)) {
    res.status(400).json({
      error: "The SimBrief aircraft is not assigned to your pilot account. Ask an administrator to update your Jetstar fleet assignment.",
    });
    return;
  }

  const flightNumber = firstText(general, "flight_number", "callsign", "callsign_id")
    ?? `SB-${scheduledOut.toISOString().slice(0, 10).replaceAll("-", "")}`;
  const flightDate = scheduledOut.toISOString().slice(0, 10);
  const departureTime = `${scheduledOut.toISOString().slice(11, 16)}Z`;
  const duration = durationMinutes(times, general, scheduledOut, scheduledIn);

  let [flight] = await db
    .select()
    .from(flightsTable)
    .where(and(
      eq(flightsTable.flightNumber, flightNumber),
      eq(flightsTable.departure, departure),
      eq(flightsTable.arrival, arrival),
      eq(flightsTable.flightDate, flightDate),
    ));

  if (!flight) {
    [flight] = await db.insert(flightsTable).values({
      flightNumber,
      departure,
      arrival,
      aircraft,
      departureTime,
      flightDate,
      durationMinutes: duration,
    }).returning();
  }

  const [existingEntry] = await db
    .select()
    .from(timetableTable)
    .where(and(
      eq(timetableTable.userId, user.id),
      eq(timetableTable.flightId, flight.id),
    ));
  if (existingEntry && existingEntry.status !== "completed") {
    res.status(409).json({ error: "This SimBrief flight is already in your timetable." });
    return;
  }

  const [entry] = await db.insert(timetableTable).values({
    userId: user.id,
    flightId: flight.id,
    status: "pending",
  }).returning();

  const [responseEntry] = GetTimetableResponse.parse([{
    id: entry.id,
    userId: entry.userId,
    flightId: entry.flightId,
    status: entry.status,
    startedAt: null,
    finishedAt: null,
    flightDurationSeconds: null,
    flight: {
      id: flight.id,
      flightNumber: flight.flightNumber,
      departure: flight.departure,
      arrival: flight.arrival,
      aircraft: flight.aircraft,
      departureTime: flight.departureTime,
      flightDate: flight.flightDate,
      durationMinutes: flight.durationMinutes,
    },
  }]);
  res.status(201).json(responseEntry);
});

export default router;
