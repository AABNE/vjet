// Random route generator + pruner for the pilot hub.
//
// Keeps a rolling pool of randomised upcoming flights so pilots always have
// routes to pick, and removes routes 30 minutes before their scheduled
// departure. Routes already in a pilot's timetable are never deleted (that
// would wipe their logbook), so only unpicked, expiring routes are pruned.
//
// All times are UTC ("Zulu"), which is the convention for flight sim / VATSIM.
// departure_time is stored as "HH:MM" and flight_date as "YYYY-MM-DD", both UTC.

import { db, flightsTable, timetableTable, inArray, type InsertFlight } from "@workspace/db";
import { logger } from "./logger";

// How long before departure a route stops being offered / gets pruned.
const CUTOFF_MIN = 30;
// How far ahead we schedule generated routes.
const HORIZON_HOURS = 36;
// Target number of *upcoming* (available) routes to keep per aircraft type.
const TARGET_PER_AIRCRAFT: Record<string, number> = {
  A320: 10,
  A20N: 10,
  A21N: 8,
  B788: 6,
};
// How often the scheduler runs.
const TICK_MS = 5 * 60 * 1000;

// Airport pools. Narrowbody = Jetstar domestic + short international;
// widebody (787) = international long-haul with one Australian hub end.
const AU_HUBS = ["SYD", "MEL", "BNE", "OOL", "CNS", "PER", "ADL", "DRW"];
const NARROWBODY_PORTS = [
  "BNE", "SYD", "MEL", "OOL", "CNS", "ADL", "PER", "HBA", "LST", "DRW",
  "TSV", "MCY", "AVV", "NTL", "MKY", "ROK", "PPP", "BNK",
  "AKL", "CHC", "ZQN", "WLG", "DPS", "NAN",
];
const INTERNATIONAL_LONGHAUL = [
  "DPS", "SIN", "BKK", "HKT", "NRT", "KIX", "ICN", "HNL", "SGN", "DAD",
];

const NARROWBODY_TYPES = ["A320", "A20N", "A21N"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Format a Date as UTC "YYYY-MM-DD" and "HH:MM".
function utcParts(d: Date): { date: string; time: string } {
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return { date, time };
}

// Combine stored "YYYY-MM-DD" + "HH:MM" (UTC) into a Date.
export function departureDate(flightDate: string, departureTime: string): Date {
  return new Date(`${flightDate}T${departureTime}:00Z`);
}

// A flight is still offerable if it departs more than CUTOFF_MIN from now.
export function isAvailableAt(flightDate: string, departureTime: string, now: Date = new Date()): boolean {
  const dep = departureDate(flightDate, departureTime).getTime();
  return dep - now.getTime() > CUTOFF_MIN * 60 * 1000;
}

function makeRandomFlight(aircraft: string, now: Date): InsertFlight {
  const isWide = aircraft === "B788";

  let departure: string;
  let arrival: string;
  if (isWide) {
    // One Australian hub end, one international long-haul end, random direction.
    const hub = pick(AU_HUBS);
    let intl = pick(INTERNATIONAL_LONGHAUL);
    while (intl === hub) intl = pick(INTERNATIONAL_LONGHAUL);
    [departure, arrival] = Math.random() < 0.5 ? [hub, intl] : [intl, hub];
  } else {
    departure = pick(NARROWBODY_PORTS);
    arrival = pick(NARROWBODY_PORTS);
    while (arrival === departure) arrival = pick(NARROWBODY_PORTS);
  }

  const durationMinutes = isWide ? randInt(240, 560) : randInt(55, 205);

  // Departure between (cutoff + a buffer) and the horizon, on a 5-minute mark.
  const minLeadMs = (CUTOFF_MIN + 20) * 60 * 1000;
  const maxLeadMs = HORIZON_HOURS * 60 * 60 * 1000;
  let depTime = now.getTime() + randInt(minLeadMs, maxLeadMs);
  depTime -= depTime % (5 * 60 * 1000); // round down to 5 min
  const { date, time } = utcParts(new Date(depTime));

  return {
    flightNumber: `JQ${randInt(1, 999)}`,
    departure,
    arrival,
    aircraft,
    departureTime: time,
    flightDate: date,
    durationMinutes,
  };
}

async function tick(): Promise<void> {
  const now = new Date();

  // Load everything once (the flights table is small).
  const flights = await db.select().from(flightsTable);
  const timetable = await db.select().from(timetableTable);
  const pickedIds = new Set(timetable.map((t) => t.flightId));

  // ── Prune: unpicked routes that are within the cutoff (or already past) ──
  const toDelete = flights
    .filter((f) => !pickedIds.has(f.id) && !isAvailableAt(f.flightDate, f.departureTime, now))
    .map((f) => f.id);

  if (toDelete.length) {
    // Chunk to keep the IN (...) list sane.
    for (let i = 0; i < toDelete.length; i += 200) {
      await db.delete(flightsTable).where(inArray(flightsTable.id, toDelete.slice(i, i + 200)));
    }
  }

  // ── Generate: top each aircraft type back up to its target of available routes ──
  const surviving = flights.filter((f) => !toDelete.includes(f.id));
  const availableByType = new Map<string, number>();
  for (const f of surviving) {
    if (isAvailableAt(f.flightDate, f.departureTime, now)) {
      availableByType.set(f.aircraft, (availableByType.get(f.aircraft) ?? 0) + 1);
    }
  }

  const newFlights: InsertFlight[] = [];
  for (const [aircraft, target] of Object.entries(TARGET_PER_AIRCRAFT)) {
    const have = availableByType.get(aircraft) ?? 0;
    for (let i = have; i < target; i++) {
      newFlights.push(makeRandomFlight(aircraft, now));
    }
  }

  if (newFlights.length) {
    await db.insert(flightsTable).values(newFlights);
  }

  if (toDelete.length || newFlights.length) {
    logger.info(
      { pruned: toDelete.length, generated: newFlights.length },
      "route-scheduler tick",
    );
  }
}

let timer: ReturnType<typeof setInterval> | undefined;

export function startRouteScheduler(): void {
  // Guard against double-start.
  if (timer) return;

  // Narrowbody types that aren't in TARGET get a sane default of 8 (future-proofing).
  for (const t of NARROWBODY_TYPES) {
    if (!(t in TARGET_PER_AIRCRAFT)) TARGET_PER_AIRCRAFT[t] = 8;
  }

  const run = () => {
    tick().catch((err) => logger.error({ err }, "route-scheduler tick failed"));
  };

  run(); // immediate top-up on boot
  timer = setInterval(run, TICK_MS);
  // Don't keep the event loop alive just for this.
  if (typeof timer.unref === "function") timer.unref();

  logger.info({ everyMs: TICK_MS }, "route-scheduler started");
}
