// Shared operations core — the single source of truth helpers every agent and
// route uses: event logging, agent task-run lifecycle, the approval queue, pause
// state, and AI decision summaries (reusing the existing OpenRouter key).
import {
  db, eq, desc,
  operationalEventsTable,
  agentTaskRunsTable,
  approvalsTable,
  agentStateTable,
} from "@workspace/db";
import { logger } from "./logger";

export type Severity = "info" | "warn" | "critical";

// The fixed agent registry. Status is derived from their task runs at read time.
export const AGENTS: { key: string; name: string; responsibility: string; model: string }[] = [
  { key: "ops-manager", name: "Operations Manager", responsibility: "Oversees operational status, coordinates agents, manages escalation and approvals.", model: "openrouter:gemma" },
  { key: "flight-monitor", name: "Flight Monitoring", responsibility: "Watches tracking + schedule, detects delays and stale tracking, raises delay reports.", model: "rule-based" },
  { key: "fleet-manager", name: "Fleet Manager", responsibility: "Monitors aircraft availability/rotations, proposes swaps, blocks held aircraft.", model: "rule-based" },
  { key: "schedule-planner", name: "Schedule & Network Planner", responsibility: "Detects schedule conflicts, proposes route/timetable changes, checks downstream impact.", model: "rule-based" },
  { key: "crew-controller", name: "Crew Controller", responsibility: "Monitors pilot assignment conflicts and coordinates change notifications.", model: "rule-based" },
  { key: "maintenance", name: "Maintenance Management", responsibility: "Receives tech reports, prioritises, tracks holds; never declares an aircraft airworthy.", model: "rule-based" },
  { key: "dispatch", name: "Dispatch", responsibility: "Reviews dispatch records, flags missing info/holds, blocks not-ready flights.", model: "rule-based" },
  { key: "comms", name: "Discord Communications", responsibility: "Sends approved notifications, records delivery, prevents duplicates.", model: "rule-based" },
  { key: "reporting", name: "Reporting", responsibility: "Produces operations summaries of delays, utilisation, maintenance and changes.", model: "openrouter:gemma" },
];
export const AGENT_KEYS = AGENTS.map((a) => a.key);

export async function logEvent(e: {
  kind: string; title: string; body?: string; severity?: Severity;
  agentKey?: string; actor?: string; refType?: string; refId?: string | number; taskRunId?: number;
}): Promise<void> {
  try {
    await db.insert(operationalEventsTable).values({
      kind: e.kind,
      title: e.title,
      body: e.body ?? "",
      severity: e.severity ?? "info",
      agentKey: e.agentKey ?? null,
      actor: e.actor ?? (e.agentKey ? `agent:${e.agentKey}` : "system"),
      refType: e.refType ?? null,
      refId: e.refId != null ? String(e.refId) : null,
      taskRunId: e.taskRunId ?? null,
    });
  } catch (err) {
    logger.warn({ err }, "logEvent failed");
  }
}

export interface TaskResult {
  summary?: string;
  proposedAction?: string;
  outcome?: string;
  facts?: unknown;
  status?: "completed" | "error" | "waiting_approval";
}

// Run an agent task with full lifecycle logging. `fn` does the work and returns a
// TaskResult; throwing marks the run as an error. Returns the task run id.
export async function runAgentTask(
  agentKey: string,
  task: string,
  fn: (ctx: { taskRunId: number }) => Promise<TaskResult | void>,
  opts: { objective?: string; refType?: string; refId?: string | number } = {},
): Promise<number | null> {
  let id: number | null = null;
  try {
    const [row] = await db.insert(agentTaskRunsTable).values({
      agentKey, status: "working", task,
      objective: opts.objective ?? null,
      refType: opts.refType ?? null,
      refId: opts.refId != null ? String(opts.refId) : null,
    }).returning();
    id = row.id;
  } catch (err) {
    logger.warn({ err }, "runAgentTask: could not open task run");
  }
  try {
    const res = (await fn({ taskRunId: id ?? -1 })) || {};
    if (id != null) {
      await db.update(agentTaskRunsTable).set({
        status: res.status ?? "completed",
        summary: res.summary ?? null,
        proposedAction: res.proposedAction ?? null,
        outcome: res.outcome ?? null,
        facts: res.facts != null ? JSON.stringify(res.facts) : null,
        finishedAt: new Date(),
      }).where(eq(agentTaskRunsTable.id, id));
    }
    return id;
  } catch (err: any) {
    if (id != null) {
      await db.update(agentTaskRunsTable).set({
        status: "error", error: String(err?.message ?? err).slice(0, 500), finishedAt: new Date(),
      }).where(eq(agentTaskRunsTable.id, id)).catch(() => {});
    }
    await logEvent({ kind: "error", severity: "warn", title: `${agentKey} task failed`, body: String(err?.message ?? err).slice(0, 300), agentKey, taskRunId: id ?? undefined });
    return id;
  }
}

