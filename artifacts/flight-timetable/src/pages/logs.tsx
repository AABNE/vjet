import { useQueryClient } from "@tanstack/react-query";
import { getGetTimetableQueryKey, useGetTimetable, useRemoveFromTimetable } from "@workspace/api-client-react";
import { ClipboardList, Clock3, RotateCw, Trash2 } from "lucide-react";

function JetstarStar({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className}>
      <polygon points="50,5 61,35 95,35 68,57 79,91 50,70 21,91 32,57 5,35 39,35" fill="currentColor" />
    </svg>
  );
}

export default function Logs() {
  const qc = useQueryClient();
  const q = useGetTimetable({ query: { queryKey: getGetTimetableQueryKey(), refetchOnMount: "always" } });
  const remove = useRemoveFromTimetable({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetTimetableQueryKey() }) } });

  const done = (q.data || []).filter(e => e.status.toLowerCase() === "completed")
    .sort((a, b) => new Date(b.finishedAt || "").getTime() - new Date(a.finishedAt || "").getTime());
  const totalSecs = done.reduce((a, e) => a + (e.flightDurationSeconds || e.flight.durationMinutes * 60), 0);

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Pilot records · completed sectors</p>
        <h1 className="mt-2 text-5xl font-black uppercase leading-none tracking-tight text-[#1a1a1a] md:text-6xl">Flight records</h1>
        <p className="mt-3 text-sm text-[#6b7280]">Every sector you've completed in the simulator.</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-[#1a1a1a] p-5 text-white">
          <div className="font-mono text-[9px] uppercase tracking-widest text-white/50">Sectors logged</div>
          <div className="mt-2 text-4xl font-black" data-testid="value-completed-count">{done.length}</div>
        </div>
        <div className="rounded-2xl bg-[#fb5713] p-5 text-white">
          <div className="font-mono text-[9px] uppercase tracking-widest text-white/70">Recorded block time</div>
          <div className="mt-2 text-4xl font-black" data-testid="value-flight-hours">
            {Math.floor(totalSecs / 3600)}<span className="ml-1 text-lg font-bold">h</span>{" "}
            {Math.floor(totalSecs % 3600 / 60)}<span className="ml-1 text-lg font-bold">m</span>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-2xl border border-[#e5e7eb] bg-white p-5">
          <Clock3 className="h-7 w-7 shrink-0 text-[#fb5713]" />
          <p className="text-xs leading-5 text-[#6b7280]">Flight time recorded from sim sector when available, block time as fallback.</p>
        </div>
      </div>

      {/* Log */}
      {q.isLoading ? (
        <div className="mt-7 space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 animate-pulse rounded-2xl bg-[#f3f4f6]" />)}</div>
      ) : q.isError ? (
        <div className="mt-7 rounded-2xl border border-red-200 bg-red-50 p-7" data-testid="status-logs-error">
          <p className="font-bold text-red-800">Flight records unavailable</p>
          <button data-testid="button-retry-logs" onClick={() => q.refetch()} className="mt-3 flex items-center gap-2 text-xs font-bold uppercase text-red-700">
            <RotateCw className="h-4 w-4" />Retry
          </button>
        </div>
      ) : done.length === 0 ? (
        <div className="mt-7 rounded-2xl border-2 border-dashed border-[#e5e7eb] bg-white px-6 py-14 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f4f6]">
            <ClipboardList className="h-6 w-6 text-[#9ca3af]" />
          </div>
          <h2 className="mt-4 text-2xl font-black uppercase text-[#1a1a1a]">Logbook starts here</h2>
          <p className="mt-2 text-sm text-[#6b7280]">Completed sectors will appear here once you finish a flight.</p>
        </div>
      ) : (
        <div className="mt-7 overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
          <div className="hidden grid-cols-[1fr_1.5fr_.8fr_.8fr_auto] gap-3 border-b border-[#f3f4f6] bg-[#f9fafb] px-5 py-3 font-mono text-[9px] font-bold uppercase tracking-[.16em] text-[#9ca3af] md:grid">
            <span>Flight</span><span>Route</span><span>Aircraft</span><span>Duration</span><span />
          </div>
          {done.map(e => (
            <div key={e.id} data-testid={`row-log-${e.id}`}
              className="grid items-center gap-3 border-b border-[#f3f4f6] px-5 py-4 last:border-0 md:grid-cols-[1fr_1.5fr_.8fr_.8fr_auto]">
              <div>
                <div className="flex items-center gap-1.5">
                  <JetstarStar size={11} className="text-[#fb5713]" />
                  <span className="font-mono text-xs font-bold text-[#fb5713]">{e.flight.flightNumber}</span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-[#9ca3af]">
                  {e.finishedAt ? new Date(e.finishedAt).toLocaleDateString() : "Completed"}
                </div>
              </div>
              <div className="text-xl font-black uppercase tracking-tight text-[#1a1a1a]">
                {e.flight.departure} <span className="text-[#d1d5db]">→</span> {e.flight.arrival}
              </div>
              <div className="font-mono text-[10px] font-semibold text-[#6b7280]">{e.flight.aircraft}</div>
              <div className="font-mono text-[10px] font-semibold text-[#6b7280]">
                {Math.floor((e.flightDurationSeconds || e.flight.durationMinutes * 60) / 3600)}h{" "}
                {Math.floor((e.flightDurationSeconds || e.flight.durationMinutes * 60) % 3600 / 60)}m
              </div>
              <button data-testid={`button-remove-log-${e.id}`}
                onClick={() => { if (window.confirm("Remove this entry?")) remove.mutate({ id: e.id }); }}
                className="rounded-lg p-2 text-[#9ca3af] transition hover:bg-red-50 hover:text-red-600">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
