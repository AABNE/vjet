// Shared aviation weather service. Fetches METAR + TAF from AviationWeather.gov
// (free, keyless, covers Australian ICAOs) and caches them in the DB so pages
// and AI agents read from one place. Never presents stale data as live.
import { db, eq, weatherReportsTable } from "@workspace/db";
import { logger } from "./logger";

// IATA → ICAO for the airports in the VJetstar network (AviationWeather needs ICAO).
const IATA_ICAO: Record<string, string> = {
  BNE: "YBBN", OOL: "YBCG", CNS: "YBCS", TSV: "YBTL", MCY: "YBSU", PPP: "YBPN", MKY: "YBMK", ROK: "YBRK", HVB: "YHBA",
  SYD: "YSSY", NTL: "YWLM", BNK: "YBNA", CBR: "YSCB", WSI: "YSWS",
  MEL: "YMML", AVV: "YMAV", HBA: "YMHB", LST: "YMLT", ADL: "YPAD",
  DRW: "YPDN", AYQ: "YAYE", PER: "YPPH", BQB: "YBLN",
  AKL: "NZAA", WLG: "NZWN", CHC: "NZCH", ZQN: "NZQN", DUD: "NZDN", HLZ: "NZHN",
  DPS: "WADD", SIN: "WSSS", BKK: "VTBS", HKT: "VTSP", NRT: "RJAA", KIX: "RJBB",
  ICN: "RKSI", CMB: "VCBI", SGN: "VVTS", MNL: "RPLL", CEB: "RPVM",
  NAN: "NFFN", RAR: "NCRG", VLI: "NVVV",
};
const ICAO_IATA: Record<string, string> = Object.fromEntries(Object.entries(IATA_ICAO).map(([i, c]) => [c, i]));

export function toIcao(code: string): string | null {
  const c = (code || "").trim().toUpperCase();
  if (/^[A-Z]{4}$/.test(c)) return c;            // already ICAO
  if (/^[A-Z]{3}$/.test(c)) return IATA_ICAO[c] ?? null; // IATA → ICAO
  return null;
}

const FRESH_MS = 75 * 60_000;   // a METAR older than this is "stale"
const REFETCH_MS = 20 * 60_000; // don't re-hit the API more often than this

export type Freshness = "current" | "stale" | "unavailable";

export interface WeatherView {
  icao: string; iata: string | null; name: string | null;
  metarRaw: string | null; tafRaw: string | null;
  observedAt: string | null; tafIssuedAt: string | null; fetchedAt: string | null;
  freshness: Freshness;
  parsed: { windDir: string | null; windKt: number | null; gustKt: number | null; visibility: string | null; cloud: string | null; tempC: number | null; qnh: string | null; wx: string | null };
}

function parseMetar(raw: string | null, j: any): WeatherView["parsed"] {
  const p: WeatherView["parsed"] = { windDir: null, windKt: null, gustKt: null, visibility: null, cloud: null, tempC: null, qnh: null, wx: null };
  if (j) {
    if (typeof j.wdir === "number") p.windDir = String(j.wdir).padStart(3, "0");
    else if (j.wdir === "VRB") p.windDir = "VRB";
    if (typeof j.wspd === "number") p.windKt = j.wspd;
    if (typeof j.wgst === "number") p.gustKt = j.wgst;
    if (typeof j.temp === "number") p.tempC = Math.round(j.temp);
    if (j.wxString) p.wx = String(j.wxString);
    if (Array.isArray(j.clouds) && j.clouds.length) p.cloud = j.clouds.map((c: any) => `${c.cover}${c.base != null ? Math.round(c.base / 100).toString().padStart(3, "0") : ""}`).join(" ");
  }
  if (raw) {
    const q = raw.match(/\bQ(\d{4})\b/); if (q) p.qnh = `${q[1]} hPa`;
    else { const a = raw.match(/\bA(\d{4})\b/); if (a) p.qnh = `${(Number(a[1]) / 100).toFixed(2)} inHg`; }
    if (!p.windDir) { const w = raw.match(/\b(\d{3}|VRB)(\d{2})(G(\d{2}))?KT\b/); if (w) { p.windDir = w[1]; p.windKt = Number(w[2]); if (w[4]) p.gustKt = Number(w[4]); } }
    const v = raw.match(/\b(\d{4})\b(?!KT)/); if (v && !p.visibility) p.visibility = `${v[1]} m`;
    if (/\bCAVOK\b/.test(raw)) p.visibility = "CAVOK";
  }
  return p;
}

function freshnessOf(r: { observedAt: Date | null; ok: boolean; metarRaw: string | null }): Freshness {
  if (!r.ok || !r.metarRaw) return "unavailable";
  if (!r.observedAt) return "stale";
  return Date.now() - r.observedAt.getTime() < FRESH_MS ? "current" : "stale";
}

function view(r: typeof weatherReportsTable.$inferSelect): WeatherView {
  let j: any = null; try { j = r.metarJson ? JSON.parse(r.metarJson) : null; } catch { /* */ }
  return {
    icao: r.icao, iata: r.iata, name: r.name,
    metarRaw: r.metarRaw, tafRaw: r.tafRaw,
    observedAt: r.observedAt ? r.observedAt.toISOString() : null,
    tafIssuedAt: r.tafIssuedAt ? r.tafIssuedAt.toISOString() : null,
    fetchedAt: r.fetchedAt ? r.fetchedAt.toISOString() : null,
    freshness: freshnessOf(r),
    parsed: parseMetar(r.metarRaw, j),
  };
}

