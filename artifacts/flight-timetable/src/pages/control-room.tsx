import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { apiGet, apiPost } from "@/lib/api";
import {
  Bot, Activity, CheckCircle2, XCircle, Pause, Play, AlertTriangle, ShieldCheck,
  Loader2, ChevronDown, ChevronRight, Radio,
} from "lucide-react";

interface Agent {
  key: string; name: string; responsibility: string; model: string; status: string;
  currentTask: string | null; lastActivity: string | null; lastSummary: string | null;
  lastError: string | null; completed: number; failed: number; autoApprove: string[];
}
interface Approval {
  id: number; agentKey: string; actionType: string; title: string; reason: string | null;
  payload: any; affected: any; validation: any; status: string; createdAt: string;
}
interface OpsEvent { id: number; kind: string; severity: string; title: string; body: string; agentKey: string | null; createdAt: string; }
interface TaskRun {
  id: number; agentKey: string; status: string; task: string; objective: string | null;
  facts: any; summary: string | null; proposedAction: string | null; outcome: string | null;
  error: string | null; startedAt: string; finishedAt: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  working: "bg-sky-100 text-sky-700",
  waiting_approval: "bg-amber-100 text-amber-700",
  error: "bg-red-100 text-red-700",
  paused: "bg-[#f3f4f6] text-[#6b7280]",
  idle: "bg-emerald-50 text-emerald-700",
};
const SEV_DOT: Record<string, string> = { info: "bg-sky-400", warn: "bg-amber-500", critical: "bg-red-500" };

