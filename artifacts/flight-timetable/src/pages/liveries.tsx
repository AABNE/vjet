import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { LIVERIES, FLEET_LABELS, type FleetCode, type SimVersion } from "@/data/liveries";
import { Download, ExternalLink, Plane, Palette } from "lucide-react";

const FLEET_ORDER: FleetCode[] = ["A320", "A20N", "A21N", "B788"];
const SIM_ORDER: SimVersion[] = ["MSFS 2024", "MSFS 2020", "MSFS 2020 & 2024"];

// Strong, distinct colours per sim version so nobody downloads the wrong one.
const SIM_STYLE: Record<SimVersion, { band: string; dot: string; text: string; rail: string }> = {
  "MSFS 2024": { band: "bg-emerald-50", dot: "bg-emerald-500", text: "text-emerald-700", rail: "border-l-emerald-400" },
  "MSFS 2020": { band: "bg-sky-50", dot: "bg-sky-500", text: "text-sky-700", rail: "border-l-sky-400" },
  "MSFS 2020 & 2024": { band: "bg-[#fff7f5]", dot: "bg-[#fb5713]", text: "text-[#fb5713]", rail: "border-l-[#fb5713]" },
};

export default function Liveries() {
  const { user } = useAuth();
  const fleet = useMemo(
    () => (user?.aircraft || []).filter((a): a is FleetCode => FLEET_ORDER.includes(a as FleetCode)),
    [user],
  );
  const [showAll, setShowAll] = useState(false);

  const visibleFleet = showAll || fleet.length === 0 ? FLEET_ORDER : FLEET_ORDER.filter(f => fleet.includes(f));

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Add-ons · flightsim.to</p>
          <h1 className="mt-2 text-5xl font-black uppercase leading-none tracking-tight text-[#1a1a1a] md:text-6xl">Liveries</h1>
          <p className="mt-3 max-w-xl text-sm text-[#6b7280]">
            Jetstar liveries for your assigned aircraft. Each one opens its flightsim.to page in a new tab.
          </p>
        </div>
        {fleet.length > 0 && (
          <button onClick={() => setShowAll(s => !s)}
            className="rounded-xl border border-[#e5e7eb] bg-white px-4 py-2.5 text-xs font-bold text-[#6b7280] transition hover:bg-[#f3f4f6]">
            {showAll ? "Show my fleet only" : "Show all aircraft"}
          </button>
        )}
      </div>

      {/* Sim-version legend — check this before downloading */}
      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[.16em] text-[#9ca3af]">Check your sim:</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />MSFS 2024
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-700">
          <span className="h-2 w-2 rounded-full bg-sky-500" />MSFS 2020
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff7f5] px-2.5 py-1 text-[11px] font-bold text-[#fb5713]">
          <span className="h-2 w-2 rounded-full bg-[#fb5713]" />Both
        </span>
        <span className="text-[11px] text-[#9ca3af]">— download only the colour that matches your simulator.</span>
      </div>

      {fleet.length > 0 && !showAll && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[.16em] text-[#9ca3af]">Your fleet:</span>
          {fleet.map(f => (
            <span key={f} className="rounded-full bg-[#fff7f5] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-[#fb5713]">{f}</span>
          ))}
        </div>
      )}

      {/* Fleet groups */}
      <div className="mt-6 space-y-10">
        {visibleFleet.map(f => {
          const addons = LIVERIES.filter(a => a.fleet === f);
          if (addons.length === 0) return null;
          return (
            <section key={f}>
              <div className="mb-3 flex items-center gap-2">
                <Plane className="h-4 w-4 text-[#fb5713]" />
                <h2 className="text-lg font-black uppercase tracking-tight text-[#1a1a1a]">{FLEET_LABELS[f]}</h2>
                <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-[#9ca3af]">{f}</span>
              </div>

              <div className="space-y-4">
                {addons.map(addon => (
                  <div key={addon.addon} className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
                    <div className="flex items-center gap-3 border-b border-[#f3f4f6] bg-[#f9fafb] px-5 py-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#fb5713] text-white">
                        <Palette className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-black uppercase tracking-tight text-[#1a1a1a]">{addon.addon}</h3>
                        <p className="font-mono text-[9px] uppercase tracking-wider text-[#9ca3af]">{addon.developer}</p>
                      </div>
                    </div>

                    {/* Entries grouped by sim version with a strong coloured band */}
                    {SIM_ORDER.map(sim => {
                      const entries = addon.entries.filter(e => e.sim === sim);
                      if (entries.length === 0) return null;
                      const st = SIM_STYLE[sim];
                      return (
                        <div key={sim}>
                          <div className={`flex items-center gap-2 px-5 py-2 ${st.band}`}>
                            <span className={`h-2.5 w-2.5 rounded-full ${st.dot}`} />
                            <span className={`font-mono text-[11px] font-black uppercase tracking-wider ${st.text}`}>{sim}</span>
                          </div>
                          <ul className="divide-y divide-[#f3f4f6]">
                            {entries.map((e, i) => (
                              <li key={i} className={`flex flex-col gap-3 border-l-4 ${st.rail} px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between`}>
                                <div className="min-w-0">
                                  {e.livery && <div className="text-xs font-bold text-[#1a1a1a]">{e.livery}</div>}
                                  <div className={`font-mono text-xs ${e.livery ? "mt-0.5 text-[#6b7280]" : "text-[#1a1a1a]"}`}>{e.registrations}</div>
                                </div>
                                <a href={e.url} target="_blank" rel="noopener noreferrer"
                                  className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#fb5713] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#e04d0e]">
                                  <Download className="h-4 w-4" />Download<ExternalLink className="h-3 w-3 opacity-70" />
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="mt-8 rounded-2xl border border-[#f3f4f6] bg-[#f9fafb] px-5 py-3 font-mono text-[9px] uppercase tracking-widest text-[#9ca3af]">
        Liveries are hosted on flightsim.to and maintained by their respective creators · Not affiliated with Jetstar Airways
      </div>
    </div>
  );
}