async function fetchFromProvider(icao: string): Promise<{ metarRaw: string | null; metarJson: any; observedAt: Date | null; name: string | null; tafRaw: string | null; tafIssuedAt: Date | null } | null> {
  try {
    const [mRes, tRes] = await Promise.all([
      fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`, { signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } }),
      fetch(`https://aviationweather.gov/api/data/taf?ids=${icao}&format=json`, { signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } }),
    ]);
    let metarRaw: string | null = null, metarJson: any = null, observedAt: Date | null = null, name: string | null = null;
    if (mRes.ok) {
      const arr = await mRes.json() as any[];
      const m = Array.isArray(arr) ? arr[0] : null;
      if (m) { metarRaw = m.rawOb ?? null; metarJson = m; name = m.name ?? null; if (m.obsTime) observedAt = new Date(m.obsTime * 1000); }
    }
    let tafRaw: string | null = null, tafIssuedAt: Date | null = null;
    if (tRes.ok) {
      const arr = await tRes.json() as any[];
      const t = Array.isArray(arr) ? arr[0] : null;
      if (t) { tafRaw = t.rawTAF ?? t.rawOb ?? null; if (t.issueTime) tafIssuedAt = new Date(t.issueTime * 1000); }
    }
    if (metarRaw == null && tafRaw == null) return null;
    return { metarRaw, metarJson, observedAt, name, tafRaw, tafIssuedAt };
  } catch (e) {
    logger.warn({ e, icao }, "weather provider fetch failed");
    return null;
  }
}

// Get weather for a code (IATA or ICAO). Serves cache unless it's older than
// REFETCH_MS, then refreshes from the provider. Returns null if the code can't
// be resolved to an ICAO.
export async function getWeather(code: string, force = false): Promise<WeatherView | null> {
  const icao = toIcao(code);
  if (!icao) return null;
  const [cached] = await db.select().from(weatherReportsTable).where(eq(weatherReportsTable.icao, icao));
  const stale = !cached || !cached.fetchedAt || (Date.now() - cached.fetchedAt.getTime() > REFETCH_MS);
  if (cached && !stale && !force) return view(cached);

  const fresh = await fetchFromProvider(icao);
  const iata = ICAO_IATA[icao] ?? (/^[A-Z]{3}$/.test(code.toUpperCase()) ? code.toUpperCase() : null);
  if (!fresh) {
    // Provider failed — keep serving the last cache (clearly labelled), else mark unavailable.
    if (cached) { await db.update(weatherReportsTable).set({ fetchedAt: new Date(), ok: false }).where(eq(weatherReportsTable.icao, icao)); return view({ ...cached, ok: false }); }
    await db.insert(weatherReportsTable).values({ icao, iata, ok: false }).onConflictDoUpdate({ target: weatherReportsTable.icao, set: { fetchedAt: new Date(), ok: false } });
    return view({ icao, iata, name: null, metarRaw: null, metarJson: null, tafRaw: null, observedAt: null, tafIssuedAt: null, fetchedAt: new Date(), ok: false });
  }
  const row = {
    icao, iata, name: fresh.name, metarRaw: fresh.metarRaw, metarJson: fresh.metarJson ? JSON.stringify(fresh.metarJson) : null,
    tafRaw: fresh.tafRaw, observedAt: fresh.observedAt, tafIssuedAt: fresh.tafIssuedAt, fetchedAt: new Date(), ok: true,
  };
  await db.insert(weatherReportsTable).values(row).onConflictDoUpdate({ target: weatherReportsTable.icao, set: row });
  return view(row as any);
}

export async function getMany(codes: string[]): Promise<Record<string, WeatherView>> {
  const unique = [...new Set(codes.map((c) => c.toUpperCase()).filter(Boolean))];
  const out: Record<string, WeatherView> = {};
  await Promise.all(unique.map(async (c) => { const w = await getWeather(c); if (w) { out[c] = w; } }));
  return out;
}

// Refresh the airports currently in use (called by the ops monitor).
export async function refreshAirports(codes: string[]): Promise<void> {
  const icaos = [...new Set(codes.map(toIcao).filter((x): x is string => !!x))];
  for (const icao of icaos) await getWeather(icao); // getWeather self-throttles via REFETCH_MS
}

// Adverse-conditions check for the weather watch (conservative).
export function isAdverse(w: WeatherView): { adverse: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const p = w.parsed;
  if (w.freshness === "current") {
    if (p.windKt != null && p.windKt >= 30) reasons.push(`wind ${p.windKt}kt`);
    if (p.gustKt != null && p.gustKt >= 35) reasons.push(`gusts ${p.gustKt}kt`);
    if (p.wx && /\b(TS|\+RA|\+SN|FZRA|GR|FC|\+)/.test(p.wx)) reasons.push(p.wx);
    if (p.visibility && /^\d+ m$/.test(p.visibility) && parseInt(p.visibility) <= 3000) reasons.push(`vis ${p.visibility}`);
  }
  return { adverse: reasons.length > 0, reasons };
}
