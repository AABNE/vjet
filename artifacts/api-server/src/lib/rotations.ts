// Rotation (tail) assignment. Given the day's scheduled flights and the
// available fleet per type, assigns a registration to each flight so that each
// tail flies a CONNECTED rotation: a tail only continues from the airport it's
// currently at, with at least a 30-minute turnaround. That's exactly how tails
// are rostered, so it yields chains like VH-A5A: BNE-MEL, MEL-ADL, ADL-SYD,
// SYD-BNE. Wide-bodies (787) are capped at 2 sectors per day.
//
// Deterministic for a given input, so re-running produces stable assignments.

export interface RotFlight {
  key: string;
  departure: string;
  arrival: string;
  aircraft: string;      // fleet type code
  departsAtMs: number;
  durationMin: number;
  flightDate: string;
}

const TURNAROUND_MS = 30 * 60_000;
const WIDEBODY = new Set(["B788"]);
const WIDEBODY_MAX_SECTORS = 2; // per tail per day

interface TailState { reg: string; at: string | null; freeAtMs: number; dayCount: Record<string, number>; }

// Returns flightKey → registration. Flights that can't be covered are omitted
// (caller shows TBA).
export function assignRotations(flights: RotFlight[], fleetByType: Record<string, string[]>): Map<string, string> {
  const out = new Map<string, string>();
  const byType: Record<string, RotFlight[]> = {};
  for (const f of flights) (byType[f.aircraft] ??= []).push(f);

  for (const [type, list] of Object.entries(byType)) {
    const pool = fleetByType[type] ?? [];
    if (pool.length === 0) continue; // no tails → TBA
    const states: TailState[] = pool.map((reg) => ({ reg, at: null, freeAtMs: -Infinity, dayCount: {} }));
    const isWide = WIDEBODY.has(type);
    // Stable order: by departure instant, then flight key.
    list.sort((a, b) => a.departsAtMs - b.departsAtMs || a.key.localeCompare(b.key));

    for (const f of list) {
      const cap = isWide ? WIDEBODY_MAX_SECTORS : Infinity;
      const underCap = (s: TailState) => (s.dayCount[f.flightDate] ?? 0) < cap;

      // 1) A tail already at this airport, free in time → continue its rotation.
      let pick: TailState | undefined = states
        .filter((s) => s.at === f.departure && s.freeAtMs + TURNAROUND_MS <= f.departsAtMs && underCap(s))
        .sort((a, b) => b.freeAtMs - a.freeAtMs)[0]; // most-recently-arrived first (tight rotation)

      // 2) Otherwise start a fresh rotation on an idle tail (begins its day here).
      if (!pick) pick = states.find((s) => s.at === null && underCap(s));

      // 3) Otherwise reuse any free tail (repositioned overnight / earlier).
      if (!pick) pick = states.filter((s) => s.freeAtMs + TURNAROUND_MS <= f.departsAtMs && underCap(s)).sort((a, b) => a.freeAtMs - b.freeAtMs)[0];

      if (!pick) continue; // leave TBA

      out.set(f.key, pick.reg);
      pick.at = f.arrival;
      pick.freeAtMs = f.departsAtMs + f.durationMin * 60_000;
      pick.dayCount[f.flightDate] = (pick.dayCount[f.flightDate] ?? 0) + 1;
    }
  }
  return out;
}
