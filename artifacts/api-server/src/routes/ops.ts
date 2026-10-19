import { Router, type IRouter } from "express";
import {
  db, eq, and, desc, inArray, sql,
  usersTable, flightsTable,
  aircraftTable, aircraftAssignmentsTable, delayReportsTable,
  maintenanceReportsTable,
  operationalEventsTable, agentTaskRunsTable, approvalsTable, agentStateTable,
} from "@workspace/db";
import {
  AGENTS, logEvent, requestApproval, autoActionAllowed,
  setPaused, setAutoApprove, recentRuns,
} from "../lib/ops-core";
import { collectTracking } from "../lib/tracking";
import { applyHold, clearHold, assignAircraft, findReplacement, sectorsForRegistration, notifyPilot } from "../lib/fleet";

const router: IRouter = Router();

async function getUser(req: any) {
  if (!req.session?.userId) return null;
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  return u ?? null;
}
async function requireUser(req: any, res: any) {
  const u = await getUser(req);
  if (!u) { res.status(401).json({ error: "Not authenticated" }); return null; }
  return u;
}
async function requireAdmin(req: any, res: any) {
  const u = await getUser(req);
  if (!u) { res.status(401).json({ error: "Not authenticated" }); return null; }
  if (u.isAdmin !== "true") { res.status(403).json({ error: "Admin access required" }); return null; }
  return u;
}
const parseJson = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

// ── Pilot tracking preference (profile) ─────────────────────────────────────
router.get("/pilot/tracking", async (req, res): Promise<void> => {
  const u = await requireUser(req, res); if (!u) return;
  res.json({ trackingMethod: u.trackingMethod, volantaUsername: u.volantaUsername });
});
router.post("/pilot/tracking", async (req, res): Promise<void> => {
  const u = await requireUser(req, res); if (!u) return;
  const method = req.body?.trackingMethod === "volanta" ? "volanta" : "simlink";
  let volanta: string | null = typeof req.body?.volantaUsername === "string" ? req.body.volantaUsername.trim() : null;
  if (volanta && !/^[A-Za-z0-9 _.\-]{2,40}$/.test(volanta)) { res.status(400).json({ error: "Enter a valid Volanta username." }); return; }
  if (method === "volanta" && !volanta) { res.status(400).json({ error: "A Volanta username is required for Xbox tracking." }); return; }
  if (method !== "volanta") volanta = volanta || null;
  await db.update(usersTable).set({ trackingMethod: method, volantaUsername: volanta }).where(eq(usersTable.id, u.id));
  res.json({ ok: true, trackingMethod: method, volantaUsername: volanta });
});

// ── Operations dashboard overview ───────────────────────────────────────────
router.get("/ops/overview", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const tracks = await collectTracking();
  const aircraft = await db.select().from(aircraftTable);
  const held = aircraft.filter((a) => a.status !== "active");
  const openDelays = await db.select().from(delayReportsTable).where(inArray(delayReportsTable.status, ["draft", "notified"]));
  const openMaint = await db.select().from(maintenanceReportsTable).where(inArray(maintenanceReportsTable.status, ["submitted", "under_review", "awaiting_info", "maintenance_hold"]));
  const pendingApprovals = await db.select({ n: sql<number>`count(*)` }).from(approvalsTable).where(eq(approvalsTable.status, "pending"));
  const events = await db.select().from(operationalEventsTable).orderBy(desc(operationalEventsTable.createdAt)).limit(10);

  res.json({
    flights: {
      active: tracks.filter((t) => t.flightStatus.toLowerCase() === "active").length,
      delayed: tracks.filter((t) => t.status === "confirmed_delay" || t.status === "possible_delay").length,
      trackingUnavailable: tracks.filter((t) => t.status === "tracking_unavailable").length,
    },
    tracks,
    fleet: { total: aircraft.length, available: aircraft.length - held.length, held: held.map((a) => ({ registration: a.registration, type: a.type, status: a.status, note: a.note })) },
    openDelays: openDelays.length,
    openMaintenance: openMaint.length,
    pendingApprovals: Number(pendingApprovals[0]?.n ?? 0),
    recentEvents: events.map(ev => ({ id: ev.id, kind: ev.kind, severity: ev.severity, title: ev.title, body: ev.body, createdAt: ev.createdAt.toISOString() })),
  });
});

