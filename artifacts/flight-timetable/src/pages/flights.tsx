import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetAvailableFlightsQueryKey, getGetTimetableQueryKey, useGetAvailableFlights, useAddToTimetable } from "@workspace/api-client-react";
import { useAuth } from "@/components/auth-provider";
import { useHubStatus } from "@/hooks/useHubStatus";
import { Link } from "wouter";
import { DownloadCloud, MapPin, Plane, Plus, RotateCw, Search, X } from "lucide-react";

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
  const [customOpen, setCustomOpen] = useState(false);

  const q = useGetAvailableFlights({ query: { queryKey: getGetAvailableFlightsQueryKey(), refetchOnMount: "always", refetchInterval: 30_000 } });
  const add = useAddToTimetable({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetTimetableQueryKey() }); qc.invalidateQueries({ queryKey: getGetAvailableFlightsQueryKey() }); } } });
  const hub = useHubStatus();

  const all = q.data || [];
  const rows = useMemo(() =>
    all.filter(f =>
      (fleet === "All aircraft" || f.aircraft === fleet) &&
      `${f.flightNumber} ${f.departure} ${f.arrival} ${f.aircraft}`.toLowerCase().includes(search.toLowerCase())
    ), [all, fleet, search]);

  const airports = [...new Set(all.flatMap(f => [f.departure, f.arrival]))];

  return (
    <div className="mx-auto max-w-6xl">
      {hub.isSuccess && (hub.data?.required ?? true) && !hub.data?.connected && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-xs text-[#92400e]" role="status">
          <span className="font-bold">Heads up:</span>
          <span>you can add flights to plan ahead, but you'll need the vJetstar Sim Link desktop app open (with MSFS running) to actually start or get clearance for them.</span>
          <Link href="/software" className="ml-auto font-bold underline">Get the app</Link>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Jetstar network · today's schedule</p>
          <h1 className="mt-2 text-5xl font-black uppercase leading-none tracking-tight text-[#1a1a1a] md:text-6xl">Available routes</h1>
          <p className="mt-3 max-w-xl text-sm text-[#6b7280]">
            Today's routes across Australia and the Asia-Pacific. Routes refresh daily — pick one up before another pilot does.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-[#e5e7eb] bg-white px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-[#6b7280]">
            <MapPin className="h-4 w-4 text-[#fb5713]" />{airports.length} network airports
          </div>
          <button data-testid="button-custom-flight" onClick={() => setCustomOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-[#1a1a1a] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#333]">
            <Plus className="h-4 w-4" />Custom flight
          </button>
        </div>
      </div>

      {customOpen && (
        <CustomFlightModal
          fleet={user?.aircraft || []}
          onClose={() => setCustomOpen(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: getGetTimetableQueryKey() });
            qc.invalidateQueries({ queryKey: getGetAvailableFlightsQueryKey() });
            setCustomOpen(false);
          }}
        />
      )}

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
          {["A320", "A321", "A20N", "A21N", "B788"].map(a => <option key={a}>{a}</option>)}
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

// ─── Custom flight modal ─────────────────────────────────────────────────────
function CustomFlightModal({ fleet, onClose, onCreated }: {
  fleet: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [departure, setDeparture] = useState("");
  const [arrival, setArrival] = useState("");
  const [aircraft, setAircraft] = useState(fleet[0] || "A320");
  const [flightDate, setFlightDate] = useState(today);
  const [departureTime, setDepartureTime] = useState("12:00");
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [flightNumber, setFlightNumber] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [importing, setImporting] = useState(false);

  const importSimbrief = async () => {
    setError("");
    setImporting(true);
    try {
      const res = await fetch("/api/simbrief/plan", { credentials: "include" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || "Could not import from SimBrief."); return; }
      const b = d.briefing || {};
      if (b.originIcao || b.originIata) setDeparture((b.originIcao || b.originIata).toUpperCase());
      if (b.destIcao || b.destIata) setArrival((b.destIcao || b.destIata).toUpperCase());
      if (b.aircraftFleet && fleet.includes(b.aircraftFleet)) setAircraft(b.aircraftFleet);
      if (b.schedOutDate) setFlightDate(b.schedOutDate);
      if (b.schedOutTimeZ) setDepartureTime(b.schedOutTimeZ);
      if (b.eteMinutes) setDurationMinutes(Math.min(900, Math.max(10, Math.round(b.eteMinutes))));
      if (b.flightNumber) setFlightNumber(String(b.flightNumber).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8));
      if (b.aircraftFleet && !fleet.includes(b.aircraftFleet)) {
        setError(`Imported, but the SimBrief aircraft (${b.aircraftRaw || b.aircraftFleet}) isn't in your fleet — pick one of yours.`);
      }
    } catch {
      setError("Network error reaching SimBrief.");
    } finally {
      setImporting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const res = await fetch("/api/timetable/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ departure, arrival, aircraft, flightDate, departureTime, durationMinutes, flightNumber }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Could not create the flight.");
      } else {
        onCreated();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  };

  const label = "mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[.16em] text-[#6b7280]";
  const input = "h-10 w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm uppercase outline-none focus:border-[#fb5713]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-[#1a1a1a] px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <JetstarStar size={18} className="text-[#fb5713]" />
            <div>
              <h2 className="font-black uppercase tracking-tight">Custom flight</h2>
              <p className="mt-0.5 text-xs text-white/60">Fly your own route — it goes straight to your timetable.</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-white/40 transition hover:text-white/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 p-6">
          <button type="button" onClick={importSimbrief} disabled={importing} data-testid="button-import-simbrief"
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#fb5713] bg-[#fff7ed] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[#fb5713] transition hover:bg-[#ffeadf] disabled:opacity-50">
            <DownloadCloud className="h-4 w-4" />{importing ? "Importing…" : "Import from SimBrief"}
          </button>
          <p className="-mt-2 text-center text-[11px] text-[#9ca3af]">Pulls your latest SimBrief plan. You can tweak anything before adding.</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>From</label>
              <input value={departure} onChange={e => setDeparture(e.target.value.toUpperCase())} required maxLength={4}
                placeholder="YBBN" className={input} data-testid="input-custom-departure" />
            </div>
            <div>
              <label className={label}>To</label>
              <input value={arrival} onChange={e => setArrival(e.target.value.toUpperCase())} required maxLength={4}
                placeholder="YSSY" className={input} data-testid="input-custom-arrival" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Aircraft</label>
              <select value={aircraft} onChange={e => setAircraft(e.target.value)} className={input} data-testid="select-custom-aircraft">
                {(fleet.length ? fleet : ["A320"]).map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Flight no. <span className="text-[#c7ccd4]">(optional)</span></label>
              <input value={flightNumber} onChange={e => setFlightNumber(e.target.value.toUpperCase())} maxLength={8}
                placeholder="Auto" className={input} data-testid="input-custom-flightno" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={label}>Date</label>
              <input type="date" value={flightDate} onChange={e => setFlightDate(e.target.value)} required
                className={input + " !normal-case"} data-testid="input-custom-date" />
            </div>
            <div>
              <label className={label}>Dep (UTC)</label>
              <input type="time" value={departureTime} onChange={e => setDepartureTime(e.target.value)} required
                className={input + " !normal-case"} data-testid="input-custom-time" />
            </div>
            <div>
              <label className={label}>Duration</label>
              <div className="relative">
                <input type="number" min={10} max={900} value={durationMinutes}
                  onChange={e => setDurationMinutes(parseInt(e.target.value || "0", 10))} required
                  className={input + " !normal-case pr-10"} data-testid="input-custom-duration" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#9ca3af]">min</span>
              </div>
            </div>
          </div>

          {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-xl border border-[#e5e7eb] px-4 py-2.5 text-xs font-semibold text-[#6b7280] transition hover:bg-[#f3f4f6]">
              Cancel
            </button>
            <button type="submit" disabled={pending}
              className="flex items-center gap-2 rounded-xl bg-[#fb5713] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#e04d0e] disabled:opacity-50">
              <Plus className="h-4 w-4" />{pending ? "Adding…" : "Add to timetable"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
