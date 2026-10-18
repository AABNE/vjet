// Shared SimBrief OFP fetcher/parser. Pulls a pilot's latest generated plan and
// turns it into a briefing used for custom-flight prefill and the dispatch
// briefing. (The /simbrief/import route keeps its own copy for adding flights.)

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}
function text(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}
function firstText(src: JsonObject, ...keys: string[]): string | undefined {
  for (const k of keys) { const v = text(src[k]); if (v) return v; }
  return undefined;
}
function num(value: unknown): number | undefined {
  const t = text(value);
  if (!t) return undefined;
  const n = Number(t.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
function asDate(value: unknown): Date | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000);
  if (/^\d{13}$/.test(raw)) return new Date(Number(raw));
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function mapAircraft(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const code = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (["A320", "A320200", "A319", "A318"].includes(code)) return "A320";
  if (["A20N", "A320N", "A320NEO"].includes(code)) return "A20N";
  if (["A21N", "A321", "A321NEO", "A321LR", "A321NEOLR"].includes(code)) return "A21N";
  if (["B788", "B7878", "7878", "B789", "B78X"].includes(code)) return "B788";
  return undefined;
}

function eteMinutes(times: JsonObject, general: JsonObject): number | undefined {
  const secs = num(times.est_time_enroute) ?? num(times.sched_time_enroute);
  if (secs && secs > 30) return Math.round(secs / 60); // SimBrief gives seconds
  const raw = firstText(times, "est_enroute", "sched_enroute") ?? firstText(general, "time_enroute");
  if (raw) {
    const colon = raw.match(/^(\d{1,3}):(\d{2})$/);
    if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
    const hhmm = raw.match(/^(\d{1,3})(\d{2})$/);
    if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2]);
  }
  return undefined;
}

export interface SimbriefBriefing {
  flightNumber?: string;
  callsign?: string;
  originIata?: string;
  originIcao?: string;
  originName?: string;
  destIata?: string;
  destIcao?: string;
  destName?: string;
  aircraftRaw?: string;
  aircraftFleet?: string; // mapped fleet code, if it maps to our fleet
  route?: string;
  routeDistanceNm?: number;
  initialAltitude?: string;
  cruise?: string;
  costIndex?: string;
  eteMinutes?: number;
  schedOutIso?: string;
  schedOutDate?: string; // YYYY-MM-DD (UTC)
  schedOutTimeZ?: string; // HH:MM (UTC)
  fuelUnits?: string;
  fuelRamp?: number;
  fuelBurn?: number;
  paxCount?: string;
  zfw?: number;
  tow?: number;
  origMetar?: string;
  destMetar?: string;
}

export class SimbriefError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function fetchSimbriefBriefing(username: string): Promise<SimbriefBriefing> {
  const url = new URL("https://www.simbrief.com/api/xml.fetcher.php");
  // SimBrief's fetcher takes either a text username or the numeric Pilot ID —
  // pilots often paste the numeric one, so detect it and use the right param.
  const id = username.trim();
  if (/^\d+$/.test(id)) url.searchParams.set("userid", id);
  else url.searchParams.set("username", id);
  url.searchParams.set("json", "1");

  let payload: JsonObject;
  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new SimbriefError(
        response.status === 400 ? 400 : 502,
        response.status === 400
          ? `SimBrief has no current plan for "${username}". Generate a flight on SimBrief first, or check the username in Pilot Settings.`
          : "SimBrief is temporarily unavailable. Try again shortly.",
      );
    }
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("<")) {
      // Empty, or XML/HTML error page — usually an unknown username.
      throw new SimbriefError(400, `SimBrief didn't return a plan for "${username}". Check your SimBrief username in Pilot Settings and generate a flight there first.`);
    }
    try {
      payload = object(JSON.parse(trimmed));
    } catch {
      throw new SimbriefError(502, "SimBrief returned an unexpected response. Try again shortly.");
    }
  } catch (e) {
    if (e instanceof SimbriefError) throw e;
    throw new SimbriefError(502, "Could not reach SimBrief. Try again shortly.");
  }

  const fetchInfo = object(payload.fetch);
  if (firstText(fetchInfo, "status")?.toLowerCase() === "error") {
    throw new SimbriefError(400, "SimBrief has no current flight plan for that username.");
  }

  const general = object(payload.general);
  const times = object(payload.times);
  const origin = object(payload.origin);
  const destination = object(payload.destination);
  const fuel = object(payload.fuel);
  const weights = object(payload.weights);
  const params = object(payload.params);
  const weather = object(payload.weather);
  const aircraft = object(payload.aircraft);
  const atc = object(payload.atc);

  const schedOut = asDate(times.sched_out) ?? asDate(times.est_out);

  const ac = firstText(aircraft, "icao_code", "base_type", "name") ?? firstText(general, "icao_aircraft");

  return {
    flightNumber: firstText(general, "flight_number") ?? firstText(atc, "callsign"),
    callsign: firstText(atc, "callsign") ?? firstText(general, "icao_airline"),
    originIata: firstText(origin, "iata_code", "iata"),
    originIcao: firstText(origin, "icao_code", "icao") ?? firstText(general, "origin"),
    originName: firstText(origin, "name"),
    destIata: firstText(destination, "iata_code", "iata"),
    destIcao: firstText(destination, "icao_code", "icao") ?? firstText(general, "destination"),
    destName: firstText(destination, "name"),
    aircraftRaw: ac,
    aircraftFleet: mapAircraft(ac),
    route: firstText(general, "route"),
    routeDistanceNm: num(general.route_distance) ?? num(general.air_distance),
    initialAltitude: firstText(general, "initial_altitude", "stepclimb_string"),
    cruise: firstText(general, "cruise_mach", "cruise_tas"),
    costIndex: firstText(general, "costindex"),
    eteMinutes: eteMinutes(times, general),
    schedOutIso: schedOut?.toISOString(),
    schedOutDate: schedOut?.toISOString().slice(0, 10),
    schedOutTimeZ: schedOut?.toISOString().slice(11, 16),
    fuelUnits: firstText(params, "units"),
    fuelRamp: num(fuel.plan_ramp),
    fuelBurn: num(fuel.enroute_burn),
    paxCount: firstText(weights, "pax_count_actual", "pax_count"),
    zfw: num(weights.est_zfw),
    tow: num(weights.est_tow),
    origMetar: firstText(weather, "orig_metar"),
    destMetar: firstText(weather, "dest_metar"),
  };
}