// Live tracking feed (admin + used by map).
router.get("/ops/tracking", async (req, res): Promise<void> => {
  if (!(await requireUser(req, res))) return;
  res.json({ tracks: await collectTracking() });
});

// ── AI Control Room ─────────────────────────────────────────────────────────
router.get("/ops/agents", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const states = await db.select().from(agentStateTable);
  const stateByKey = new Map(states.map((s) => [s.agentKey, s]));
  const global = stateByKey.get("global");

  const result = [];
  for (const a of AGENTS) {
    const [last] = await recentRuns(a.key, 1);
    const counts = await db.select({
      completed: sql<number>`count(*) filter (where status = 'completed')`,
      failed: sql<number>`count(*) filter (where status = 'error')`,
    }).from(agentTaskRunsTable).where(eq(agentTaskRunsTable.agentKey, a.key));
    const st = stateByKey.get(a.key);
    const paused = !!(st?.paused || global?.paused);
    let status = "idle";
    if (paused) status = "paused";
    else if (last?.status === "working") status = "working";
    else if (last?.status === "error") status = "error";
    else if (last?.status === "waiting_approval") status = "waiting_approval";
    else if (last?.status === "completed") status = "idle";
    result.push({
      key: a.key, name: a.name, responsibility: a.responsibility, model: a.model,
      status,
      currentTask: last?.status === "working" ? last.task : null,
      lastActivity: last?.startedAt ? last.startedAt.toISOString() : null,
      lastSummary: last?.summary ?? null,
      lastError: last?.status === "error" ? last.error : null,
      completed: Number(counts[0]?.completed ?? 0),
      failed: Number(counts[0]?.failed ?? 0),
      autoApprove: parseJson(st?.autoApprove ?? "[]") ?? [],
    });
  }
  res.json({ globalPaused: !!global?.paused, agents: result });
});

// Live event feed.
router.get("/ops/events", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const limit = Math.min(200, Number(req.query.limit) || 60);
  const rows = await db.select().from(operationalEventsTable).orderBy(desc(operationalEventsTable.createdAt)).limit(limit);
  res.json({ events: rows.map(e => ({ id: e.id, kind: e.kind, severity: e.severity, title: e.title, body: e.body, agentKey: e.agentKey, refType: e.refType, refId: e.refId, taskRunId: e.taskRunId, createdAt: e.createdAt.toISOString() })) });
});

// Task history (searchable/filterable) + single-task decision trace.
router.get("/ops/tasks", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const agentKey = req.query.agent ? String(req.query.agent) : null;
  const status = req.query.status ? String(req.query.status) : null;
  const conds = [];
  if (agentKey) conds.push(eq(agentTaskRunsTable.agentKey, agentKey));
  if (status) conds.push(eq(agentTaskRunsTable.status, status));
  const rows = await db.select().from(agentTaskRunsTable)
    .where(conds.length ? and(...conds) : undefined as any)
    .orderBy(desc(agentTaskRunsTable.startedAt)).limit(100);
  res.json({ tasks: rows.map(t => ({
    id: t.id, agentKey: t.agentKey, status: t.status, task: t.task, objective: t.objective,
    refType: t.refType, refId: t.refId, facts: parseJson(t.facts), summary: t.summary,
    proposedAction: t.proposedAction, outcome: t.outcome, error: t.error,
    startedAt: t.startedAt.toISOString(), finishedAt: t.finishedAt ? t.finishedAt.toISOString() : null,
  })) });
});

