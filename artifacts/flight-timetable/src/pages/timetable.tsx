import { useQueryClient, useQuery } from "@tanstack/react-query";
import { getGetTimetableQueryKey, useGetTimetable, useStartFlight, useFinishFlight, useRemoveFromTimetable } from "@workspace/api-client-react";
import { useAuth } from "@/components/auth-provider";
import { useSimLink } from "@/hooks/useSimLink";
import { useHubStatus } from "@/hooks/useHubStatus";
import { apiGet, apiPost } from "@/lib/api";
import { AlertTriangle, ArrowRight, Clock3, ExternalLink, Plane, Radio, RotateCw, Wind, Users } from "lucide-react";
import { Link, useLocation } from "wouter";

interface WeatherView { icao: string; iata: string | null; freshness: string; metarRaw: string | null; parsed: { windDir: string | null; windKt: number | null; gustKt: number | null; visibility: string | null; qnh: string | null; wx: string | null } }
const WX_DOT: Record<string, string> = { current: "bg-emerald-500", stale: "bg-amber-500", unavailable: "bg-[#d1d5db]" };

function WxChip({ code, wx }: { code: string; wx?: WeatherView }) {
  if (!wx) return <span className="font-mono text-[10px] text-[#c7ccd4]">{code} —</span>;
  const p = wx.parsed;
  const summary = wx.freshness === "unavailable" ? "no data"
    : [p.windDir && p.windKt != null ? `${p.windDir}/${p.windKt}${p.gustKt ? `G${p.gustKt}` : ""}kt` : null, p.visibility, p.qnh].filter(Boolean).join(" · ") || "—";
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#6b7280]" title={wx.metarRaw || ""}>
      <span className={`h-1.5 w-1.5 rounded-full ${WX_DOT[wx.freshness] ?? "bg-[#d1d5db]"}`} />{code} {summary}{wx.freshness === "stale" ? " (stale)" : ""}
    </span>
  );
}

function JetstarStar({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className}>
      <polygon points="50,5 61,35 95,35 68,57 79,91 50,70 21,91 32,57 5,35 39,35" fill="currentColor" />
    </svg>
  );
}

const statusStyle = (s: string) =>
  s.toLowerCase() === "active"
    ? "bg-green-100 text-green-700"
    : s.toLowerCase() === "completed"
    ? "bg-[#f3f4f6] text-[#6b7280]"
    : s.toLowerCase() === "flagged"
    ? "bg-yellow-100 text-yellow-700"
    : "bg-[#fff7ed] text-[#fb5713]";

const fmt = (v: string) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v.slice(0, 5) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

function simbriefUrl(entry: any, simbriefId: string | null) {
  if (!simbriefId) return null;
  // Build SimBrief pre-fill URL
  const params = new URLSearchParams({
    airline: "JST",
    fltnum: entry.flight.flightNumber.replace(/^JQ/i, ""),
    type: entry.flight.aircraft,
    orig: entry.flight.departure,
    dest: entry.flight.arrival,
    date: entry.flight.flightDate?.replace(/-/g, "") || "",
    deph: entry.flight.departureTime?.slice(0, 2) || "",
    depm: entry.flight.departureTime?.slice(3, 5) || "",
    pilotid: simbriefId,
  });
  return `https://dispatch.simbrief.com/options/custom?${params.toString()}`;
}

