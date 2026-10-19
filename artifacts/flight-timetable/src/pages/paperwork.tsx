import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import { Wrench, AlertTriangle, FileText, Loader2, CheckCircle2, Plane } from "lucide-react";

interface Aircraft { registration: string; type: string; status: string; }
interface DelayRow { id: number; status: string; category: string; reason: string | null; delayMinutes: number | null; flight: { flightNumber: string; departure: string; arrival: string } | null; createdAt: string; }
interface MaintRow { id: number; registration: string; category: string; description: string; phase: string; status: string; priority: string; holdActive: boolean; findings: string | null; createdAt: string; }

const ISSUE_CATEGORIES = ["Engine / performance", "Aircraft systems", "Landing gear / flaps / controls", "Electrical / avionics", "Damage / abnormal behaviour", "Other"];
const PHASES = [["pre_departure", "Before departure"], ["in_flight", "During flight"], ["after_landing", "After landing"], ["unknown", "Not sure"]];
const DELAY_CATEGORIES = [
  ["late_inbound", "Late inbound aircraft"], ["aircraft_substitution", "Aircraft substitution"], ["pilot_availability", "Pilot availability"],
  ["technical", "Technical issue"], ["weather", "Weather"], ["atc", "ATC / airport"], ["schedule_conflict", "Schedule conflict"], ["other", "Other"], ["unknown", "Unknown"],
];
const STATUS_STYLE: Record<string, string> = {
  submitted: "bg-sky-100 text-sky-700", under_review: "bg-amber-100 text-amber-700", maintenance_hold: "bg-red-100 text-red-700",
  resolved: "bg-emerald-50 text-emerald-700", closed: "bg-[#f3f4f6] text-[#6b7280]", awaiting_info: "bg-amber-100 text-amber-700",
  draft: "bg-[#f3f4f6] text-[#6b7280]", notified: "bg-sky-100 text-sky-700", confirmed: "bg-emerald-50 text-emerald-700",
};