// Agent controls.
router.post("/ops/agents/:key/pause", async (req, res): Promise<void> => {
  const u = await requireAdmin(req, res); if (!u) return;
  const key = String(req.params.key);
  if (key !== "global" && !AGENTS.some(a => a.key === key)) { res.status(404).json({ error: "Unknown agent" }); return; }
  await setPaused(key, true);
  await logEvent({ kind: "audit", actor: `user:${u.id}`, title: `${key} paused`, body: "Autonomous actions paused by admin." });
  res.json({ ok: true });
});
router.post("/ops/agents/:key/resume", async (req, res): Promise<void> => {
  const u = await requireAdmin(req, res); if (!u) return;
  const key = String(req.params.key);
  await setPaused(key, false);
  await logEvent({ kind: "audit", actor: `user:${u.id}`, title: `${key} resumed` });
  res.json({ ok: true });
});
router.post("/ops/agents/:key/auto-actions", async (req, res): Promise<void> => {
  const u = await requireAdmin(req, res); if (!u) return;
  const key = String(req.params.key);
  const actions = Array.isArray(req.body?.actions) ? req.body.actions.map(String) : [];
  await setAutoApprove(key, actions);
  await logEvent({ kind: "audit", actor: `user:${u.id}`, title: `${key} auto-actions updated`, body: actions.join(", ") || "none" });
  res.json({ ok: true });
});

// ── Approval queue ───────────────────────────────────────────────────────────
router.get("/ops/approvals", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const status = req.query.status ? String(req.query.status) : "pending";
  const rows = await db.select().from(approvalsTable)
    .where(status === "all" ? undefined as any : eq(approvalsTable.status, status))
    .orderBy(desc(approvalsTable.createdAt)).limit(100);
  res.json({ approvals: rows.map(a => ({
    id: a.id, agentKey: a.agentKey, actionType: a.actionType, title: a.title, reason: a.reason,
    payload: parseJson(a.payload), affected: parseJson(a.affected), validation: parseJson(a.validation),
    status: a.status, note: a.note, createdAt: a.createdAt.toISOString(),
    decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
  })) });
});

router.post("/ops/approvals/:id/:decision", async (req, res): Promise<void> => {
  const u = await requireAdmin(req, res); if (!u) return;
  const id = parseInt(String(req.params.id), 10);
  const decision = String(req.params.decision);
  if (!["approve", "reject"].includes(decision)) { res.status(400).json({ error: "Bad decision" }); return; }
  const [a] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, id));
  if (!a) { res.status(404).json({ error: "Approval not found" }); return; }
  if (a.status !== "pending") { res.status(409).json({ error: "Already decided." }); return; }

  if (decision === "reject") {
    await db.update(approvalsTable).set({ status: "rejected", decidedByUserId: u.id, decidedAt: new Date(), note: req.body?.note ?? null }).where(eq(approvalsTable.id, id));
    await logEvent({ kind: "audit", actor: `user:${u.id}`, title: `Rejected: ${a.title}`, refType: "approval", refId: id });
    res.json({ ok: true, status: "rejected" }); return;
  }

  // Approve → execute the real backend action, then mark applied.
  const result = await applyApproval(a, u.id);
  const newStatus = result.ok ? "applied" : "failed";
  await db.update(approvalsTable).set({ status: newStatus, decidedByUserId: u.id, decidedAt: new Date(), appliedAt: result.ok ? new Date() : null, note: result.ok ? (req.body?.note ?? null) : result.error ?? "apply failed" }).where(eq(approvalsTable.id, id));
  await logEvent({ kind: "audit", severity: result.ok ? "info" : "warn", actor: `user:${u.id}`, title: `${result.ok ? "Applied" : "Apply failed"}: ${a.title}`, body: result.error ?? "", refType: "approval", refId: id });
  res.json({ ok: result.ok, status: newStatus, error: result.error });
});

