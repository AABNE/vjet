import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

// Cached aviation weather, one row per ICAO. The backend refreshes these; pages
// and AI agents read from here rather than hitting the provider directly.
export const weatherReportsTable = pgTable("weather_reports", {
  icao: text("icao").primaryKey(),
  iata: text("iata"),
  name: text("name"),
  metarRaw: text("metar_raw"),
  metarJson: text("metar_json"),
  tafRaw: text("taf_raw"),
  observedAt: timestamp("observed_at", { withTimezone: true }),
  tafIssuedAt: timestamp("taf_issued_at", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  ok: boolean("ok").notNull().default(true),
});
export type WeatherReport = typeof weatherReportsTable.$inferSelect;