export default function Paperwork() {
  const qc = useQueryClient();
  const aircraft = useQuery<{ aircraft: Aircraft[] }>({ queryKey: ["ops-aircraft"], queryFn: () => apiGet("/api/ops/aircraft"), retry: false });
  const delays = useQuery<{ delays: DelayRow[] }>({ queryKey: ["delays-mine"], queryFn: () => apiGet("/api/ops/delays/mine"), refetchInterval: 20_000, retry: false });
  const maint = useQuery<{ reports: MaintRow[] }>({ queryKey: ["maint-mine"], queryFn: () => apiGet("/api/maintenance/mine"), refetchInterval: 20_000, retry: false });

  const [reg, setReg] = useState("");
  const [category, setCategory] = useState(ISSUE_CATEGORIES[0]);
  const [phase, setPhase] = useState("in_flight");
  const [description, setDescription] = useState("");
  const [restrict, setRestrict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submitIssue(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await apiPost<{ status: string }>("/api/maintenance/report", { registration: reg, category, phase, description, requestRestriction: restrict });
      setMsg({ ok: true, text: restrict ? `Logged — ${reg} placed on a precautionary hold for review.` : "Issue report submitted to maintenance." });
      setDescription(""); setRestrict(false);
      qc.invalidateQueries({ queryKey: ["maint-mine"] });
    } catch (err: any) { setMsg({ ok: false, text: err?.message || "Could not submit." }); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Pilot portal</p>
        <h1 className="mt-2 text-5xl font-black uppercase leading-none tracking-tight text-[#1a1a1a] md:text-6xl">My paperwork</h1>
        <p className="mt-3 text-sm text-[#6b7280]">Report aircraft issues, confirm delay causes, and track your ops paperwork.</p>
      </div>

      {/* Report an aircraft issue */}
      <section className="mb-7 overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
        <div className="flex items-center gap-2 border-b border-[#f3f4f6] bg-[#f9fafb] px-5 py-3">
          <Wrench className="h-4 w-4 text-[#fb5713]" /><h2 className="font-black uppercase tracking-tight text-[#1a1a1a]">Report an aircraft issue</h2>
        </div>
        <form onSubmit={submitIssue} className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[.16em] text-[#6b7280]">Aircraft</label>
              <select value={reg} onChange={(e) => setReg(e.target.value)} required className="h-10 w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm outline-none focus:border-[#fb5713]">
                <option value="">Select registration…</option>
                {(aircraft.data?.aircraft ?? []).map((a) => <option key={a.registration} value={a.registration}>{a.registration} ({a.type}){a.status !== "active" ? " — on hold" : ""}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[.16em] text-[#6b7280]">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm outline-none focus:border-[#fb5713]">
                {ISSUE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[.16em] text-[#6b7280]">When did it happen?</label>
            <div className="flex flex-wrap gap-2">
              {PHASES.map(([v, l]) => (
                <button type="button" key={v} onClick={() => setPhase(v)} className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${phase === v ? "border-[#fb5713] bg-[#fff7ed] text-[#fb5713]" : "border-[#e5e7eb] text-[#6b7280]"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[.16em] text-[#6b7280]">What happened?</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} required rows={3} placeholder="Describe the issue you saw in the sim…"
              className="w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2 text-sm outline-none focus:border-[#fb5713]" />
          </div>
          <label className="flex items-start gap-2 rounded-xl bg-[#fff7ed] p-3 text-sm text-[#1a1a1a]">
            <input type="checkbox" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#fb5713]" />
            <span>This aircraft should be <b>restricted from further flights</b> until reviewed. <span className="text-[#9ca3af]">Places a precautionary virtual maintenance hold — ops will find you a replacement.</span></span>
          </label>
          {msg && <div className={`rounded-xl px-3 py-2 text-xs ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{msg.text}</div>}
          <button type="submit" disabled={busy || !reg} className="flex items-center gap-2 rounded-xl bg-[#fb5713] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#e04d0e] disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}Submit report
          </button>
        </form>
      </section>

      {/* Delay reports to confirm */}
      <section className="mb-7">
        <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[.2em] text-[#6b7280]"><AlertTriangle className="h-4 w-4 text-[#fb5713]" />Delay reports</h2>
        {(delays.data?.delays.length ?? 0) === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#e5e7eb] bg-white p-6 text-center text-sm text-[#9ca3af]">No delay reports on your flights.</div>
        ) : (
          <div className="space-y-3">{delays.data!.delays.map((d) => <DelayCard key={d.id} d={d} onDone={() => qc.invalidateQueries({ queryKey: ["delays-mine"] })} />)}</div>
        )}
      </section>

      {/* Maintenance history */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[.2em] text-[#6b7280]"><FileText className="h-4 w-4 text-[#fb5713]" />My maintenance reports</h2>
        {(maint.data?.reports.length ?? 0) === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#e5e7eb] bg-white p-6 text-center text-sm text-[#9ca3af]">Nothing filed yet.</div>
        ) : (
          <div className="space-y-2">
            {maint.data!.reports.map((m) => (
              <div key={m.id} className="rounded-xl border border-[#e5e7eb] bg-white px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><Plane className="h-3.5 w-3.5 text-[#9ca3af]" /><span className="font-mono text-sm font-bold text-[#1a1a1a]">{m.registration}</span><span className="text-xs text-[#6b7280]">{m.category}</span></div>
                  <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ${STATUS_STYLE[m.status] ?? "bg-[#f3f4f6] text-[#6b7280]"}`}>{m.status.replace(/_/g, " ")}</span>
                </div>
                <p className="mt-1 text-sm text-[#6b7280]">{m.description}</p>
                {m.findings && <p className="mt-1 rounded-lg bg-[#f9fafb] px-2 py-1 text-xs text-[#1a1a1a]"><b>Review:</b> {m.findings}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DelayCard({ d, onDone }: { d: DelayRow; onDone: () => void }) {
  const [cat, setCat] = useState(d.category || "unknown");
  const [reason, setReason] = useState(d.reason || "");
  const [busy, setBusy] = useState(false);
  const confirmed = d.status === "confirmed" || d.status === "closed";
  async function confirm() {
    setBusy(true);
    try { await apiPost(`/api/ops/delays/${d.id}/confirm`, { category: cat, reason }); onDone(); }
    finally { setBusy(false); }
  }
  return (
    <div className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-[#fb5713]">{d.flight?.flightNumber ?? "Flight"}</span>
          {d.flight && <span className="text-sm text-[#1a1a1a]">{d.flight.departure}→{d.flight.arrival}</span>}
          {d.delayMinutes != null && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">~{d.delayMinutes} min</span>}
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ${STATUS_STYLE[d.status] ?? "bg-[#f3f4f6] text-[#6b7280]"}`}>{d.status}</span>
      </div>
      {confirmed ? (
        <p className="mt-2 text-sm text-[#6b7280]"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />Cause: {DELAY_CATEGORIES.find(([v]) => v === d.category)?.[1] ?? d.category}{d.reason ? ` — ${d.reason}` : ""}</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[180px] flex-1">
            <label className="mb-1 block font-mono text-[9px] font-bold uppercase tracking-wider text-[#9ca3af]">Cause</label>
            <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-10 w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm outline-none focus:border-[#fb5713]">
              {DELAY_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Note (optional)" className="h-10 min-w-[160px] flex-1 rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm outline-none focus:border-[#fb5713]" />
          <button onClick={confirm} disabled={busy} className="flex h-10 items-center gap-1.5 rounded-xl bg-[#1a1a1a] px-4 text-[10px] font-bold uppercase tracking-wider text-white disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Confirm cause</button>
        </div>
      )}
    </div>
  );
}
