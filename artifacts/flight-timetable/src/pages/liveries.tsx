import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { LIVERIES, FLEET_LABELS, type FleetCode } from "@/data/liveries";
import { Download, ExternalLink, Plane, Palette } from "lucide-react";

const FLEET_ORDER: FleetCode[] = ["A320", "A20N", "A21N", "B788"];

function SimBadge({ sim }: { sim: string }) {
  return (
    <span className="shrink-0 rounded-full border border-[#e5e7eb] px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-[#9ca3af]">
      {sim}
    </span>
  );
}

export default function Liveries() {
  const { user } = useAuth();
  const fleet = useMemo(() => (user?.aircraft || []).filter((a): a is FleetCode => FLEET_ORDER.includes(a as FleetCode)), [user]);
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
                    <ul className="divide-y divide-[#f3f4f6]">
                      {addon.entries.map((e, i) => (
                        <li key={i} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <SimBadge sim={e.sim} />
                              {e.livery && <span className="rounded-full bg-[#1a1a1a] px-2 py-0.5 text-[10px] font-bold text-white">{e.livery}</span>}
                            </div>
                            <div className="mt-1.5 font-mono text-xs text-[#1a1a1a]">{e.registrations}</div>
                          </div>
                          <a href={e.url} target="_blank" rel="noopener noreferrer"
                            className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#fb5713] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#e04d0e]">
                            <Download className="h-4 w-4" />Download<ExternalLink className="h-3 w-3 opacity-70" />
                          </a>
                        </li>
                      ))}
                    </ul>
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