async function applyApproval(a: typeof approvalsTable.$inferSelect, userId: number): Promise<{ ok: boolean; error?: string }> {
  const payload = parseJson(a.payload) || {};
  if (a.actionType === "aircraft_swap") {
    const { timetableId, flightId, registration, pilotUserId, flightNumber } = payload;
    if (!timetableId || !flightId || !registration) return { ok: false, error: "Incomplete swap payload" };
    const r = await assignAircraft({ timetableId, flightId, registration, by: `user:${userId}`, reason: a.reason ?? "approved swap" });
    if (!r.ok) return r;
    await logEvent({ kind: "swap_proposed", actor: `user:${userId}`, agentKey: a.agentKey, title: `Aircraft swap applied — ${flightNumber ?? flightId}`, body: `Now on ${registration}.`, refType: "flight", refId: flightId });
    if (pilotUserId) await notifyPilot(pilotUserId, `Aircraft change — ${flightNumber ?? ""}`.trim(), `Your flight has been reassigned to ${registration}. Same route and flight number.`);
    return { ok: true };
  }
  if (a.actionType === "clear_hold") {
    const { registration, reportId } = payload;
    if (!registration) return { ok: false, error: "No registration" };
    await clearHold(registration, { userId, reason: a.reason ?? "approved", reportId });
    return { ok: true };
  }
  // route_change / flight_cancel: recorded + logged (timetable left intact for safety).
  await logEvent({ kind: "route_change", actor: `user:${userId}`, agentKey: a.agentKey, title: `${a.title} (applied)`, body: a.reason ?? "" });
  return { ok: true };
}

// ── Fleet / aircraft ─────────────────────────────────────────────────────────
router.get("/ops/aircraft", async (req, res): Promise<void> => {
  if (!(await requireUser(req, res))) return;
  const list = await db.select().from(aircraftTable).orderBy(aircraftTable.type, aircraftTable.registration);
  const assigns = await db.select().from(aircraftAssignmentsTable).where(eq(aircraftAssignmentsTable.status, "assigned"));
  const busy = new Set(assigns.map(a => a.registration));
  res.json({ aircraft: list.map(a => ({ registration: a.registration, type: a.type, status: a.status, note: a.note, assigned: busy.has(a.registration) })) });
});

// ── Maintenance: pilot reports an aircraft issue ────────────────────────────
router.post("/maintenance/report", async (req, res): Promise<void> => {
  const u = await requireUser(req, res); if (!u) return;
  const b = req.body ?? {};
  const registration = String(b.registration || "").trim().toUpperCase();
  const category = String(b.category || "other").trim();
  const description = String(b.description || "").trim().slice(0, 2000);
  const phase = ["pre_departure", "in_flight", "after_landing", "unknown"].includes(b.phase) ? b.phase : "unknown";
  const requestRestriction = !!b.requestRestriction;
  const flightId = Number.isFinite(Number(b.flightId)) ? Number(b.flightId) : null;
  if (!/^[A-Z0-9-]{3,10}$/.test(registration)) { res.status(400).json({ error: "Enter a valid aircraft registration." }); return; }
  if (description.length < 5) { res.status(400).json({ error: "Describe the issue (at least a few words)." }); return; }

  const [report] = await db.insert(maintenanceReportsTable).values({
    registration, reportedByUserId: u.id, flightId,
    category, description, phase, requestRestriction,
    status: requestRestriction ? "maintenance_hold" : "submitted",
    priority: requestRestriction ? "high" : "normal",
  }).returning();

  await logEvent({ kind: "report_created", severity: requestRestriction ? "critical" : "info", actor: `user:${u.id}`, agentKey: "maintenance",
    title: `Aircraft issue reported — ${registration}`, body: `${category}: ${description.slice(0, 160)}`, refType: "maintenance_report", refId: report.id });

  // If the pilot flags it unfit → precautionary hold + fleet manager proposes swaps.
  if (requestRestriction) {
    const { affected } = await applyHold(registration, `Pilot report: ${category}`, { reportId: report.id, actor: `user:${u.id}` });
    // Propose a replacement per affected sector (auto-apply only if configured).
    for (const s of affected) {
      if (!s.flight) continue;
      const replacement = await findReplacement(s.flight.aircraft, registration);
      if (!replacement) {
        await logEvent({ kind: "schedule_conflict", severity: "warn", agentKey: "fleet-manager", title: `No replacement for ${s.flight.flightNumber}`, body: `No available ${s.flight.aircraft} to replace ${registration}. Flag for review.`, refType: "flight", refId: s.flight.id });
        continue;
      }
      const payload = { timetableId: s.timetable.id, flightId: s.flight.id, registration: replacement, pilotUserId: s.timetable.userId, flightNumber: s.flight.flightNumber };
      if (await autoActionAllowed("fleet-manager", "aircraft_swap")) {
        const r = await assignAircraft({ timetableId: s.timetable.id, flightId: s.flight.id, registration: replacement, by: "agent:fleet-manager", reason: "auto swap (aircraft on hold)" });
        if (r.ok) {
          await logEvent({ kind: "swap_proposed", agentKey: "fleet-manager", title: `Auto swap — ${s.flight.flightNumber} → ${replacement}`, refType: "flight", refId: s.flight.id });
          await notifyPilot(s.timetable.userId, `Aircraft change — ${s.flight.flightNumber}`, `${registration} is on a maintenance hold; you've been moved to ${replacement}.`);
        }
      } else {
        await requestApproval({ agentKey: "fleet-manager", actionType: "aircraft_swap",
          title: `Swap ${s.flight.flightNumber}: ${registration} → ${replacement}`,
          reason: `${registration} on maintenance hold`, payload,
          affected: { flightNumber: s.flight.flightNumber, pilotUserId: s.timetable.userId },
          validation: { compatibleType: true, replacementAvailable: true } });
      }
    }
  }
  res.status(201).json({ ok: true, id: report.id, status: report.status });
});