function ago(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ControlRoom() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<number | null>(null);

  const agents = useQuery<{ globalPaused: boolean; agents: Agent[] }>({ queryKey: ["ops-agents"], queryFn: () => apiGet("/api/ops/agents"), refetchInterval: 10_000, retry: false });
  const approvals = useQuery<{ approvals: Approval[] }>({ queryKey: ["ops-approvals"], queryFn: () => apiGet("/api/ops/approvals?status=pending"), refetchInterval: 10_000, retry: false });
  const events = useQuery<{ events: OpsEvent[] }>({ queryKey: ["ops-events"], queryFn: () => apiGet("/api/ops/events?limit=40"), refetchInterval: 8_000, retry: false });
  const tasks = useQuery<{ tasks: TaskRun[] }>({ queryKey: ["ops-tasks"], queryFn: () => apiGet("/api/ops/tasks"), refetchInterval: 12_000, retry: false });

  if (user && user.isAdmin !== true) {
    return <div className="mx-auto max-w-2xl rounded-2xl border border-[#e5e7eb] bg-white p-10 text-center text-[#6b7280]">The AI Control Room is for operations administrators.</div>;
  }

  async function act(path: string, key?: string) {
    setBusy(key ?? path);
    try { await apiPost(path); await Promise.all([agents.refetch(), approvals.refetch(), events.refetch()]); qc.invalidateQueries({ queryKey: ["ops-tasks"] }); }
    finally { setBusy(null); }
  }
  async function decide(id: number, decision: "approve" | "reject") {
    setBusy(`ap-${id}`);
    try { await apiPost(`/api/ops/approvals/${id}/${decision}`); await Promise.all([approvals.refetch(), events.refetch(), agents.refetch()]); }
    finally { setBusy(null); }
  }

  const globalPaused = agents.data?.globalPaused;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Operations · autonomous</p>
          <h1 className="mt-2 text-5xl font-black uppercase leading-none tracking-tight text-[#1a1a1a] md:text-6xl">AI Control Room</h1>
          <p className="mt-3 max-w-2xl text-sm text-[#6b7280]">Live view of every ops agent — what they're doing, why, and what's waiting on you.</p>
        </div>
        <button onClick={() => act(globalPaused ? "/api/ops/agents/global/resume" : "/api/ops/agents/global/pause", "global")} disabled={busy === "global"}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition ${globalPaused ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`}>
          {busy === "global" ? <Loader2 className="h-4 w-4 animate-spin" /> : globalPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          {globalPaused ? "Resume all agents" : "Emergency pause"}
        </button>
      </div>

      {globalPaused && (
        <div className="mb-5 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Pause className="h-4 w-4" /> All autonomous actions are paused. Agents won't act until you resume.
        </div>
      )}

      {/* Approval queue */}
      <section className="mb-7">
        <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[.2em] text-[#6b7280]"><ShieldCheck className="h-4 w-4 text-[#fb5713]" />Approvals waiting ({approvals.data?.approvals.length ?? 0})</h2>
        {(approvals.data?.approvals.length ?? 0) === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#e5e7eb] bg-white p-6 text-center text-sm text-[#9ca3af]">Nothing waiting on you.</div>
        ) : (
          <div className="space-y-3">
            {approvals.data!.approvals.map((a) => (
              <div key={a.id} className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-[#1a1a1a] px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-white">{a.actionType.replace(/_/g, " ")}</span>
                      <span className="font-bold text-[#1a1a1a]">{a.title}</span>
                    </div>
                    {a.reason && <p className="mt-1 text-sm text-[#6b7280]">{a.reason}</p>}
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[#9ca3af]">by {a.agentKey} · {ago(a.createdAt)}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => decide(a.id, "approve")} disabled={busy === `ap-${a.id}`}
                      className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white disabled:opacity-50">
                      {busy === `ap-${a.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Approve
                    </button>
                    <button onClick={() => decide(a.id, "reject")} disabled={busy === `ap-${a.id}`}
                      className="flex items-center gap-1.5 rounded-xl border border-[#e5e7eb] bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#6b7280] hover:border-red-200 hover:text-red-600">
                      <XCircle className="h-3.5 w-3.5" />Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Agents */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[.2em] text-[#6b7280]"><Bot className="h-4 w-4 text-[#fb5713]" />Agents</h2>
          <div className="space-y-3">
            {(agents.data?.agents ?? []).map((a) => (
              <div key={a.key} className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[#1a1a1a]">{a.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${STATUS_STYLE[a.status] ?? "bg-[#f3f4f6] text-[#6b7280]"}`}>{a.status.replace(/_/g, " ")}</span>
                  </div>
                  <button onClick={() => act(a.status === "paused" ? `/api/ops/agents/${a.key}/resume` : `/api/ops/agents/${a.key}/pause`, a.key)} disabled={busy === a.key}
                    className="flex items-center gap-1 font-mono text-[9px] font-bold uppercase tracking-wider text-[#9ca3af] hover:text-[#1a1a1a]">
                    {a.status === "paused" ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}{a.status === "paused" ? "Resume" : "Pause"}
                  </button>
                </div>
                <p className="mt-1 text-xs text-[#9ca3af]">{a.responsibility}</p>
                {a.lastSummary && <p className="mt-2 text-sm text-[#1a1a1a]">{a.lastSummary}</p>}
                {a.lastError && <p className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{a.lastError}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[9px] uppercase tracking-wider text-[#9ca3af]">
                  <span>model {a.model}</span><span>· {ago(a.lastActivity)}</span>
                  <span>· {a.completed} done</span>{a.failed > 0 && <span className="text-red-500">· {a.failed} failed</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Task history + decision traces */}
          <h2 className="mb-3 mt-7 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[.2em] text-[#6b7280]"><Activity className="h-4 w-4 text-[#fb5713]" />Recent tasks</h2>
          <div className="space-y-2">
            {(tasks.data?.tasks ?? []).slice(0, 25).map((t) => (
              <div key={t.id} className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white">
                <button onClick={() => setOpenTask(openTask === t.id ? null : t.id)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
                  {openTask === t.id ? <ChevronDown className="h-3.5 w-3.5 text-[#9ca3af]" /> : <ChevronRight className="h-3.5 w-3.5 text-[#9ca3af]" />}
                  <span className={`h-2 w-2 shrink-0 rounded-full ${t.status === "error" ? "bg-red-500" : t.status === "working" ? "bg-sky-400" : "bg-emerald-400"}`} />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[#1a1a1a]">{t.task}</span>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-[#9ca3af]">{t.agentKey} · {ago(t.startedAt)}</span>
                </button>
                {openTask === t.id && (
                  <div className="space-y-2 border-t border-[#f3f4f6] bg-[#f9fafb] px-4 py-3 text-xs text-[#6b7280]">
                    {t.objective && <div><b className="text-[#1a1a1a]">Objective:</b> {t.objective}</div>}
                    {t.summary && <div><b className="text-[#1a1a1a]">Decision:</b> {t.summary}</div>}
                    {t.facts && <div><b className="text-[#1a1a1a]">Facts:</b> <code className="break-all font-mono text-[10px]">{JSON.stringify(t.facts)}</code></div>}
                    {t.proposedAction && <div><b className="text-[#1a1a1a]">Proposed:</b> {t.proposedAction}</div>}
                    {t.outcome && <div><b className="text-[#1a1a1a]">Outcome:</b> {t.outcome}</div>}
                    {t.error && <div className="text-red-600"><b>Error:</b> {t.error}</div>}
                    <div className="font-mono text-[9px] uppercase tracking-wider text-[#c7ccd4]">{new Date(t.startedAt).toLocaleString()}{t.finishedAt ? ` → ${new Date(t.finishedAt).toLocaleTimeString()}` : " · running"}</div>
                  </div>
                )}
              </div>
            ))}
            {(tasks.data?.tasks.length ?? 0) === 0 && <div className="rounded-xl border border-dashed border-[#e5e7eb] bg-white p-5 text-center text-sm text-[#9ca3af]">No agent runs yet — they start on the next monitor tick.</div>}
          </div>
        </section>

        {/* Live feed */}
        <aside>
          <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[.2em] text-[#6b7280]"><Radio className="h-4 w-4 text-[#fb5713]" />Live activity</h2>
          <div className="space-y-2">
            {(events.data?.events ?? []).map((e) => (
              <div key={e.id} className="rounded-xl border border-[#e5e7eb] bg-white px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${SEV_DOT[e.severity] ?? "bg-sky-400"}`} />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#1a1a1a]">{e.title}</div>
                    {e.body && <div className="mt-0.5 text-[11px] leading-snug text-[#6b7280]">{e.body}</div>}
                    <div className="mt-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-[#c7ccd4]">
                      {e.kind.replace(/_/g, " ")}{e.agentKey && <> · {e.agentKey}</>} · {ago(e.createdAt)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {(events.data?.events.length ?? 0) === 0 && <div className="rounded-xl border border-dashed border-[#e5e7eb] bg-white p-5 text-center text-sm text-[#9ca3af]"><AlertTriangle className="mx-auto mb-1 h-4 w-4" />Quiet so far.</div>}
          </div>
        </aside>
      </div>
    </div>
  );
}
