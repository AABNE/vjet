// Jetstar (JQ) route network — built from Jetstar's published route map and
// typical schedule. Used to generate the real daily timetable in the pilot hub.
//
// This is a realistic model of the actual network: the city pairs, aircraft
// types and rough frequencies/days reflect what Jetstar really flies. Exact
// published departure times and flight numbers for the whole network aren't
// publicly compilable, so times are spread realistically across the day and
// flight numbers are assigned deterministically — but routes, aircraft and
// days-of-operation mirror reality (some ports only see service on some days).
//
// Aircraft codes match the hub fleet: A320, A20N (A320neo), A21N (A321neo/LR),
// B788 (787-8).

// Day-of-week sets (0 = Sunday … 6 = Saturday), used for days-of-operation.
export const DAILY = [0, 1, 2, 3, 4, 5, 6];
const MON_WED_FRI = [1, 3, 5];
const TUE_THU_SAT = [2, 4, 6];
const MON_THU_SAT = [1, 4, 6];
const WED_FRI_SUN = [3, 5, 0];
const THU_SUN = [4, 0];
const FRI_MON = [5, 1];
const WEEKEND = [5, 6, 0];

// Airport → IANA timezone. Departure instants are computed in the origin's own
// timezone (handles AEST/AEDT, ACST, AWST, NZ, and Asia/Pacific zones + DST).
export const AIRPORT_TZ: Record<string, string> = {
  // Australia — Queensland (no DST)
  BNE: "Australia/Brisbane", OOL: "Australia/Brisbane", CNS: "Australia/Brisbane",
  TSV: "Australia/Brisbane", MCY: "Australia/Brisbane", PPP: "Australia/Brisbane",
  MKY: "Australia/Brisbane", ROK: "Australia/Brisbane", HVB: "Australia/Brisbane",
  HTI: "Australia/Brisbane", GLT: "Australia/Brisbane", EMD: "Australia/Brisbane",
  // Australia — NSW / ACT (DST)
  SYD: "Australia/Sydney", NTL: "Australia/Sydney", BNK: "Australia/Sydney",
  CBR: "Australia/Sydney", WSI: "Australia/Sydney", CFS: "Australia/Sydney",
  PQQ: "Australia/Sydney",
  // Australia — Victoria (DST)
  MEL: "Australia/Melbourne", AVV: "Australia/Melbourne",
  // Australia — Tasmania (DST)
  HBA: "Australia/Hobart", LST: "Australia/Hobart",
  // Australia — South Australia (DST, UTC+9:30)
  ADL: "Australia/Adelaide",
  // Australia — Northern Territory (no DST, UTC+9:30)
  DRW: "Australia/Darwin", AYQ: "Australia/Darwin", ASP: "Australia/Darwin",
  // Australia — Western Australia (UTC+8)
  PER: "Australia/Perth", BQB: "Australia/Perth",
  BME: "Australia/Perth", KTA: "Australia/Perth", PHE: "Australia/Perth", NTN: "Australia/Perth",
  // New Zealand (DST)
  AKL: "Pacific/Auckland", WLG: "Pacific/Auckland", CHC: "Pacific/Auckland",
  ZQN: "Pacific/Auckland", DUD: "Pacific/Auckland", HLZ: "Pacific/Auckland",
  // Asia
  DPS: "Asia/Makassar", SIN: "Asia/Singapore", BKK: "Asia/Bangkok", HKT: "Asia/Bangkok",
  NRT: "Asia/Tokyo", KIX: "Asia/Tokyo", ICN: "Asia/Seoul", CMB: "Asia/Colombo",
  SGN: "Asia/Ho_Chi_Minh", MNL: "Asia/Manila", CEB: "Asia/Manila",
  // Pacific
  NAN: "Pacific/Fiji", RAR: "Pacific/Rarotonga", VLI: "Pacific/Efate",
  HNL: "Pacific/Honolulu", NOU: "Pacific/Noumea",
};

// A city pair. Both directions are generated from it. `freq` is flights per day
// in EACH direction (spread across `window` local hours). `days` is which days
// of the week it operates (origin-local).
export interface RoutePair {
  a: string;
  b: string;
  ac: "A320" | "A20N" | "A21N" | "B788";
  durationMin: number;
  freq: number;
  days: number[];
  window?: [number, number]; // local hour range for departures; default [6, 21]
}

