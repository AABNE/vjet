// Central AI model configuration + calling. Each agent can use a different
// model, temperature, token budget, timeout, retry count and fallback model.
// Keys stay server-side (OPENROUTER_API_KEY). Every call is metered.
import { db, eq, sql, aiConfigTable, aiUsageTable } from "@workspace/db";
import { logger } from "./logger";

const OPENROUTER = "https://openrouter.ai/api/v1";
// Safe default model for any agent without config. Must be a real OpenRouter id.
export const DEFAULT_MODEL = "meta-llama/llama-3.1-8b-instruct:free";
// Always-tried fallbacks (long-standing free models) so a bad/unavailable
// configured model still gets a working answer instead of a hard failure.
const BUILTIN_FALLBACKS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-2-9b-it:free",
  "mistralai/mistral-7b-instruct:free",
];

export interface ResolvedConfig {
  agentKey: string; provider: string; modelId: string; enabled: boolean;
  temperature: number; maxTokens: number; timeoutMs: number; maxRetries: number;
  fallbackModelId: string | null;
}

const DEFAULTS = (agentKey: string): ResolvedConfig => ({
  agentKey, provider: "openrouter", modelId: DEFAULT_MODEL, enabled: true,
  temperature: 0.4, maxTokens: 500, timeoutMs: 20000, maxRetries: 1, fallbackModelId: null,
});

let cfgCache: { at: number; rows: Record<string, ResolvedConfig> } | null = null;
async function loadConfigs(): Promise<Record<string, ResolvedConfig>> {
  if (cfgCache && Date.now() - cfgCache.at < 30_000) return cfgCache.rows;
  const rows: Record<string, ResolvedConfig> = {};
  try {
    for (const r of await db.select().from(aiConfigTable)) {
      rows[r.agentKey] = {
        agentKey: r.agentKey, provider: r.provider, modelId: r.modelId, enabled: r.enabled,
        temperature: r.temperature, maxTokens: r.maxTokens, timeoutMs: r.timeoutMs,
        maxRetries: r.maxRetries, fallbackModelId: r.fallbackModelId,
      };
    }
  } catch (e) { logger.warn({ e }, "loadConfigs failed"); }
  cfgCache = { at: Date.now(), rows };
  return rows;
}
export async function getConfig(agentKey: string): Promise<ResolvedConfig> {
  const rows = await loadConfigs();
  return rows[agentKey] ?? DEFAULTS(agentKey);
}
export async function setConfig(agentKey: string, patch: Partial<ResolvedConfig>): Promise<void> {
  const cur = await getConfig(agentKey);
  const next = { ...cur, ...patch };
  await db.insert(aiConfigTable).values({
    agentKey, provider: next.provider, modelId: next.modelId, enabled: next.enabled,
    temperature: next.temperature, maxTokens: next.maxTokens, timeoutMs: next.timeoutMs,
    maxRetries: next.maxRetries, fallbackModelId: next.fallbackModelId, updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: aiConfigTable.agentKey,
    set: { provider: next.provider, modelId: next.modelId, enabled: next.enabled, temperature: next.temperature,
      maxTokens: next.maxTokens, timeoutMs: next.timeoutMs, maxRetries: next.maxRetries, fallbackModelId: next.fallbackModelId, updatedAt: new Date() },
  });
  cfgCache = null;
}

// Live model catalogue from OpenRouter (validated list for the admin picker).
let modelsCache: { at: number; models: { id: string; name: string }[] } | null = null;
export async function listModels(): Promise<{ id: string; name: string }[]> {
  if (modelsCache && Date.now() - modelsCache.at < 600_000) return modelsCache.models;
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return [];
  try {
    const r = await fetch(`${OPENROUTER}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return modelsCache?.models ?? [];
    const d = await r.json() as any;
    const models = Array.isArray(d?.data) ? d.data.map((m: any) => ({ id: String(m.id), name: String(m.name ?? m.id) })).filter((m: any) => m.id) : [];
    if (models.length) modelsCache = { at: Date.now(), models };
    return models;
  } catch { return modelsCache?.models ?? []; }
}
export async function isValidModel(modelId: string): Promise<boolean> {
  const models = await listModels();
  if (models.length === 0) return true; // can't validate without the list; don't block
  return models.some((m) => m.id === modelId);
}

async function recordUsage(agentKey: string, model: string, ok: boolean, latencyMs: number, usage?: any, errorCode?: string) {
  try {
    await db.insert(aiUsageTable).values({
      agentKey, model, ok, latencyMs,
      promptTokens: usage?.prompt_tokens ?? null, completionTokens: usage?.completion_tokens ?? null,
      errorCode: errorCode ?? null,
    });
  } catch { /* metrics are best-effort */ }
}

async function callOnce(model: string, messages: any[], cfg: ResolvedConfig, key: string): Promise<{ text: string; usage: any }> {
  const r = await fetch(`${OPENROUTER}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "vJetstar Ops" },
    body: JSON.stringify({ model, messages, temperature: cfg.temperature, max_tokens: cfg.maxTokens }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!r.ok) {
    const detail = (await r.text().catch(() => "")).slice(0, 200);
    const err = new Error(`${r.status} ${detail}`) as any; err.status = r.status; throw err;
  }
  const d = await r.json() as any;
  return { text: d?.choices?.[0]?.message?.content?.trim?.() || "", usage: d?.usage };
}

export interface AiResult { ok: boolean; text: string; model: string; error?: string }

// Call the model configured for an agent. Honors enabled flag, retries, and the
// fallback model; records usage. Returns {ok:false} rather than throwing so
// agents degrade gracefully.
export async function aiComplete(agentKey: string, messages: { role: string; content: string }[]): Promise<AiResult> {
  const cfg = await getConfig(agentKey);
  if (!cfg.enabled) return { ok: false, text: "", model: cfg.modelId, error: "agent AI disabled" };
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, text: "", model: cfg.modelId, error: "no OPENROUTER_API_KEY" };

  const candidates = [...new Set([cfg.modelId, ...(cfg.fallbackModelId ? [cfg.fallbackModelId] : []), ...BUILTIN_FALLBACKS])];
  let lastErr = "";
  for (const model of candidates) {
    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
      const t0 = Date.now();
      try {
        const { text, usage } = await callOnce(model, messages, cfg, key);
        await recordUsage(agentKey, model, true, Date.now() - t0, usage);
        if (text) return { ok: true, text, model };
        lastErr = "empty response";
      } catch (e: any) {
        lastErr = String(e?.message ?? e).slice(0, 200);
        await recordUsage(agentKey, model, false, Date.now() - t0, undefined, String(e?.status ?? "err"));
      }
    }
  }
  return { ok: false, text: "", model: cfg.modelId, error: lastErr };
}

export async function usageStats(agentKey: string): Promise<{ calls: number; errors: number; avgLatencyMs: number; tokens: number }> {
  try {
    const [row] = await db.select({
      calls: sql<number>`count(*)`,
      errors: sql<number>`count(*) filter (where ok = false)`,
      avg: sql<number>`coalesce(avg(latency_ms), 0)`,
      tokens: sql<number>`coalesce(sum(coalesce(prompt_tokens,0) + coalesce(completion_tokens,0)), 0)`,
    }).from(aiUsageTable).where(eq(aiUsageTable.agentKey, agentKey));
    return { calls: Number(row?.calls ?? 0), errors: Number(row?.errors ?? 0), avgLatencyMs: Math.round(Number(row?.avg ?? 0)), tokens: Number(row?.tokens ?? 0) };
  } catch { return { calls: 0, errors: 0, avgLatencyMs: 0, tokens: 0 }; }
}
