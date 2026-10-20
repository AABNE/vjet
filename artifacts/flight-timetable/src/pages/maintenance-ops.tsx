import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { apiGet, apiPost } from "@/lib/api";
import { Loader2, ShieldAlert, ShieldCheck, Plane, Bot, Wrench, PackageSearch, Boxes } from "lucide-react";

interface MaintRow {
  id: number; registration: string; category: string; description: string; phase: string;
  status: string; priority: string; holdActive: boolean; findings: string | null;
  reporter: string | null; affectedSectors: number; createdAt: string;
}
interface Job { id: number; registration: string; category: string; part: string | null; phase: string; etaAt: string | null; location: string | null; note: string | null }
interface Part { part: string; qty: number }

const STATUS_STYLE: Record<string, string> = {
  submitted: "bg-sky-100 text-sky-700", under_review: "bg-amber-100 text-amber-700", maintenance_hold: "bg-red-100 text-red-700",
  resolved: "bg-emerald-50 text-emerald-700", closed: "bg-[#f3f4f6] text-[#6b7280]", awaiting_info: "bg-amber-100 text-amber-700", draft: "bg-[#f3f4f6] text-[#6b7280]",
};
const FILTERS = [["", "All"], ["submitted", "New"], ["under_review", "In review"], ["maintenance_hold", "On hold"], ["resolved", "Resolved"]];

const PHASE_LABEL: Record<string, string> = { deferred: "waiting for aircraft", awaiting_part: "part inbound", in_repair: "in repair", done: "done" };
const PHASE_STYLE: Record<string, string> = { deferred: "bg-[#f3f4f6] text-[#6b7280]", awaiting_part: "bg-amber-100 text-amber-700", in_repair: "bg-sky-100 text-sky-700", done: "bg-emerald-50 text-emerald-700" };

