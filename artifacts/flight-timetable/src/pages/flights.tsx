import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetAvailableFlightsQueryKey, getGetTimetableQueryKey, useGetAvailableFlights, useAddToTimetable } from "@workspace/api-client-react";
import { useAuth } from "@/components/auth-provider";
import { MapPin, Plane, Plus, RotateCw, Search } from "lucide-react";

function JetstarStar({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className}>
      <polygon points="50,5 61,35 95,35 68,57 79,91 50,70 21,91 32,57 5,35 39,35" fill="currentColor" />
    </svg>
  );
}

function dur(mins: number) {
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function Flights() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [fleet, setFleet] = useState("All aircraft");

  const q = useGetAvailableFlights({ query: { queryKey: getGetAvailableFlightsQueryKey(), refetchOnMount: "always", refetchInterval: 30_000 } });
  const add = useAddToTimetable({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetTimetableQueryKey() }); qc.invalidateQueries({ queryKey: getGetAvailableFlightsQueryKey() }); } } });

  const all = q.data || [];
  const rows = useMemo(() =>
    all.filter(f =>
      (fleet === "All aircraft" || f.aircraft === fleet) &&
      `${f.flightNumber} ${f.departure} ${f.arrival} ${f.aircraft}`.toLowerCase().includes(search.toLowerCase())
    ), [all, fleet, search]);

  const airports = [...new Set(all.flatMap(f => [f.departure, f.arrival]))];

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Jetstar network · today's schedule</p>
          <h1 className="mt-2 text-5xl font-black uppercase leading-none tracking-tight text-[#1a1a1a] md:text-6xl">Available routes</h1>
          <p className="mt-3 max-w-xl text-sm text-[#6b7280]">
            Today's routes across Australia and the Asia-Pacific. Routes refresh daily — pick one up before another pilot does.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-[#e5e7eb] bg-white px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-[#6b7280]">
          <MapPin className="h-4 w-4 text-[#fb5713]" />{airports.length} network airports
        </div>
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-[#e5e7eb] bg-white p-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ca3af]" />
          <input data-testid="input-route-search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search flight number or airport…"
            className="h-11 w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb] pl-10 pr-3 text-sm text-[#1a1a1a] outline-none transition focus:border-[#fb5713] focus:ring-2 focus:ring-[#fb5713]/20" />
        </div>
        <select data-testid="select-route-aircraft" value={fleet} onChange={e => setFleet(e.target.value)}
          className="h-11 rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-xs font-semibold text-[#1a1a1a] outline-none focus:border-[#fb5713]">
          <option>All aircraft</option>
          {["A320", "A20N", "A21N", "B788"].map(a => <option key={a}>{a}</option>)}
        </select>
      </div>

      {/* States */}
      {q.isLoading ? (
        <div className="mt-5 space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-24 animate-pulse rounded-2xl bg-[#f3f4f6]" />)}</div>
      ) : q.isError ? (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-7" data-testid="status-routes-error">
          <p className="font-bold text-red-800">Route catalogue unavailable</p>
          <button data-testid="button-retry-routes" onClick={() => q.refetch()} className="mt-3 flex items-center gap-2 text-xs font-bold uppercase text-red-700">
            <RotateCw className="h-4 w-4" />Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-5 rounded-2xl border-2 border-dashed border-[#e5e7eb] bg-white p-14 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fb5713] text-white">
            <Plane className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-2xl font-black uppercase text-[#1a1a1a]">No routes available</h2>
          <p className="mt-2 text-sm text-[#6b7280]">{all.length ? "Try a different search or filter." : "All today's routes have been picked up. Check back tomorrow."}</p>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {rows.map(f => (
            <article key={f.id} data-testid={`row-route-${f.id}`}
              className="flex flex-col gap-4 rounded-2xl border border-[#e5e7eb] bg-white p-5 transition hover:border-[#fb5713]/30 md:flex-row md:items-center">
              {/* Flight + date */}
              <div className="min-w-[90px]">
                <div className="flex items-center gap-1.5">
                  <JetstarStar size={12} className="text-[#fb5713]" />
                  <span className="font-mono text-sm font-bold text-[#fb5713]" data-testid={`text-route-flight-${f.id}`}>{f.flightNumber}</span>
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[#9ca3af]">{f.flightDate}</div>
              </div>

              {/* Route */}
              <div className="flex flex-1 items-center gap-3">
                <div className="text-3xl font-black uppercase tracking-tight text-[#1a1a1a]">{f.departure}</div>
                <div className="flex flex-1 items-center gap-1 text-[#d1d5db]">
                  <div className="h-px flex-1 bg-[#e5e7eb]" />
                  <Plane className="h-4 w-4 -rotate-90 text-[#fb5713]" />
                  <div className="h-px flex-1 bg-[#e5e7eb]" />
                </div>
                <div className="text-3xl font-black uppercase tracking-tight text-[#1a1a1a]">{f.arrival}</div>
              </div>

              {/* Details */}
              <div className="flex items-center gap-6 font-mono text-xs text-[#6b7280]">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#9ca3af]">Dep</div>
                  <div className="font-semibold text-[#1a1a1a]">{f.departureTime.slice(0,5)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#9ca3af]">Block</div>
                  <div className="font-semibold text-[#1a1a1a]">{dur(f.durationMinutes)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#9ca3af]">Fleet</div>
                  <div className="rounded border border-[#e5e7eb] bg-[#f9fafb] px-2 py-0.5 text-[10px] font-bold text-[#1a1a1a]">{f.aircraft}</div>
                </div>
              </div>

              {/* CTA */}
              <button data-testid={`button-add-route-${f.id}`} disabled={add.isPending}
                onClick={() => add.mutate({ data: { flightId: f.id } })}
                className="flex items-center gap-2 rounded-xl bg-[#fb5713] px-5 py-3 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-[#e04d0e] disabled:opacity-50">
                <Plus className="h-4 w-4" />Pick up route
              </button>
            </article>
          ))}
          <div className="rounded-xl border border-[#f3f4f6] bg-[#f9fafb] px-5 py-3 font-mono text-[9px] uppercase tracking-widest text-[#9ca3af]">
            {rows.length} routes available · refreshes daily at midnight
          </div>
        </div>
      )}

      {add.error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert" data-testid="status-add-flight-error">
          {(add.error as any).message || "Could not add this sector."}
        </div>
      )}
    </div>
  );
}
