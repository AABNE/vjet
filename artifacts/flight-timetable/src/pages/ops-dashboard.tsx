import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/components/auth-provider";
import { apiGet } from "@/lib/api";
import { Plane, AlertTriangle, Wrench, ShieldCheck, Radio, Gauge, ArrowRight, Bot } from "lucide-react";

interface Track { flightNumber: string; departure: string; arrival: string; pilotUsername: string; provider: string; status: string; trackingStatus: string; delayMinutes: number | null; }
interface Overview {
  flights: { active: number; delayed: number; trackingUnavailable: number };
  tracks: Track[];
  fleet: { total: number; available: number; held: { registration: string; type: string; status: string; note: string | null }[] };
  openDelays: number; openMaintenance: number; pendingApprovals: number;
  recentEvents: { id: number; kind: string; severity: string; title: string; body: string; createdAt: string }[];
}

const STATUS_STYLE: Record<string, string> = {
  on_time: "bg-emerald-50 text-emerald-700", possible_delay: "bg-amber-100 text-amber-700",
  confirmed_delay: "bg-red-100 text-red-700", tracking_unavailable: "bg-[#f3f4f6] text-[#6b7280]",
  completed: "bg-[#f3f4f6] text-[#6b7280]", unknown: "bg-[#f3f4f6] text-[#9ca3af]",
};

function Tile({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
      <div className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[.16em] text-[#9ca3af]"><Icon className="h-3.5 w-3.5 text-[#fb5713]" />{label}</div>
      <div className={`mt-2 text-3xl font-black ${tone ?? "text-[#1a1a1a]"}`}>{value}</div>
    </div>
  );
}

export default function OpsDashboard() {
  const { user } = useAuth();
  const q = useQuery<Overview>({ queryKey: ["ops-overview"], queryFn: () => apiGet("/api/ops/overview"), refetchInterval: 10_000, retry: false });

  if (user && user.isAdmin !== true) {
    return <div className="mx-auto max-w-2xl rounded-2xl border border-[#e5e7eb] bg-white p-10 text-center text-[#6b7280]">The operations dashboard is for administrators.</div>;
  }
  const d = q.data;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Operations · control</p>
          <h1 className="mt-2 text-5xl font-black uppercase leading-none tracking-tight text-[#1a1a1a] md:text-6xl">Ops dashboard</h1>
          <p className="mt-3 text-sm text-[#6b7280]">Live airline operations at a glance.</p>
        </div>
        <Link href="/control-room" className="flex items-center gap-2 rounded-xl bg-[#1a1a1a] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-black"><Bot className="h-4 w-4" />AI Control Room</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile icon={Plane} label="Active flights" value={d?.flights.active ?? "—"} />
        <Tile icon={AlertTriangle} label="Delayed" value={d?.flights.delayed ?? "—"} tone={(d?.flights.delayed ?? 0) > 0 ? "text-red-600" : undefined} />
        <Tile icon={Gauge} label="Fleet available" value={d ? `${d.fleet.available}/${d.fleet.total}` : "—"} />
        <Tile icon={ShieldCheck} label="Approvals" value={d?.pendingApprovals ?? "—"} tone={(d?.pendingApprovals ?? 0) > 0 ? "text-amber-600" : undefined} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile icon={Wrench} label="Open maintenance" value={d?.openMaintenance ?? "—"} />
        <Tile icon={AlertTriangle} label="Open delays" value={d?.openDelays ?? "—"} />
        <Tile icon={Radio} label="Tracking unavailable" value={d?.flights.trackingUnavailable ?? "—"} />
        <Tile icon={Wrench} label="Aircraft on hold" value={d?.fleet.held.length ?? "—"} tone={(d?.fleet.held.length ?? 0) > 0 ? "text-red-600" : undefined} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px]">
        <section>
          <h2 className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[.2em] text-[#6b7280]">Live flights</h2>
          <div className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
            {(d?.tracks.length ?? 0) === 0 ? (
              <div className="p-8 text-center text-sm text-[#9ca3af]">No pilots currently on an open sector.</div>
            ) : (
              <ul className="divide-y divide-[#f3f4f6]">
                {d!.tracks.map((t) => (
                  <li key={t.flightNumber + t.pilotUsername} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-[#fb5713]">{t.flightNumber}</span>
                        <span className="text-sm text-[#1a1a1a]">{t.departure}→{t.arrival}</span>
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-wider text-[#9ca3af]">{t.pilotUsername} · {t.provider} · {t.trackingStatus}</div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ${STATUS_STYLE[t.status] ?? "bg-[#f3f4f6] text-[#9ca3af]"}`}>
                      {t.status.replace(/_/g, " ")}{t.delayMinutes ? ` ${t.delayMinutes}m` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(d?.fleet.held.length ?? 0) > 0 && (
            <>
              <h2 className="mb-3 mt-6 font-mono text-[11px] font-bold uppercase tracking-[.2em] text-[#6b7280]">Aircraft on hold</h2>
              <div className="space-y-2">
                {d!.fleet.held.map((a) => (
                  <div key={a.registration} className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50/50 px-4 py-2.5">
                    <div><span className="font-mono text-sm font-bold text-[#1a1a1a]">{a.registration}</span> <span className="font-mono text-[10px] text-[#9ca3af]">{a.type}</span></div>
                    <span className="text-[11px] text-red-700">{a.note || a.status}</span>
                  </div>
                ))}
              </div>
              <Link href="/maintenance-ops" className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#fb5713] hover:underline">Maintenance dashboard <ArrowRight className="h-3 w-3" /></Link>
            </>
          )}
        </section>

        <aside>
          <h2 className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[.2em] text-[#6b7280]">Recent activity</h2>
          <div className="space-y-2">
            {(d?.recentEvents ?? []).map((e) => (
              <div key={e.id} className="rounded-xl border border-[#e5e7eb] bg-white px-3 py-2.5">
                <div className="text-xs font-bold text-[#1a1a1a]">{e.title}</div>
                {e.body && <div className="mt-0.5 text-[11px] leading-snug text-[#6b7280]">{e.body}</div>}
                <div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-[#c7ccd4]">{e.kind.replace(/_/g, " ")}</div>
              </div>
            ))}
            {(d?.recentEvents.length ?? 0) === 0 && <div className="rounded-xl border border-dashed border-[#e5e7eb] bg-white p-5 text-center text-sm text-[#9ca3af]">Quiet.</div>}
          </div>
        </aside>
      </div>
    </div>
  );
}
