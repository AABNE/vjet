import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/components/auth-provider";
import { apiGet, apiPost } from "@/lib/api";
import { Cpu, Loader2, Check, ArrowLeft, AlertTriangle } from "lucide-react";

interface AgentCfg {
  key: string; name: string; responsibility: string; provider: string; modelId: string;
  enabled: boolean; temperature: number; maxTokens: number; timeoutMs: number; maxRetries: number;
  fallbackModelId: string | null;
  usage: { calls: number; errors: number; avgLatencyMs: number; tokens: number };
}
interface Model { id: string; name: string }

export default function AiModels() {
  const { user } = useAuth();
  const q = useQuery<{ keyConfigured: boolean; models: Model[]; agents: AgentCfg[] }>({ queryKey: ["ai-config"], queryFn: () => apiGet("/api/ops/ai-config"), retry: false });

  if (user && user.isAdmin !== true) {
    return <div className="mx-auto max-w-2xl rounded-2xl border border-[#e5e7eb] bg-white p-10 text-center text-[#6b7280]">AI model configuration is for administrators.</div>;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/control-room" className="mb-3 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[#9ca3af] hover:text-[#1a1a1a]"><ArrowLeft className="h-3.5 w-3.5" />Control Room</Link>
      <div className="mb-6">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Operations · AI</p>
        <h1 className="mt-2 text-5xl font-black uppercase leading-none tracking-tight text-[#1a1a1a] md:text-6xl">AI models</h1>
        <p className="mt-3 max-w-2xl text-sm text-[#6b7280]">Assign a model to each department. Models come from your OpenRouter account; keys stay on the server.</p>
      </div>

      {q.data && !q.data.keyConfigured && (
        <div className="mb-5 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4" /> No <code className="font-mono text-xs">OPENROUTER_API_KEY</code> on the server — agents fall back to templated summaries and the model list is empty.
        </div>
      )}

      <datalist id="model-list">
        {(q.data?.models ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </datalist>

      <div className="space-y-3">
        {(q.data?.agents ?? []).map((a) => <AgentRow key={a.key} agent={a} modelCount={q.data?.models.length ?? 0} onSaved={() => q.refetch()} />)}
        {!q.data && <div className="rounded-2xl border border-dashed border-[#e5e7eb] bg-white p-8 text-center text-sm text-[#9ca3af]"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>}
      </div>
    </div>
  );
}

function AgentRow({ agent, modelCount, onSaved }: { agent: AgentCfg; modelCount: number; onSaved: () => void }) {
  const [modelId, setModelId] = useState(agent.modelId);
  const [fallback, setFallback] = useState(agent.fallbackModelId || "");
  const [enabled, setEnabled] = useState(agent.enabled);
  const [temperature, setTemperature] = useState(agent.temperature);
  const [maxTokens, setMaxTokens] = useState(agent.maxTokens);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const r = await apiPost<{ warning?: string }>(`/api/ops/ai-config/${agent.key}`, { modelId, fallbackModelId: fallback, enabled, temperature, maxTokens });
      setMsg(r.warning || "Saved.");
      onSaved();
    } catch (e: any) { setMsg(e?.message || "Could not save."); }
    finally { setBusy(false); }
  }

  const fld = "h-9 rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm outline-none focus:border-[#fb5713]";
  return (
    <div className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Cpu className="h-4 w-4 text-[#fb5713]" /><span className="font-bold text-[#1a1a1a]">{agent.name}</span>
          <label className="ml-2 flex items-center gap-1.5 text-xs text-[#6b7280]"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-[#fb5713]" />Enabled</label>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-wider text-[#9ca3af]">{agent.usage.calls} calls · {agent.usage.errors} err · {agent.usage.avgLatencyMs}ms avg · {agent.usage.tokens} tok</span>
      </div>
      <p className="mt-1 text-xs text-[#9ca3af]">{agent.responsibility}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-[#9ca3af]">Model {modelCount > 0 ? `(${modelCount} available)` : ""}</span>
          <input list="model-list" value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="provider/model-id" className={fld} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-[#9ca3af]">Fallback model (optional)</span>
          <input list="model-list" value={fallback} onChange={(e) => setFallback(e.target.value)} placeholder="used if the primary fails" className={fld} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-[#9ca3af]">Temperature {temperature.toFixed(1)}</span>
          <input type="range" min={0} max={1.5} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="accent-[#fb5713]" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-[#9ca3af]">Max tokens</span>
          <input type="number" min={16} max={4000} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} className={fld} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} disabled={busy} className="flex items-center gap-2 rounded-xl bg-[#1a1a1a] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Save
        </button>
        {msg && <span className="text-[11px] text-[#6b7280]">{msg}</span>}
      </div>
    </div>
  );
}