function EmptyState() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-[#e5e7eb] bg-white p-14 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fb5713] text-white">
        <Plane className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-2xl font-black uppercase text-[#1a1a1a]">Nothing on your board</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-[#6b7280]">Head to Available Routes and pick up a sector for today.</p>
      <Link href="/flights" data-testid="link-empty-routes"
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#fb5713] px-5 py-3 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-[#e04d0e]">
        Browse routes <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

export default function Timetable() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const simbriefId = (user as any)?.simbriefUsername || null;

  const q = useGetTimetable({ query: { queryKey: getGetTimetableQueryKey(), refetchOnMount: "always" } });
  const inv = () => qc.invalidateQueries({ queryKey: getGetTimetableQueryKey() });
  const start = useStartFlight({ mutation: { onSuccess: inv } });
  const finish = useFinishFlight({ mutation: { onSuccess: inv } });
  const remove = useRemoveFromTimetable({ mutation: { onSuccess: inv } });

  const entries = q.data || [];
  const active = entries.find(e => e.status.toLowerCase() === "active");
  const upcoming = entries.filter(e => e.status.toLowerCase() !== "completed" && e.status.toLowerCase() !== "flagged");
  const completed = entries.filter(e => e.status.toLowerCase() === "completed");
  const flagged = entries.filter(e => e.status.toLowerCase() === "flagged");
  const err = q.error as any;

  // Assigned registrations + weather for this pilot's open sectors.
  const openCodes = [...new Set(upcoming.flatMap(e => [e.flight.departure, e.flight.arrival]))];
  const asg = useQuery<{ assignments: Record<number, { registration: string; type: string } | null> }>({
    queryKey: ["asg-mine"], queryFn: () => apiGet("/api/ops/assignments/mine"), retry: false, refetchOnMount: "always",
  });
  const wx = useQuery<{ reports: Record<string, WeatherView> }>({
    queryKey: ["wx", openCodes.join(",")], queryFn: () => apiGet(`/api/ops/weather?codes=${openCodes.join(",")}`),
    enabled: openCodes.length > 0, retry: false, refetchInterval: 15 * 60_000,
  });
  const regFor = (id: number) => asg.data?.assignments?.[id]?.registration ?? null;
  const wxFor = (code: string) => wx.data?.reports?.[code.toUpperCase()];

  // ── Auto flight timer status (desktop app only) ──
  // The firing logic lives in the app-wide <AutoFlightTimer>: when the Sim Link
  // desktop app is connected to MSFS, the timer starts when the aircraft first
  // rolls from the gate and finishes once it's flown and parked again. Here we
  // just surface what it's doing. Without the app, the manual buttons do it.
  const { isApp, connected, position } = useSimLink();
  const hub = useHubStatus();
  const hubConnected = hub.data?.connected ?? false;
  const [, navigate] = useLocation();
  const [cockpitBusy, setCockpitBusy] = useState<number | null>(null);
  async function startCockpit(timetableId: number) {
    setCockpitBusy(timetableId);
    try { const r = await apiPost<{ code: string }>("/api/cockpit/create", { timetableId }); navigate(`/cockpit/${r.code}`); }
    catch (e: any) { window.alert(e?.message || "Couldn't start a shared cockpit."); }
    finally { setCockpitBusy(null); }
  }
  const moving = (position?.groundSpeedKt ?? 0) > 1;
  const autoMode = Boolean(isApp && connected);

  // The flight the brake controls: the active one, else the earliest pending
  // (same choice <AutoFlightTimer> makes).
  const nextPending = [...entries]
    .filter(e => e.status.toLowerCase() === "pending")
    .sort((a, b) =>
      `${a.flight.flightDate} ${a.flight.departureTime}`.localeCompare(`${b.flight.flightDate} ${b.flight.departureTime}`),
    )[0];
  const autoEntryId = autoMode ? (active?.id ?? nextPending?.id) : undefined;

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Pilot dispatch · flight desk</p>
          <h1 className="mt-2 text-5xl font-black uppercase leading-none tracking-tight text-[#1a1a1a] md:text-6xl">My timetable</h1>
          <p className="mt-3 text-sm text-[#6b7280]">Your scheduled and active sectors.</p>
        </div>
        {!simbriefId && (
          <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-xs text-[#92400e]" data-testid="status-simbrief-hint">
            Add your SimBrief Pilot ID in{" "}
            <Link href="/settings" className="font-bold underline" data-testid="link-simbrief-settings">Pilot settings</Link>
            {" "}to enable one-click SimBrief dispatch.
          </div>
        )}
      </div>

      {/* Pilot hub not detected — flights can't be started / cleared */}
      {hub.isSuccess && !hubConnected && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-xs text-[#92400e]" role="status">
          <span className="font-bold">Pilot hub not detected.</span>
          <span>You need the vJetstar Sim Link desktop app open (with MSFS running) to start a flight or get clearance.</span>
          <Link href="/software" className="ml-auto font-bold underline">Get the app</Link>
        </div>
      )}

      {/* Errors */}
      {(start.error || finish.error || remove.error) && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert" data-testid="status-flight-action-error">
          {((start.error || finish.error || remove.error) as any)?.message || "Flight update failed."}
        </div>
      )}

      {/* Auto-timer status (desktop app only) */}
      {autoMode && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3" data-testid="status-auto-timer">
          <span className="inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-[#1a1a1a]">
            <span className={`h-2.5 w-2.5 rounded-full ${!position ? "bg-[#d8a33a]" : moving ? "bg-green-500" : "bg-[#9ca3af]"}`} />
            {!position ? "Waiting for MSFS" : moving ? "Aircraft moving" : "Aircraft stopped"}
          </span>
          <span className="text-xs text-[#6b7280]">
            {active ? (
              <>Auto-timer running on <b className="text-[#1a1a1a]">{active.flight.flightNumber}</b> — park at the gate to finish.</>
            ) : nextPending ? (
              <>Roll from the gate and <b className="text-[#1a1a1a]">{nextPending.flight.flightNumber}</b> starts automatically.</>
            ) : (
              <>Pick up a sector and it starts the moment you roll from the gate.</>
            )}
          </span>
        </div>
      )}

      {q.isLoading ? (
        <div className="mt-8 space-y-3">{[1,2,3].map(i => <div key={i} className="h-32 animate-pulse rounded-2xl bg-[#f3f4f6]" />)}</div>
      ) : q.isError ? (
        <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-7" data-testid="status-timetable-error">
          <p className="font-bold text-red-800">Timetable unavailable</p>
          <p className="mt-1 text-sm text-red-600">{err?.message || "Could not load your sectors."}</p>
          <button data-testid="button-retry-timetable" onClick={() => q.refetch()} className="mt-4 flex items-center gap-2 text-xs font-bold uppercase text-red-700">
            <RotateCw className="h-4 w-4" />Retry
          </button>
        </div>
      ) : entries.length === 0 ? (
        <div className="mt-8"><EmptyState /></div>
      ) : (
        <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_280px]">
          {/* Main board */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[#6b7280]">Dispatch board</h2>
              <span className="font-mono text-[10px] text-[#9ca3af]">{upcoming.length} upcoming</span>
            </div>

            {upcoming.length === 0 ? (
              <div className="rounded-2xl border border-[#e5e7eb] bg-white p-8 text-center text-sm text-[#6b7280]">
                All your sectors are done. <Link href="/flights" className="font-bold text-[#fb5713] underline">Pick up more routes.</Link>
              </div>
            ) : upcoming.map(entry => {
              const sbUrl = simbriefUrl(entry, simbriefId);
              const isActive = entry.status.toLowerCase() === "active";
              const isAuto = autoMode && autoEntryId === entry.id;
              return (
                <article key={entry.id} data-testid={`card-timetable-entry-${entry.id}`}
                  className={`rounded-2xl border bg-white p-5 transition ${entry.status.toLowerCase() === "active" ? "border-[#fb5713] ring-1 ring-[#fb5713]/20" : "border-[#e5e7eb]"}`}>
                  {/* Top row */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <JetstarStar size={12} className="text-[#fb5713]" />
                      <span className="font-mono text-sm font-bold text-[#fb5713]" data-testid={`text-flight-number-${entry.id}`}>{entry.flight.flightNumber}</span>
                      <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ${statusStyle(entry.status)}`} data-testid={`status-flight-${entry.id}`}>{entry.status}</span>
                    </div>
                    <span className="font-mono text-[10px] text-[#9ca3af]">{entry.flight.flightDate}</span>
                  </div>

                  {/* Route */}
                  <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                    <div>
                      <div className="text-4xl font-black uppercase tracking-tight text-[#1a1a1a]">{entry.flight.departure}</div>
                      <div className="font-mono text-[10px] text-[#9ca3af]">{fmt(entry.flight.departureTime)}</div>
                    </div>
                    <div className="flex items-center gap-1.5 text-[#e5e7eb]">
                      <div className="h-px w-8 bg-[#e5e7eb]" />
                      <Plane className="h-4 w-4 -rotate-90 text-[#fb5713]" />
                      <div className="h-px w-8 bg-[#e5e7eb]" />
                    </div>
                    <div className="text-right">
                      <div className="text-4xl font-black uppercase tracking-tight text-[#1a1a1a]">{entry.flight.arrival}</div>
                      <div className="font-mono text-[10px] text-[#9ca3af]">{entry.flight.durationMinutes} min</div>
                    </div>
                  </div>

                  {/* Weather for departure + arrival */}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#f3f4f6] pt-3">
                    <Wind className="h-3.5 w-3.5 text-[#9ca3af]" />
                    <WxChip code={entry.flight.departure} wx={wxFor(entry.flight.departure)} />
                    <WxChip code={entry.flight.arrival} wx={wxFor(entry.flight.arrival)} />
                  </div>

                  {/* Footer actions */}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#f3f4f6] pt-4">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-[#9ca3af]">
                      {entry.flight.aircraft} · {regFor(entry.id) ?? "TBA"}
                      {entry.status.toLowerCase() === "active" && entry.startedAt && (
                        <> · <Clock3 className="mr-0.5 inline h-3 w-3" />Started {fmt(entry.startedAt)}</>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {/* SimBrief dispatch button */}
                      {sbUrl && (
                        <a href={sbUrl} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#1a1a1a] transition hover:border-[#fb5713] hover:text-[#fb5713]">
                          <ExternalLink className="h-3.5 w-3.5" />SimBrief
                        </a>
                      )}
                      {/* Auto chip — the app runs this timer from aircraft movement */}
                      {isAuto && (
                        <span data-testid={`chip-auto-${entry.id}`} title="The desktop app runs this timer from aircraft movement"
                          className="inline-flex items-center gap-1.5 rounded-xl border border-[#fb5713]/30 bg-[#fff7ed] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#fb5713]">
                          <span className={`h-2 w-2 rounded-full ${moving ? "bg-green-500" : "bg-[#9ca3af]"}`} />
                          Auto
                        </span>
                      )}
                      {isActive ? (
                        <button data-testid={`button-finish-flight-${entry.id}`} disabled={finish.isPending}
                          onClick={() => finish.mutate({ id: entry.id })}
                          className="rounded-xl bg-green-600 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-white disabled:opacity-50">
                          {isAuto ? "Finish now" : "Finish sector"}
                        </button>
                      ) : (
                        <button data-testid={`button-start-flight-${entry.id}`} disabled={start.isPending || !hubConnected}
                          onClick={() => start.mutate({ id: entry.id })}
                          title={hubConnected ? undefined : "Open the vJetstar Sim Link app (with MSFS running) to start a flight"}
                          className="rounded-xl bg-[#1a1a1a] px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-white disabled:opacity-50 disabled:cursor-not-allowed">
                          {isAuto ? "Start now" : "Start flight"}
                        </button>
                      )}
                      <button onClick={() => startCockpit(entry.id)} disabled={cockpitBusy === entry.id || !hubConnected}
                        title={hubConnected ? "Fly this with another pilot — shared cockpit + voice" : "Open the pilot hub to fly with a copilot"}
                        className="flex items-center gap-1.5 rounded-xl border border-[#fb5713]/30 bg-[#fff7ed] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#fb5713] transition hover:bg-[#ffe9d6] disabled:opacity-50">
                        <Users className="h-3.5 w-3.5" />{cockpitBusy === entry.id ? "…" : "Fly with copilot"}
                      </button>
                      <button data-testid={`button-remove-entry-${entry.id}`} disabled={remove.isPending}
                        onClick={() => { if (window.confirm(`Remove ${entry.flight.flightNumber}?`)) remove.mutate({ id: entry.id }); }}
                        className="rounded-xl border border-[#e5e7eb] px-3 py-2 text-[10px] font-bold uppercase text-[#6b7280] transition hover:border-red-200 hover:text-red-600">
                        Remove
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Sidebar */}
          <aside className="space-y-4">
            {/* Active flight */}
            <div className="rounded-2xl bg-[#fb5713] p-5 text-white">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] font-bold uppercase tracking-[.2em] text-white/70">Current sector</span>
                <Radio className="h-4 w-4" />
              </div>
              <div className="mt-4 text-4xl font-black uppercase tracking-tight">
                {active ? active.flight.flightNumber : "Standby"}
              </div>
              <div className="mt-1 text-sm text-white/80">
                {active ? `${active.flight.departure} → ${active.flight.arrival}` : "No active flight"}
              </div>
              <div className="mt-4 border-t border-white/20 pt-3 font-mono text-[9px] uppercase tracking-widest text-white/60">
                {active ? active.flight.aircraft : "Pick up a route to begin"}
              </div>
            </div>

            {/* Stats */}
            <div className="rounded-2xl border border-[#e5e7eb] bg-white p-5">
              <div className="font-mono text-[9px] font-bold uppercase tracking-[.18em] text-[#9ca3af]">Completed</div>
              <div className="mt-2 flex items-end justify-between">
                <span className="text-4xl font-black text-[#1a1a1a]">{completed.length}</span>
                <span className="pb-1 text-xs text-[#6b7280]">sectors logged</span>
              </div>
              <Link href="/logs" data-testid="link-view-logs"
                className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#fb5713] hover:underline">
                View records <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {flagged.length > 0 && (
              <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-5">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  <div className="font-mono text-[9px] font-bold uppercase tracking-[.18em] text-yellow-700">Pending review</div>
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <span className="text-3xl font-black text-yellow-700">{flagged.length}</span>
                  <span className="pb-1 text-xs text-yellow-600">flagged</span>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-yellow-600">
                  {flagged.length === 1 ? "This flight was" : "These flights were"} flagged for unusually short duration and {flagged.length === 1 ? "is" : "are"} awaiting admin approval before being added to your logs.
                </p>
                <div className="mt-3 space-y-1.5">
                  {flagged.map(f => (
                    <div key={f.id} className="flex items-center justify-between rounded-lg border border-yellow-200 bg-white px-3 py-2">
                      <span className="font-mono text-[10px] font-bold text-yellow-700">{f.flight.flightNumber}</span>
                      <span className="text-[9px] text-yellow-500">{f.flight.departure} → {f.flight.arrival}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
