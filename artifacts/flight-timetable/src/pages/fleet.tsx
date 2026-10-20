import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { apiGet, apiPost } from "@/lib/api";
import { Plane, Loader2, Plus } from "lucide-react";

interface Ac { registration: string; type: string; status: string; note: string | null; assigned: boolean }
const TYPES = ["A320", "A20N", "A21N", "B788"];
const STATUS_STYLE: Record<string, string> = { active: "bg-emerald-50 text-emerald-700", maintenance_hold: "bg-red-100 text-red-700", grounded: "bg-[#f3f4f6] text-[#6b7280]" };

export default function Fleet() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery<{ aircraft: Ac[] }>({ queryKey: ["fleet"], queryFn: () => apiGet("/api/ops/aircraft"), refetchInterval: 20_000, retry: false });
  const maint = useQuery<{ jobs: { id: number; registration: string; category: string; part: string | null; phase: string; etaAt: string | null; location: string | null; note: string | null }[]; parts: { part: string; qty: number }[] }>({
    queryKey: ["maint-state"], queryFn: () => apiGet("/api/ops/maintenance/state"), refetchInterval: 20_000, retry: false,
  });
  const [reg, setReg] = useState("");
  const [type, setType] = useState("A320");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (user && user.isAdmin !== true) {
    return <div className="mx-auto max-w-2xl rounded-2xl border border-[#e5e7eb] bg-white p-10 text-center text-[#6b7280]">Fleet management is for administrators.</div>;
  }

  async function add() {
    setBusy(true); setMsg(null);
    try { await apiPost("/api/ops/aircraft", { registration: reg, type }); setReg(""); await q.refetch(); }
    catch (e: any) { setMsg(e?.message || "Could not add."); }
    finally { setBusy(false); }
  }
  async function returnToService(registration: string) {
    await apiPost(`/api/ops/aircraft/${registration}`, { status: "active" }).catch(() => {});
    await q.refetch(); qc.invalidateQueries({ queryKey: ["ops-overview"] });
  }
  async function ground(registration: string) {
    const reason = prompt("Why is it being grounded? (e.g. landing gear lever inop)");
    if (reason === null) return;
    const location = prompt("Which airport is it at? (IATA/ICAO, blank if at a main base)") || "";
    await apiPost(`/api/ops/aircraft/${registration}/ground`, { reason: reason || "Technical difficulties", location }).catch(() => {});
    await q.refetch(); await maint.refetch(); qc.invalidateQueries({ queryKey: ["ops-overview"] });
  }

  const grouped = TYPES.map((t) => ({ type: t, list: (q.data?.aircraft ?? []).filter((a) => a.type === t) }));
  const jobs = maint.data?.jobs ?? [];
  const parts = maint.data?.parts ?? [];
  const eta = (iso: string | null) => { if (!iso) return ""; const m = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000)); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Operations · fleet</p>
        <h1 className="mt-2 text-5xl font-black uppercase leading-none tracking-tight text-[#1a1a1a] md:text-6xl">Fleet</h1>
        <p className="mt-3 text-sm text-[#6b7280]">Aircraft registrations. These are the authoritative records used across the timetable and by ops agents.</p>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-2 rounded-2xl border border-[#e5e7eb] bg-white p-4">
        <div><label className="mb-1 block font-mono text-[9px] font-bold uppercase tracking-wider text-[#9ca3af]">Registration</label>
          <input value={reg} onChange={(e) => setReg(e.target.value.toUpperCase())} placeholder="VH-VFO" className="h-10 w-40 rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm uppercase outline-none focus:border-[#fb5713]" /></div>
        <div><label className="mb-1 block font-mono text-[9px] font-bold uppercase tracking-wider text-[#9ca3af]">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className="h-10 rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm outline-none focus:border-[#fb5713]">{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <button onClick={add} disabled={busy || !reg} className="flex h-10 items-center gap-2 rounded-xl bg-[#fb5713] px-4 text-xs font-bold uppercase tracking-wider text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Add</button>
        {msg && <span className="text-xs text-red-600">{msg}</span>}
      </div>

      {(jobs.length > 0 || parts.length > 0) && (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
            <h2 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[#6b7280]">Maintenance in progress</h2>
            {jobs.length === 0 ? <p className="text-sm text-[#9ca3af]">Nothing in the hangar.</p> : (
              <div className="space-y-1.5">
                {jobs.map((j) => (
                  <div key={j.id} className="flex items-center justify-between text-xs">
                    <span><b className="font-mono text-[#1a1a1a]">{j.registration}</b> <span className="text-[#6b7280]">{j.category.replace(/_/g, " ")}</span>{j.location ? <span className="text-[#9ca3af]"> @ {j.location}</span> : ""}</span>
                    <span className="font-mono text-[10px] text-[#9ca3af]">{j.phase === "awaiting_part" ? "part inbound" : j.phase === "deferred" ? "waiting" : "repairing"} · {eta(j.etaAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
            <h2 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[#6b7280]">Parts in stock</h2>
            {parts.length === 0 ? <p className="text-sm text-[#9ca3af]">No spares held yet — parts are ordered on demand (factory ferry).</p> : (
              <div className="space-y-1.5">{parts.map((p) => <div key={p.part} className="flex items-center justify-between text-xs"><span className="text-[#6b7280]">{p.part}</span><span className="font-mono font-bold text-[#1a1a1a]">{p.qty}</span></div>)}</div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-6">
        {grouped.map((g) => (
          <section key={g.type}>
            <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[.2em] text-[#6b7280]"><Plane className="h-4 w-4 text-[#fb5713]" />{g.type} <span className="text-[#c7ccd4]">· {g.list.length}</span></h2>
            {g.list.length === 0 ? <p className="text-sm text-[#9ca3af]">None.</p> : (
              <div className="space-y-2">
                {g.list.map((a) => (
                  <div key={a.registration} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#e5e7eb] bg-white px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-[#1a1a1a]">{a.registration}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${STATUS_STYLE[a.status] ?? "bg-[#f3f4f6] text-[#6b7280]"}`}>{a.status.replace(/_/g, " ")}</span>
                      {a.assigned && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-sky-700">In use</span>}
                      {a.note && <span className="text-[11px] text-[#9ca3af]">{a.note}</span>}
                    </div>
                    <div className="flex gap-1.5">
                      {a.status !== "active" && <button onClick={() => returnToService(a.registration)} className="rounded-lg border border-emerald-200 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 hover:bg-emerald-50">Return to service</button>}
                      {a.status === "active" && <button onClick={() => ground(a.registration)} className="rounded-lg border border-[#e5e7eb] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#6b7280] hover:bg-[#f3f4f6]">Ground</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