function etaText(iso: string | null): string {
  if (!iso) return "";
  const m = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function MaintenanceOps() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery<{ reports: MaintRow[] }>({ queryKey: ["maint-admin", filter], queryFn: () => apiGet(`/api/maintenance${filter ? `?status=${filter}` : ""}`), refetchInterval: 15_000, retry: false });
  const state = useQuery<{ jobs: Job[]; parts: Part[] }>({ queryKey: ["maint-state"], queryFn: () => apiGet("/api/ops/maintenance/state"), refetchInterval: 15_000, retry: false });

  if (user && user.isAdmin !== true) {
    return <div className="mx-auto max-w-2xl rounded-2xl border border-[#e5e7eb] bg-white p-10 text-center text-[#6b7280]">The maintenance dashboard is for administrators.</div>;
  }

  async function act(id: number, action: string, body?: any) {
    setBusy(`${id}:${action}`);
    try { await apiPost(`/api/maintenance/${id}/${action}`, body); await q.refetch(); await state.refetch(); qc.invalidateQueries({ queryKey: ["ops-overview"] }); }
    finally { setBusy(null); }
  }

  const jobs = state.data?.jobs ?? [];
  const parts = state.data?.parts ?? [];
  const inHangar = jobs.filter((j) => j.phase === "in_repair").length;
  const waiting = jobs.filter((j) => j.phase === "deferred").length;
  const onOrder = jobs.filter((j) => j.phase === "awaiting_part").length;
  const spares = parts.reduce((n, p) => n + p.qty, 0);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Operations · engineering</p>
        <h1 className="mt-2 text-5xl font-black uppercase leading-none tracking-tight text-[#1a1a1a] md:text-6xl">Maintenance</h1>
        <p className="mt-3 text-sm text-[#6b7280]">Runs itself. The maintenance agent reads every hold, sources parts, defers work until the aircraft is free, and returns it to service on its own — no action needed from you.</p>
      </div>

      {/* ── Autonomous engine status ─────────────────────────────────────── */}
      <div className="mb-4 rounded-2xl border border-[#1a1a1a] bg-[#1a1a1a] p-4 text-white">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-[#fb5713]" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-white/70">Autonomous maintenance engine</span>
          <span className="ml-auto flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active · {state.isLoading ? "…" : "every 2 min"}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="In repair" value={inHangar} />
          <Stat label="Waiting on aircraft" value={waiting} />
          <Stat label="Parts on order" value={onOrder} />
          <Stat label="Spares in stock" value={spares} />
        </div>
      </div>

      {/* ── Live hangar + parts ──────────────────────────────────────────── */}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
          <h2 className="mb-2 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[#6b7280]"><Wrench className="h-3.5 w-3.5 text-[#fb5713]" />In the hangar</h2>
          {jobs.length === 0 ? (
            <p className="text-sm text-[#9ca3af]">Nothing in maintenance. Every aircraft is serviceable.</p>
          ) : (
            <div className="space-y-2">
              {jobs.map((j) => (
                <div key={j.id} className="rounded-xl border border-[#f3f4f6] bg-[#f9fafb] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-[#1a1a1a]">{j.registration}</span>
                      <span className="text-xs text-[#6b7280]">{j.category.replace(/_/g, " ")}</span>
                      {j.location && <span className="text-[11px] text-[#9ca3af]">@ {j.location}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${PHASE_STYLE[j.phase] ?? "bg-[#f3f4f6] text-[#6b7280]"}`}>{PHASE_LABEL[j.phase] ?? j.phase}</span>
                      {j.etaAt && <span className="font-mono text-[10px] text-[#9ca3af]">ETA {etaText(j.etaAt)}</span>}
                    </span>
                  </div>
                  {j.note && <p className="mt-1 text-[11px] text-[#9ca3af]">{j.note}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
          <h2 className="mb-2 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[#6b7280]"><Boxes className="h-3.5 w-3.5 text-[#fb5713]" />Parts in stock</h2>
          {parts.length === 0 ? (
            <p className="flex items-start gap-2 text-sm text-[#9ca3af]"><PackageSearch className="mt-0.5 h-4 w-4 shrink-0" />No spares held — parts are ordered on demand (3 per order) and flown in on a factory ferry, then the leftovers are shelved here.</p>
          ) : (
            <div className="space-y-1.5">{parts.map((p) => <div key={p.part} className="flex items-center justify-between text-xs"><span className="text-[#6b7280]">{p.part}</span><span className="font-mono font-bold text-[#1a1a1a]">{p.qty}</span></div>)}</div>
          )}
        </div>
      </div>

      {/* ── Report log ───────────────────────────────────────────────────── */}
      <h2 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[.2em] text-[#6b7280]">Report log</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)} className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition ${filter === v ? "border-[#fb5713] bg-[#fff7ed] text-[#fb5713]" : "border-[#e5e7eb] text-[#6b7280]"}`}>{l}</button>
        ))}
      </div>

      {(q.data?.reports.length ?? 0) === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#e5e7eb] bg-white p-10 text-center text-sm text-[#9ca3af]">No reports yet. Pilot squawks and groundings show up here, and the agent works them automatically.</div>
      ) : (
        <div className="space-y-3">
          {q.data!.reports.map((m) => (
            <div key={m.id} className={`rounded-2xl border bg-white p-4 ${m.holdActive ? "border-red-200" : "border-[#e5e7eb]"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Plane className="h-4 w-4 text-[#9ca3af]" />
                    <span className="font-mono text-sm font-bold text-[#1a1a1a]">{m.registration}</span>
                    <span className="text-sm text-[#6b7280]">{m.category}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${STATUS_STYLE[m.status] ?? "bg-[#f3f4f6] text-[#6b7280]"}`}>{m.status.replace(/_/g, " ")}</span>
                    {m.priority === "high" && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-700">High</span>}
                    {m.holdActive && <span className="flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"><ShieldAlert className="h-3 w-3" />Hold · {m.affectedSectors} sector{m.affectedSectors === 1 ? "" : "s"}</span>}
                  </div>
                  <p className="mt-1.5 text-sm text-[#6b7280]">{m.description}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[#9ca3af]">by {m.reporter ?? "unknown"} · {m.phase.replace(/_/g, " ")} · {new Date(m.createdAt).toLocaleString()}</p>
                  {m.findings && <p className="mt-1 rounded-lg bg-[#f9fafb] px-2 py-1 text-xs text-[#1a1a1a]"><b>Findings:</b> {m.findings}</p>}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-[#f3f4f6] pt-3">
                <span className="mr-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-[#c7ccd4]">Manual override</span>
                {m.status === "submitted" && <Btn onClick={() => act(m.id, "assign")} busy={busy === `${m.id}:assign`}>Take review</Btn>}
                <Btn onClick={() => act(m.id, "priority", { priority: m.priority === "high" ? "normal" : "high" })} busy={busy === `${m.id}:priority`}>{m.priority === "high" ? "Lower priority" : "Mark high"}</Btn>
                <Btn onClick={() => { const f = prompt("Review findings:"); if (f) act(m.id, "findings", { findings: f }); }} busy={busy === `${m.id}:findings`}>Add findings</Btn>
                {!m.holdActive
                  ? <Btn onClick={() => { const r = prompt("Reason for hold:") || "Admin hold"; act(m.id, "hold", { reason: r }); }} busy={busy === `${m.id}:hold`} tone="danger"><ShieldAlert className="h-3.5 w-3.5" />Place hold</Btn>
                  : <Btn onClick={() => { const r = prompt("Clearance notes:") || "Reviewed and cleared"; act(m.id, "clear-hold", { reason: r }); }} busy={busy === `${m.id}:clear-hold`} tone="ok"><ShieldCheck className="h-3.5 w-3.5" />Clear hold</Btn>}
                {m.status !== "resolved" && <Btn onClick={() => act(m.id, "resolve")} busy={busy === `${m.id}:resolve`} tone="ok">Resolve</Btn>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/5 px-3 py-2.5">
      <div className="text-2xl font-black leading-none text-white">{value}</div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-white/50">{label}</div>
    </div>
  );
}

function Btn({ children, onClick, busy, tone }: { children: React.ReactNode; onClick: () => void; busy: boolean; tone?: "danger" | "ok" }) {
  const cls = tone === "danger" ? "border-red-200 text-red-600 hover:bg-red-50" : tone === "ok" ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50" : "border-[#e5e7eb] text-[#6b7280] hover:bg-[#f3f4f6]";
  return (
    <button onClick={onClick} disabled={busy} className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition disabled:opacity-50 ${cls}`}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{children}
    </button>
  );
}