// Pilot's own maintenance reports.
router.get("/maintenance/mine", async (req, res): Promise<void> => {
  const u = await requireUser(req, res); if (!u) return;
  const rows = await db.select().from(maintenanceReportsTable)
    .where(eq(maintenanceReportsTable.reportedByUserId, u.id)).orderBy(desc(maintenanceReportsTable.createdAt)).limit(50);
  res.json({ reports: rows.map(serializeMaint) });
});

function serializeMaint(m: typeof maintenanceReportsTable.$inferSelect) {
  return { id: m.id, registration: m.registration, category: m.category, description: m.description, phase: m.phase,
    status: m.status, priority: m.priority, holdActive: m.holdActive, findings: m.findings,
    requestRestriction: m.requestRestriction, createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString() };
}

// ── Maintenance admin dashboard ─────────────────────────────────────────────
router.get("/maintenance", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const status = req.query.status ? String(req.query.status) : null;
  const rows = await db.select().from(maintenanceReportsTable)
    .where(status ? eq(maintenanceReportsTable.status, status) : undefined as any)
    .orderBy(desc(maintenanceReportsTable.createdAt)).limit(200);
  // enrich with reporter + affected upcoming sectors count
  const out = [];
  for (const m of rows) {
    const reporter = m.reportedByUserId ? (await db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.id, m.reportedByUserId)))[0]?.username : null;
    const affected = m.holdActive ? (await sectorsForRegistration(m.registration)).length : 0;
    out.push({ ...serializeMaint(m), reporter, affectedSectors: affected });
  }
  res.json({ reports: out });
});