// ── Pause / auto-action config ──────────────────────────────────────────────
async function getState(agentKey: string) {
  const [row] = await db.select().from(agentStateTable).where(eq(agentStateTable.agentKey, agentKey));
  return row ?? null;
}
export async function isPaused(agentKey: string): Promise<boolean> {
  const [g, a] = await Promise.all([getState("global"), getState(agentKey)]);
  return !!(g?.paused || a?.paused);
}
export async function autoActionAllowed(agentKey: string, actionType: string): Promise<boolean> {
  const g = await getState("global");
  if (g?.paused) return false;
  const a = await getState(agentKey);
  if (a?.paused) return false;
  try { return (JSON.parse(a?.autoApprove ?? "[]") as string[]).includes(actionType); }
  catch { return false; }
}
export async function setPaused(agentKey: string, paused: boolean): Promise<void> {
  await db.insert(agentStateTable).values({ agentKey, paused, updatedAt: new Date() })
    .onConflictDoUpdate({ target: agentStateTable.agentKey, set: { paused, updatedAt: new Date() } });
}
export async function setAutoApprove(agentKey: string, actionTypes: string[]): Promise<void> {
  const json = JSON.stringify(actionTypes);
  await db.insert(agentStateTable).values({ agentKey, autoApprove: json, updatedAt: new Date() })
    .onConflictDoUpdate({ target: agentStateTable.agentKey, set: { autoApprove: json, updatedAt: new Date() } });
}

// ── Approvals ────────────────────────────────────────────────────────────────
export async function requestApproval(a: {
  agentKey: string; actionType: string; title: string; reason?: string;
  payload?: unknown; affected?: unknown; validation?: unknown;
}): Promise<number | null> {
  try {
    const [row] = await db.insert(approvalsTable).values({
      agentKey: a.agentKey, actionType: a.actionType, title: a.title, reason: a.reason ?? null,
      payload: a.payload != null ? JSON.stringify(a.payload) : null,
      affected: a.affected != null ? JSON.stringify(a.affected) : null,
      validation: a.validation != null ? JSON.stringify(a.validation) : null,
    }).returning();
    await logEvent({ kind: "approval_requested", severity: "warn", title: a.title, body: a.reason ?? "", agentKey: a.agentKey, refType: "approval", refId: row.id });
    return row.id;
  } catch (err) {
    logger.warn({ err }, "requestApproval failed");
    return null;
  }
}

export async function recentRuns(agentKey: string, limit = 1) {
  return db.select().from(agentTaskRunsTable)
    .where(eq(agentTaskRunsTable.agentKey, agentKey))
    .orderBy(desc(agentTaskRunsTable.startedAt))
    .limit(limit);
}

// ── AI decision summary (reuses the OpenRouter key; degrades to templated) ──
export async function aiSummarize(prompt: string, fallback: string): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return fallback;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemma-4-26b-a4b-it:free",
        messages: [
          { role: "system", content: "You are an airline operations controller. Write ONE concise sentence (max 30 words) summarising the decision and why. No preamble." },
          { role: "user", content: prompt },
        ],
        max_tokens: 80, temperature: 0.3,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return fallback;
    const d = await r.json() as any;
    return (d?.choices?.[0]?.message?.content?.trim?.() || fallback).slice(0, 300);
  } catch {
    return fallback;
  }
}
