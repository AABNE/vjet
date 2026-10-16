import { db, flightsTable, pool } from "@workspace/db";

type RouteSample = {
  flightNumber: string;
  departure: string;
  arrival: string;
  aircraft: string;
  departureTime: string;
  durationMinutes: number;
  weekdays: number[];
};

// Published Jetstar Airways route/flight examples. Route sources:
// jetstar.com newsroom: Avalon–Adelaide/Bali (2025–26), Perth–Manila (2025),
// Brisbane–Rarotonga (2026). Timetable times/durations are clearly labelled
// as simulator examples in the app, not live operational data.
const routeSamples: RouteSample[] = [
  { flightNumber: "JQ49", departure: "Melbourne Avalon (AVV)", arrival: "Denpasar (DPS)", aircraft: "A21N", departureTime: "18:40", durationMinutes: 370, weekdays: [0, 1, 3, 4, 5] },
  { flightNumber: "JQ50", departure: "Denpasar (DPS)", arrival: "Melbourne Avalon (AVV)", aircraft: "A21N", departureTime: "23:25", durationMinutes: 370, weekdays: [0, 1, 3, 4, 5] },
  { flightNumber: "JQ620", departure: "Adelaide (ADL)", arrival: "Melbourne Avalon (AVV)", aircraft: "A320", departureTime: "16:30", durationMinutes: 105, weekdays: [0, 1, 3, 5] },
  { flightNumber: "JQ620", departure: "Adelaide (ADL)", arrival: "Melbourne Avalon (AVV)", aircraft: "A320", departureTime: "17:50", durationMinutes: 105, weekdays: [2, 4, 6] },
  { flightNumber: "JQ621", departure: "Melbourne Avalon (AVV)", arrival: "Adelaide (ADL)", aircraft: "A320", departureTime: "18:50", durationMinutes: 105, weekdays: [0, 1, 3, 5] },
  { flightNumber: "JQ621", departure: "Melbourne Avalon (AVV)", arrival: "Adelaide (ADL)", aircraft: "A320", departureTime: "20:10", durationMinutes: 105, weekdays: [2, 4, 6] },
  { flightNumber: "JQ105", departure: "Brisbane (BNE)", arrival: "Rarotonga (RAR)", aircraft: "A21N", departureTime: "22:20", durationMinutes: 415, weekdays: [1, 4, 6] },
  { flightNumber: "JQ104", departure: "Rarotonga (RAR)", arrival: "Brisbane (BNE)", aircraft: "A21N", departureTime: "09:10", durationMinutes: 415, weekdays: [1, 4, 6] },
  { flightNumber: "JQ81", departure: "Perth (PER)", arrival: "Manila (MNL)", aircraft: "A21N", departureTime: "21:10", durationMinutes: 245, weekdays: [4] },
  { flightNumber: "JQ81", departure: "Perth (PER)", arrival: "Manila (MNL)", aircraft: "A21N", departureTime: "22:55", durationMinutes: 245, weekdays: [0, 2] },
  { flightNumber: "JQ27", departure: "Sydney (SYD)", arrival: "Phuket (HKT)", aircraft: "B788", departureTime: "13:05", durationMinutes: 555, weekdays: [1, 3, 6] },
  { flightNumber: "JQ28", departure: "Phuket (HKT)", arrival: "Sydney (SYD)", aircraft: "B788", departureTime: "21:05", durationMinutes: 525, weekdays: [1, 3, 6] },
  { flightNumber: "JQ500", departure: "Melbourne (MEL)", arrival: "Sydney (SYD)", aircraft: "A320", departureTime: "06:00", durationMinutes: 90, weekdays: [0, 1, 2, 3, 4, 5, 6] },
  { flightNumber: "JQ510", departure: "Melbourne (MEL)", arrival: "Sydney (SYD)", aircraft: "A20N", departureTime: "06:45", durationMinutes: 90, weekdays: [0, 1, 2, 3, 4, 5, 6] },
];

async function seed() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const existingFlights = await db.select({
    flightNumber: flightsTable.flightNumber,
    departure: flightsTable.departure,
    arrival: flightsTable.arrival,
    flightDate: flightsTable.flightDate,
    departureTime: flightsTable.departureTime,
  }).from(flightsTable);
  const existingKeys = new Set(existingFlights.map((flight) => [
    flight.flightNumber,
    flight.departure,
    flight.arrival,
    flight.flightDate,
    flight.departureTime,
  ].join("|")));

  let created = 0;
  for (let offset = 0; offset < 14; offset += 1) {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() + offset);
    const flightDate = day.toISOString().slice(0, 10);

    for (const route of routeSamples) {
      if (!route.weekdays.includes(day.getUTCDay())) continue;
      const key = [
        route.flightNumber,
        route.departure,
        route.arrival,
        flightDate,
        route.departureTime,
      ].join("|");
      if (existingKeys.has(key)) continue;

      await db.insert(flightsTable).values({
        flightNumber: route.flightNumber,
        departure: route.departure,
        arrival: route.arrival,
        aircraft: route.aircraft,
        departureTime: route.departureTime,
        flightDate,
        durationMinutes: route.durationMinutes,
      });
      existingKeys.add(key);
      created += 1;
    }
  }

  process.stdout.write(`Seeded ${created} Jetstar route examples.\n`);
  await pool.end();
}

seed().catch(async (error) => {
  process.stderr.write(`Jetstar route seed failed: ${String(error)}\n`);
  await pool.end();
  process.exitCode = 1;
});