router.post("/maintenance/:id/:action", async (req, res): Promise<void> => {
  const u = await requireAdmin(req, res); if (!u) return;
  const id = parseInt(String(req.params.id), 10);
  const action = String(req.params.action);
  const [m] = await db.select().from(maintenanceReportsTable).where(eq(maintenanceReportsTable.id, id));
  if (!m) { res.status(404).json({ error: "Report not found" }); return; }

  if (action === "hold") {
    await applyHold(m.registration, req.body?.reason || "Admin maintenance hold", { reportId: id, actor: `user:${u.id}` });
  } else if (action === "clear-hold") {
    await clearHold(m.registration, { userId: u.id, reason: req.body?.reason || "Reviewed and cleared", reportId: id });
  } else if (action === "priority") {
    const p = ["low", "normal", "high"].includes(req.body?.priority) ? req.body.priority : "normal";
    await db.update(maintenanceReportsTable).set({ priority: p, updatedAt: new Date() }).where(eq(maintenanceReportsTable.id, id));
  } else if (action === "assign") {
    await db.update(maintenanceReportsTable).set({ reviewerUserId: u.id, status: "under_review", updatedAt: new Date() }).where(eq(maintenanceReportsTable.id, id));
  } else if (action === "findings") {
    await db.update(maintenanceReportsTable).set({ findings: String(req.body?.findings || "").slice(0, 2000), updatedAt: new Date() }).where(eq(maintenanceReportsTable.id, id));
  } else if (action === "resolve") {
    await db.update(maintenanceReportsTable).set({ status: "resolved", updatedAt: new Date() }).where(eq(maintenanceReportsTable.id, id));
    await logEvent({ kind: "audit", actor: `user:${u.id}`, agentKey: "maintenance", title: `Maintenance report #${id} resolved`, refType: "maintenance_report", refId: id });
  } else { res.status(400).json({ error: "Unknown action" }); return; }
  res.json({ ok: true });
});

// ── Delay reports (paperwork) ───────────────────────────────────────────────
router.get("/ops/delays/mine", async (req, res): Promise<void> => {
  const u = await requireUser(req, res); if (!u) return;
  const rows = await db.select().from(delayReportsTable).where(eq(delayReportsTable.pilotUserId, u.id)).orderBy(desc(delayReportsTable.createdAt)).limit(50);
  res.json({ delays: await enrichDelays(rows) });
});
router.get("/ops/delays", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await db.select().from(delayReportsTable).orderBy(desc(delayReportsTable.createdAt)).limit(200);
  res.json({ delays: await enrichDelays(rows) });
});
router.post("/ops/delays/:id/confirm", async (req, res): Promise<void> => {
  const u = await requireUser(req, res); if (!u) return;
  const id = parseInt(String(req.params.id), 10);
  const [d] = await db.select().from(delayReportsTable).where(eq(delayReportsTable.id, id));
  if (!d) { res.status(404).json({ error: "Delay report not found" }); return; }
  if (u.isAdmin !== "true" && d.pilotUserId !== u.id) { res.status(403).json({ error: "Not your report." }); return; }
  const category = String(req.body?.category || d.category);
  const reason = String(req.body?.reason || "").slice(0, 500);
  await db.update(delayReportsTable).set({ category, reason, status: "confirmed", updatedAt: new Date() }).where(eq(delayReportsTable.id, id));
  await logEvent({ kind: "audit", actor: `user:${u.id}`, title: `Delay cause confirmed — report #${id}`, body: `${category}${reason ? `: ${reason}` : ""}`, refType: "delay_report", refId: id });
  res.json({ ok: true });
});

async function enrichDelays(rows: (typeof delayReportsTable.$inferSelect)[]) {
  const out = [];
  for (const d of rows) {
    const f = d.flightId ? (await db.select().from(flightsTable).where(eq(flightsTable.id, d.flightId)))[0] : null;
    out.push({ id: d.id, status: d.status, category: d.category, reason: d.reason, delayMinutes: d.delayMinutes,
      scheduledDepAt: d.scheduledDepAt ? d.scheduledDepAt.toISOString() : null,
      estimatedAt: d.estimatedAt ? d.estimatedAt.toISOString() : null, createdBy: d.createdBy,
      flight: f ? { flightNumber: f.flightNumber, departure: f.departure, arrival: f.arrival, aircraft: f.aircraft } : null,
      createdAt: d.createdAt.toISOString() });
  }
  return out;
}

export default router;