export const ROUTE_PAIRS: RoutePair[] = [
  // ── Domestic east-coast trunk (high frequency, daily) ──────────────────────
  { a: "SYD", b: "MEL", ac: "A320", durationMin: 95, freq: 12, days: DAILY },
  { a: "SYD", b: "MEL", ac: "A20N", durationMin: 95, freq: 3, days: DAILY },
  { a: "SYD", b: "BNE", ac: "A320", durationMin: 95, freq: 9, days: DAILY },
  { a: "SYD", b: "OOL", ac: "A320", durationMin: 85, freq: 8, days: DAILY },
  { a: "MEL", b: "BNE", ac: "A320", durationMin: 130, freq: 9, days: DAILY },
  { a: "MEL", b: "OOL", ac: "A320", durationMin: 130, freq: 7, days: DAILY },
  { a: "MEL", b: "ADL", ac: "A320", durationMin: 80, freq: 6, days: DAILY },
  { a: "SYD", b: "ADL", ac: "A320", durationMin: 140, freq: 5, days: DAILY },
  { a: "BNE", b: "ADL", ac: "A20N", durationMin: 165, freq: 3, days: DAILY },

  // ── Domestic to Tasmania ───────────────────────────────────────────────────
  { a: "MEL", b: "HBA", ac: "A320", durationMin: 75, freq: 6, days: DAILY },
  { a: "SYD", b: "HBA", ac: "A320", durationMin: 115, freq: 3, days: DAILY },
  { a: "MEL", b: "LST", ac: "A320", durationMin: 70, freq: 4, days: DAILY },
  { a: "SYD", b: "LST", ac: "A320", durationMin: 105, freq: 2, days: MON_WED_FRI },
  { a: "BNE", b: "HBA", ac: "A20N", durationMin: 175, freq: 1, days: TUE_THU_SAT },

  // ── Domestic — leisure Queensland ───────────────────────────────────────────
  { a: "SYD", b: "CNS", ac: "A320", durationMin: 180, freq: 4, days: DAILY },
  { a: "MEL", b: "CNS", ac: "A20N", durationMin: 215, freq: 3, days: DAILY },
  { a: "BNE", b: "CNS", ac: "A320", durationMin: 170, freq: 4, days: DAILY },
  { a: "SYD", b: "TSV", ac: "A320", durationMin: 165, freq: 2, days: DAILY },
  { a: "BNE", b: "TSV", ac: "A320", durationMin: 130, freq: 3, days: DAILY },
  { a: "SYD", b: "PPP", ac: "A320", durationMin: 150, freq: 1, days: TUE_THU_SAT },
  { a: "MEL", b: "PPP", ac: "A320", durationMin: 180, freq: 1, days: WED_FRI_SUN },
  { a: "SYD", b: "HVB", ac: "A320", durationMin: 110, freq: 1, days: MON_THU_SAT },
  { a: "SYD", b: "BNK", ac: "A320", durationMin: 85, freq: 2, days: DAILY },
  { a: "MEL", b: "BNK", ac: "A320", durationMin: 125, freq: 1, days: THU_SUN },
  { a: "SYD", b: "MCY", ac: "A320", durationMin: 95, freq: 3, days: DAILY },
  { a: "MEL", b: "MCY", ac: "A320", durationMin: 150, freq: 2, days: DAILY },
  { a: "BNE", b: "MKY", ac: "A320", durationMin: 115, freq: 1, days: WEEKEND },
  { a: "BNE", b: "ROK", ac: "A320", durationMin: 95, freq: 1, days: FRI_MON },

  // ── Domestic — cross-country (longer narrowbody) ────────────────────────────
  { a: "SYD", b: "PER", ac: "A21N", durationMin: 300, freq: 2, days: DAILY },
  { a: "MEL", b: "PER", ac: "A21N", durationMin: 265, freq: 3, days: DAILY },
  { a: "BNE", b: "PER", ac: "A21N", durationMin: 335, freq: 1, days: DAILY },
  { a: "ADL", b: "PER", ac: "A21N", durationMin: 215, freq: 2, days: DAILY },
  { a: "MEL", b: "DRW", ac: "A21N", durationMin: 265, freq: 1, days: TUE_THU_SAT },
  { a: "BNE", b: "DRW", ac: "A21N", durationMin: 215, freq: 1, days: MON_WED_FRI },
  { a: "ADL", b: "DRW", ac: "A21N", durationMin: 195, freq: 1, days: THU_SUN },
  { a: "SYD", b: "AYQ", ac: "A320", durationMin: 185, freq: 1, days: WED_FRI_SUN },
  { a: "MEL", b: "AYQ", ac: "A320", durationMin: 195, freq: 1, days: TUE_THU_SAT },
  { a: "ADL", b: "CNS", ac: "A20N", durationMin: 225, freq: 1, days: MON_WED_FRI },
  { a: "ADL", b: "OOL", ac: "A320", durationMin: 145, freq: 2, days: DAILY },
  { a: "OOL", b: "CNS", ac: "A320", durationMin: 140, freq: 1, days: TUE_THU_SAT },
  { a: "AVV", b: "SYD", ac: "A320", durationMin: 95, freq: 3, days: DAILY },
  { a: "AVV", b: "OOL", ac: "A320", durationMin: 135, freq: 2, days: DAILY },
  { a: "AVV", b: "ADL", ac: "A320", durationMin: 80, freq: 1, days: MON_THU_SAT },
  { a: "NTL", b: "MEL", ac: "A320", durationMin: 95, freq: 3, days: DAILY },
  { a: "NTL", b: "BNE", ac: "A320", durationMin: 95, freq: 2, days: DAILY },
  { a: "NTL", b: "OOL", ac: "A320", durationMin: 75, freq: 1, days: WEEKEND },
  { a: "CBR", b: "MEL", ac: "A320", durationMin: 65, freq: 2, days: DAILY },
  { a: "CBR", b: "BNE", ac: "A320", durationMin: 110, freq: 1, days: MON_WED_FRI },

  // ── New Zealand domestic (A320) ─────────────────────────────────────────────
  { a: "AKL", b: "CHC", ac: "A320", durationMin: 80, freq: 6, days: DAILY },
  { a: "AKL", b: "WLG", ac: "A320", durationMin: 65, freq: 5, days: DAILY },
  { a: "AKL", b: "ZQN", ac: "A320", durationMin: 110, freq: 3, days: DAILY },
  { a: "AKL", b: "DUD", ac: "A320", durationMin: 115, freq: 2, days: DAILY },
  { a: "CHC", b: "WLG", ac: "A320", durationMin: 55, freq: 4, days: DAILY },
  { a: "CHC", b: "ZQN", ac: "A320", durationMin: 60, freq: 2, days: DAILY },
  { a: "CHC", b: "HLZ", ac: "A320", durationMin: 95, freq: 1, days: MON_WED_FRI },
  { a: "WLG", b: "ZQN", ac: "A320", durationMin: 75, freq: 1, days: THU_SUN },

  // ── Trans-Tasman (A320 / A20N) ──────────────────────────────────────────────
  { a: "AKL", b: "SYD", ac: "A20N", durationMin: 215, freq: 3, days: DAILY },
  { a: "AKL", b: "MEL", ac: "A20N", durationMin: 245, freq: 2, days: DAILY },
  { a: "AKL", b: "BNE", ac: "A20N", durationMin: 225, freq: 2, days: DAILY },
  { a: "AKL", b: "OOL", ac: "A320", durationMin: 220, freq: 1, days: DAILY },
  { a: "CHC", b: "SYD", ac: "A20N", durationMin: 205, freq: 2, days: DAILY },
  { a: "CHC", b: "MEL", ac: "A320", durationMin: 225, freq: 1, days: DAILY },
  { a: "CHC", b: "OOL", ac: "A320", durationMin: 220, freq: 1, days: TUE_THU_SAT },
  { a: "ZQN", b: "SYD", ac: "A20N", durationMin: 215, freq: 1, days: DAILY },
  { a: "ZQN", b: "MEL", ac: "A320", durationMin: 230, freq: 1, days: WED_FRI_SUN },
  { a: "ZQN", b: "OOL", ac: "A320", durationMin: 220, freq: 1, days: THU_SUN },
  { a: "DUD", b: "OOL", ac: "A320", durationMin: 230, freq: 1, days: FRI_MON },
  { a: "HLZ", b: "OOL", ac: "A320", durationMin: 225, freq: 1, days: WEEKEND },

  // ── International — Bali (A21N / B788) ───────────────────────────────────────
  { a: "SYD", b: "DPS", ac: "A21N", durationMin: 375, freq: 2, days: DAILY },
  { a: "MEL", b: "DPS", ac: "B788", durationMin: 375, freq: 2, days: DAILY },
  { a: "BNE", b: "DPS", ac: "A21N", durationMin: 365, freq: 1, days: DAILY },
  { a: "OOL", b: "DPS", ac: "A21N", durationMin: 365, freq: 1, days: MON_WED_FRI },
  { a: "ADL", b: "DPS", ac: "A21N", durationMin: 345, freq: 1, days: TUE_THU_SAT },
  { a: "PER", b: "DPS", ac: "A320", durationMin: 215, freq: 3, days: DAILY },
  { a: "CNS", b: "DPS", ac: "A21N", durationMin: 280, freq: 1, days: WED_FRI_SUN },
  { a: "DRW", b: "DPS", ac: "A21N", durationMin: 165, freq: 1, days: THU_SUN },

  // ── International — SE Asia (A21N / B788) ────────────────────────────────────
  { a: "MEL", b: "SIN", ac: "B788", durationMin: 470, freq: 1, days: DAILY },
  { a: "MEL", b: "BKK", ac: "B788", durationMin: 555, freq: 1, days: DAILY },
  { a: "PER", b: "BKK", ac: "A21N", durationMin: 405, freq: 1, days: MON_THU_SAT },
  { a: "MEL", b: "HKT", ac: "B788", durationMin: 540, freq: 1, days: TUE_THU_SAT },
  { a: "PER", b: "HKT", ac: "A21N", durationMin: 400, freq: 1, days: WED_FRI_SUN },
  { a: "SYD", b: "SGN", ac: "B788", durationMin: 545, freq: 1, days: MON_WED_FRI },
  { a: "MEL", b: "SGN", ac: "B788", durationMin: 560, freq: 1, days: THU_SUN },

  // ── International — North Asia (B788) ────────────────────────────────────────
  { a: "BNE", b: "NRT", ac: "B788", durationMin: 585, freq: 1, days: DAILY },
  { a: "CNS", b: "NRT", ac: "B788", durationMin: 435, freq: 1, days: TUE_THU_SAT },
  { a: "BNE", b: "KIX", ac: "B788", durationMin: 540, freq: 1, days: MON_WED_FRI },
  { a: "CNS", b: "KIX", ac: "B788", durationMin: 420, freq: 1, days: WED_FRI_SUN },
  { a: "BNE", b: "ICN", ac: "B788", durationMin: 600, freq: 1, days: THU_SUN },

  // ── International — Sri Lanka / Pacific (B788 / A21N) ─────────────────────────
  { a: "MEL", b: "CMB", ac: "B788", durationMin: 760, freq: 1, days: FRI_MON },
  { a: "SYD", b: "RAR", ac: "B788", durationMin: 360, freq: 1, days: WEEKEND },
  { a: "SYD", b: "NAN", ac: "A21N", durationMin: 240, freq: 1, days: DAILY },
  { a: "MEL", b: "NAN", ac: "A21N", durationMin: 300, freq: 1, days: TUE_THU_SAT },
  { a: "SYD", b: "VLI", ac: "A21N", durationMin: 185, freq: 1, days: MON_THU_SAT },
  { a: "BNE", b: "VLI", ac: "A21N", durationMin: 175, freq: 1, days: WED_FRI_SUN },

  // ── Domestic — more east-coast + regional connections ───────────────────────
  { a: "BNE", b: "OOL", ac: "A320", durationMin: 45, freq: 2, days: DAILY },
  { a: "SYD", b: "CBR", ac: "A320", durationMin: 50, freq: 2, days: MON_WED_FRI },
  { a: "MEL", b: "SYD", ac: "A20N", durationMin: 95, freq: 4, days: DAILY },
  { a: "BNE", b: "MEL", ac: "A20N", durationMin: 130, freq: 3, days: DAILY },
  { a: "SYD", b: "CFS", ac: "A320", durationMin: 75, freq: 2, days: DAILY },
  { a: "MEL", b: "CFS", ac: "A320", durationMin: 120, freq: 1, days: THU_SUN },
  { a: "BNE", b: "LST", ac: "A320", durationMin: 165, freq: 1, days: WED_FRI_SUN },
  { a: "BNE", b: "HBA", ac: "A320", durationMin: 175, freq: 1, days: DAILY },
  { a: "SYD", b: "MKY", ac: "A320", durationMin: 130, freq: 1, days: MON_THU_SAT },
  { a: "BNE", b: "GLT", ac: "A320", durationMin: 80, freq: 1, days: MON_WED_FRI },
  { a: "BNE", b: "EMD", ac: "A320", durationMin: 95, freq: 1, days: TUE_THU_SAT },
  { a: "SYD", b: "PQQ", ac: "A320", durationMin: 95, freq: 1, days: FRI_MON },

  // ── Domestic — Whitsundays / leisure Queensland ─────────────────────────────
  { a: "SYD", b: "HTI", ac: "A320", durationMin: 150, freq: 1, days: DAILY },
  { a: "MEL", b: "HTI", ac: "A320", durationMin: 185, freq: 1, days: WED_FRI_SUN },
  { a: "BNE", b: "HTI", ac: "A320", durationMin: 110, freq: 1, days: WEEKEND },
  { a: "MEL", b: "TSV", ac: "A20N", durationMin: 205, freq: 1, days: TUE_THU_SAT },
  { a: "MEL", b: "OOL", ac: "A20N", durationMin: 130, freq: 3, days: DAILY },

  // ── Domestic — central Australia / outback ──────────────────────────────────
  { a: "ADL", b: "ASP", ac: "A320", durationMin: 120, freq: 1, days: MON_WED_FRI },
  { a: "MEL", b: "ASP", ac: "A320", durationMin: 180, freq: 1, days: THU_SUN },
  { a: "BNE", b: "ASP", ac: "A320", durationMin: 180, freq: 1, days: WEEKEND },
  { a: "ADL", b: "AYQ", ac: "A320", durationMin: 125, freq: 1, days: TUE_THU_SAT },

  // ── Western Australia — intrastate ──────────────────────────────────────────
  { a: "PER", b: "BME", ac: "A320", durationMin: 165, freq: 1, days: DAILY },
  { a: "PER", b: "KTA", ac: "A320", durationMin: 140, freq: 1, days: MON_WED_FRI },
  { a: "PER", b: "PHE", ac: "A320", durationMin: 150, freq: 1, days: TUE_THU_SAT },
  { a: "PER", b: "NTN", ac: "A320", durationMin: 60, freq: 1, days: WEEKEND },
  { a: "PER", b: "ADL", ac: "A21N", durationMin: 215, freq: 2, days: DAILY },

  // ── More trans-Tasman + NZ connections ──────────────────────────────────────
  { a: "AKL", b: "ADL", ac: "A20N", durationMin: 250, freq: 1, days: WED_FRI_SUN },
  { a: "WLG", b: "SYD", ac: "A20N", durationMin: 200, freq: 1, days: DAILY },
  { a: "WLG", b: "MEL", ac: "A320", durationMin: 235, freq: 1, days: TUE_THU_SAT },
  { a: "ZQN", b: "BNE", ac: "A20N", durationMin: 215, freq: 1, days: THU_SUN },

  // ── International — Bali / SE Asia additions ────────────────────────────────
  { a: "PER", b: "SIN", ac: "A21N", durationMin: 320, freq: 1, days: DAILY },
  { a: "DRW", b: "SIN", ac: "A21N", durationMin: 275, freq: 1, days: MON_THU_SAT },
  { a: "BNE", b: "SIN", ac: "B788", durationMin: 500, freq: 1, days: WED_FRI_SUN },
  { a: "ADL", b: "SIN", ac: "A21N", durationMin: 385, freq: 1, days: TUE_THU_SAT },
  { a: "PER", b: "DRW", ac: "A21N", durationMin: 215, freq: 1, days: THU_SUN },

  // ── International — Pacific / Hawaii ─────────────────────────────────────────
  { a: "SYD", b: "HNL", ac: "B788", durationMin: 585, freq: 1, days: WED_FRI_SUN },
  { a: "MEL", b: "HNL", ac: "B788", durationMin: 640, freq: 1, days: THU_SUN },
  { a: "SYD", b: "NOU", ac: "A21N", durationMin: 165, freq: 1, days: MON_THU_SAT },
  { a: "BNE", b: "NAN", ac: "A21N", durationMin: 215, freq: 1, days: DAILY },
  { a: "MEL", b: "RAR", ac: "B788", durationMin: 420, freq: 1, days: WEEKEND },
];
