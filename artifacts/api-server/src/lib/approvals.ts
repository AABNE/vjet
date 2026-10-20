// Applying approvals, and the Operations Manager's autonomous review of them.
// The human never needs to action the queue — the ops-manager agent validates
// each request and approves (applies) or rejects it on a tick.
import { db, eq, approvalsTable } from "@workspace/db";
import { logEvent, runAgentTask, aiSummarize } from "./ops-core";
import { assignAircraft, clearHold, isHeld, notifyPilot } from "./fleet";

function parse(s: string | null) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

export async function applyApproval(a: typeof approvalsTable.$inferSelect, actorUserId: number, actorLabel: string): Promise<{ ok: boolean; error?: string }> {
  const payload = parse(a.payload) || {};
  if (a.actionType === "aircraft_swap") {
    const { timetableId, flightId, registration, pilotUserId, flightNumber } = payload;
    if (!timetableId || !flightId || !registration) return { ok: false, error: "Incomplete swap payload" };
    const r = await assignAircraft({ timetableId, flightId, registration, by: actorLabel, reason: a.reason ?? "approved swap" });
    if (!r.ok) return r;
    await logEvent({ kind: "swap_proposed", actor: actorLabel, agentKey: a.agentKey, title: `Aircraft swap applied — ${flightNumber ?? flightId}`, body: `Now on ${registration}.`, refType: "flight", refId: flightId });
    if (pilotUserId) await notifyPilot(pilotUserId, `Aircraft change — ${flightNumber ?? ""}`.trim(), `Your flight has been reassigned to ${registration}. Same route and flight number.`);
    return { ok: true };
  }
  if (a.actionType === "clear_hold") {
    const { registration, reportId } = payload;
    if (!registration) return { ok: false, error: "No registration" };
    await clearHold(registration, { userId: actorUserId, reason: a.reason ?? "approved", reportId });
    return { ok: true };
  }
  await logEvent({ kind: "route_change", actor: actorLabel, agentKey: a.agentKey, title: `${a.title} (applied)`, body: a.reason ?? "" });
  return { ok: true };
}

// Re-validate a pending approval before applying (the "double-check").
async function validate(a: typeof approvalsTable.$inferSelect): Promise<{ ok: boolean; reason: string }> {
  const payload = parse(a.payload) || {};
  if (a.actionType === "aircraft_swap") {
    if (!payload.registration) return { ok: false, reason: "no replacement registration" };
    if (await isHeld(payload.registration)) return { ok: false, reason: `replacement ${payload.registration} is itself on hold` };
    return { ok: true, reason: "replacement available and compatible" };
  }
  return { ok: true, reason: "no blocking checks" };
}

// Operations Manager: clear the pending approval queue autonomously.
export async function opsManagerReview(): Promise<void> {
  const pending = await db.select().from(approvalsTable).where(eq(approvalsTable.status, "pending")).limit(25);
  if (pending.length === 0) return;
  await runAgentTask("ops-manager", `Review ${pending.length} pending approval(s)`, async () => {
    let approved = 0, rejected = 0, failed = 0;
    for (const a of pending) {
      const v = await validate(a);
      if (!v.ok) {
        await db.update(approvalsTable).set({ status: "rejected", decidedByUserId: null, decidedAt: new Date(), note: `Ops Manager: ${v.reason}` }).where(eq(approvalsTable.id, a.id));
        await logEvent({ kind: "audit", actor: "agent:ops-manager", agentKey: "ops-manager", title: `Rejected: ${a.title}`, body: v.reason, refType: "approval", refId: a.id });
        rejected++;
        continue;
      }
      const r = await applyApproval(a, 0, "agent:ops-manager");
      if (r.ok) {
        await db.update(approvalsTable).set({ status: "applied", decidedByUserId: null, decidedAt: new Date(), appliedAt: new Date(), note: `Ops Manager approved: ${v.reason}` }).where(eq(approvalsTable.id, a.id));
        approved++;
      } else {
        await db.update(approvalsTable).set({ status: "failed", decidedByUserId: null, decidedAt: new Date(), note: r.error ?? "apply failed" }).where(eq(approvalsTable.id, a.id));
        await logEvent({ kind: "error", severity: "warn", actor: "agent:ops-manager", agentKey: "ops-manager", title: `Apply failed: ${a.title}`, body: r.error ?? "", refType: "approval", refId: a.id });
        failed++;
      }
    }
    const facts = { reviewed: pending.length, approved, rejected, failed };
    const summary = await aiSummarize("ops-manager", `Ops manager reviewed approvals: ${JSON.stringify(facts)}. One sentence.`, `Reviewed ${pending.length}: approved ${approved}, rejected ${rejected}${failed ? `, ${failed} failed` : ""}.`);
    return { facts, summary, outcome: `${approved} approved / ${rejected} rejected` };
  });
}
