import { Router, type IRouter } from "express";
import {
  db, eq, and, desc, asc, inArray, sql,
  usersTable, flightsTable, timetableTable,
  aircraftTable, aircraftAssignmentsTable, delayReportsTable,
  maintenanceReportsTable, maintenanceJobsTable, partsInventoryTable,
  operationalEventsTable, agentTaskRunsTable, approvalsTable, agentStateTable,
} from "@workspace/db";
import {
  AGENTS, logEvent, requestApproval, autoActionAllowed,
  setPaused, setAutoApprove, recentRuns, onOpsEvent,
} from "../lib/ops-core";
import { collectTracking } from "../lib/tracking";
import { applyHold, clearHold, assignAircraft, findReplacement, sectorsForRegistration, notifyPilot, reassignOrCancel } from "../lib/fleet";
import { getConfig, setConfig, listModels, usageStats, isValidModel } from "../lib/ai";
import { getMany, toIcao } from "../lib/weather";
import { applyApproval } from "../lib/approvals";
import { hubConnected } from "../lib/ops";
import { MAINT_MINUTE_MS, skipDelivery, setSetting } from "../lib/maintenance";

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

// Realistic-routing preference: only see flights from the pilot's current spot.
router.get("/pilot/route-continuity", async (req, res): Promise<void> => {
  const u = await requireUser(req, res); if (!u) return;
  res.json({ enabled: !!u.routeContinuity });
});
router.post("/pilot/route-continuity", async (req, res): Promise<void> => {
  const u = await requireUser(req, res); if (!u) return;
  const enabled = req.body?.enabled === true || req.body?.enabled === "1";
  await db.update(usersTable).set({ routeContinuity: enabled }).where(eq(usersTable.id, u.id));
  res.json({ ok: true, enabled });
});

// Is the pilot hub (Sim Link desktop app) connected right now? Drives the
// warnings + whether a flight can be started / cleared.
router.get("/pilot/hub-status", async (req, res): Promise<void> => {
  const u = await requireUser(req, res); if (!u) return;
  const connected = await hubConnected(u.id);
  res.json({ connected, msfsRunning: !!u.msfsRunning, lastSeenAt: u.lastSeenAt ? new Date(u.lastSeenAt).toISOString() : null });
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

// ── Aviation weather ────────────────────────────────────────────────────────
router.get("/ops/weather", async (req, res): Promise<void> => {
  if (!(await requireUser(req, res))) return;
  const codes = String(req.query.codes || "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean).slice(0, 20);
  if (codes.length === 0) { res.json({ reports: {} }); return; }
  res.json({ reports: await getMany(codes) });
});

// ── Aircraft registration assigned to the pilot's own sectors ───────────────
// Lazily auto-assigns an available aircraft of the right type (respecting holds
// and double-booking) so the timetable can show a real registration.
router.get("/ops/assignments/mine", async (req, res): Promise<void> => {
  const u = await requireUser(req, res); if (!u) return;
  const entries = await db.select().from(timetableTable)
    .where(and(eq(timetableTable.userId, u.id), inArray(timetableTable.status, ["pending", "active"])));
  const map: Record<number, { registration: string; type: string } | null> = {};
  for (const e of entries) {
    // A pilot-side swap (aircraft_assignments) overrides the planned tail.
    const [a] = await db.select().from(aircraftAssignmentsTable)
      .where(and(eq(aircraftAssignmentsTable.timetableId, e.id), eq(aircraftAssignmentsTable.status, "assigned")));
    const [f] = await db.select().from(flightsTable).where(eq(flightsTable.id, e.flightId));
    const reg = a?.registration ?? f?.registration ?? null;
    if (reg) {
      const [ac] = await db.select().from(aircraftTable).where(eq(aircraftTable.registration, reg));
      map[e.id] = { registration: reg, type: ac?.type ?? f?.aircraft ?? "" };
    } else map[e.id] = null;
  }
  res.json({ assignments: map });
});

// ── Fleet admin: add / edit aircraft, assign to a sector ────────────────────
router.post("/ops/aircraft", async (req, res): Promise<void> => {
  const u = await requireAdmin(req, res); if (!u) return;
  const registration = String(req.body?.registration || "").trim().toUpperCase();
  const type = String(req.body?.type || "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,10}$/.test(registration)) { res.status(400).json({ error: "Enter a valid registration." }); return; }
  if (!["A320", "A20N", "A21N", "B788"].includes(type)) { res.status(400).json({ error: "Pick a valid fleet type." }); return; }
  const [existing] = await db.select().from(aircraftTable).where(eq(aircraftTable.registration, registration));
  if (existing) { res.status(409).json({ error: "That registration already exists." }); return; }
  await db.insert(aircraftTable).values({ registration, type, note: req.body?.note ?? null });
  await logEvent({ kind: "audit", actor: `user:${u.id}`, title: `Aircraft added — ${registration} (${type})`, refType: "aircraft", refId: registration });
  res.status(201).json({ ok: true });
});

// Ground an aircraft from the Fleet tab, optionally at an outstation. If it's
// away from a maintenance base, maintenance personnel are ferried up (1h prep +
// flight), the repair runs, then they ferry back to Sydney.
const MAINT_BASES = ["YSSY", "YBBN", "YPPH", "YMML"];
router.post("/ops/aircraft/:reg/ground", async (req, res): Promise<void> => {
  const u = await requireAdmin(req, res); if (!u) return;
  const reg = String(req.params.reg).toUpperCase();
  const [ac] = await db.select().from(aircraftTable).where(eq(aircraftTable.registration, reg));
  if (!ac) { res.status(404).json({ error: "Aircraft not found" }); return; }
  const reason = String(req.body?.reason || "Technical difficulties").slice(0, 300);
  const location = String(req.body?.location || "").trim().toUpperCase();
  const icao = location ? toIcao(location) : null;
  const outstation = !!icao && !MAINT_BASES.includes(icao);
  // maintenance !== false → run the maintenance engine (repair + auto-return).
  // When false, just park the aircraft; it stays grounded until Return to service.
  const withMaintenance = req.body?.maintenance !== false;

  await db.update(aircraftTable).set({ status: "grounded", note: reason, updatedAt: new Date() }).where(eq(aircraftTable.registration, reg));

  let etaAt: Date | null = null;
  if (withMaintenance) {
    const [rep] = await db.insert(maintenanceReportsTable).values({
      registration: reg, reportedByUserId: u.id, category: "other",
      description: `${location ? `At ${location}: ` : ""}${reason}`,
      status: "maintenance_hold", priority: "high", requestRestriction: true, holdActive: true,
    }).returning();

    // Pre-create the repair job (so the engine completes + returns it to service).
    const repairMinutes = 300; // generic ground
    const ferryOut = outstation ? 60 + 90 : 0; // prep + flight up
    const ferryBack = outstation ? 90 : 0;      // crew ferried back to SYD
    etaAt = new Date(Date.now() + (ferryOut + repairMinutes + ferryBack) * MAINT_MINUTE_MS);
    await db.insert(maintenanceJobsTable).values({
      registration: reg, reportId: rep.id, category: "other", repairMinutes,
      phase: "in_repair", etaAt, location: icao ?? (location || null),
      note: outstation ? `Maintenance personnel ferried to ${location}; crew return to SYD after the fix.` : "At base.",
    });
  }

  await logEvent({ kind: "aircraft_hold", severity: "critical", actor: `user:${u.id}`, agentKey: "maintenance",
    title: `${reg} grounded${location ? ` at ${location}` : ""}${withMaintenance ? "" : " (no maintenance)"}`,
    body: withMaintenance
      ? (outstation ? `${reason}. Ferrying maintenance up; ~${Math.round((((outstation ? 150 : 0) + 300 + (outstation ? 90 : 0)) / 60))}h to return to service.` : reason)
      : `${reason}. Parked — no maintenance; stays grounded until returned to service.`,
    refType: "aircraft", refId: reg });

  // Move its remaining booked flights to a spare, or cancel them.
  const moved = await reassignOrCancel(reg, `${reg} grounded: ${reason}`);
  res.json({ ok: true, etaAt: etaAt ? etaAt.toISOString() : null, outstation, maintenance: withMaintenance, ...moved });
});

// Live event stream for the AI Control Room (Server-Sent Events). Pushes each
// operational event the instant it's logged, so the feed is real-time.
router.get("/ops/stream", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  const send = (e: Record<string, unknown>) => { try { res.write(`event: ops\ndata: ${JSON.stringify(e)}\n\n`); } catch { /* ignore */ } };
  const off = onOpsEvent(send);
  const hb = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* ignore */ } }, 20_000);
  req.on("close", () => { clearInterval(hb); off(); res.end(); });
});

// Remove an aircraft from the fleet entirely. Its booked flights are moved to a
// same-airport replacement or cancelled, and any maintenance on it is cleared.
router.delete("/ops/aircraft/:reg", async (req, res): Promise<void> => {
  const u = await requireAdmin(req, res); if (!u) return;
  const reg = String(req.params.reg).toUpperCase();
  const [ac] = await db.select().from(aircraftTable).where(eq(aircraftTable.registration, reg));
  if (!ac) { res.status(404).json({ error: "Aircraft not found" }); return; }

  const moved = await reassignOrCancel(reg, `${reg} removed from the fleet`);
  await db.update(maintenanceJobsTable).set({ phase: "done", updatedAt: new Date() })
    .where(and(eq(maintenanceJobsTable.registration, reg), inArray(maintenanceJobsTable.phase, ["deferred", "awaiting_part", "in_repair"])));
  await db.update(maintenanceReportsTable).set({ holdActive: false, status: "closed", updatedAt: new Date() })
    .where(and(eq(maintenanceReportsTable.registration, reg), eq(maintenanceReportsTable.holdActive, true)));
  await db.delete(aircraftAssignmentsTable).where(eq(aircraftAssignmentsTable.registration, reg));
  await db.delete(aircraftTable).where(eq(aircraftTable.registration, reg));
  await logEvent({ kind: "audit", actor: `user:${u.id}`, agentKey: "fleet-manager", title: `Aircraft removed — ${reg}`, body: `${reg} removed from the fleet.`, refType: "aircraft", refId: reg });
  res.json({ ok: true, ...moved });
});

// Return an aircraft to service: clears its status, closes any maintenance
// hold/jobs/reports so the engine won't keep it grounded.
router.post("/ops/aircraft/:reg/return", async (req, res): Promise<void> => {
  const u = await requireAdmin(req, res); if (!u) return;
  const reg = String(req.params.reg).toUpperCase();
  const [ac] = await db.select().from(aircraftTable).where(eq(aircraftTable.registration, reg));
  if (!ac) { res.status(404).json({ error: "Aircraft not found" }); return; }
  await db.update(aircraftTable).set({ status: "active", note: null, updatedAt: new Date() }).where(eq(aircraftTable.registration, reg));
  await db.update(maintenanceJobsTable).set({ phase: "done", updatedAt: new Date() })
    .where(and(eq(maintenanceJobsTable.registration, reg), inArray(maintenanceJobsTable.phase, ["deferred", "awaiting_part", "in_repair"])));
  await db.update(maintenanceReportsTable).set({ holdActive: false, status: "resolved", updatedAt: new Date() })
    .where(and(eq(maintenanceReportsTable.registration, reg), eq(maintenanceReportsTable.holdActive, true)));
  await logEvent({ kind: "audit", actor: `user:${u.id}`, agentKey: "maintenance", title: `${reg} returned to service`, refType: "aircraft", refId: reg });
  res.json({ ok: true });
});

// Today's rotations, grouped by aircraft — the daily tail roster ops built.
router.get("/ops/rotations", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const now = Date.now();
  const horizon = now + 30 * 60 * 60_000; // next ~30h
  const rows = await db.select().from(flightsTable).orderBy(asc(flightsTable.departsAt));
  const byReg = new Map<string, { registration: string; type: string; legs: { time: string; dep: string; arr: string; flightNumber: string; departsAt: string | null }[] }>();
  for (const f of rows) {
    if (!f.registration || !f.departsAt) continue;
    const ms = new Date(f.departsAt).getTime();
    if (ms < now - 60 * 60_000 || ms > horizon) continue; // today-ish window
    const g = byReg.get(f.registration) ?? { registration: f.registration, type: f.aircraft, legs: [] };
    g.legs.push({ time: f.departureTime, dep: f.departure, arr: f.arrival, flightNumber: f.flightNumber, departsAt: f.departsAt ? new Date(f.departsAt).toISOString() : null });
    byReg.set(f.registration, g);
  }
  const rotations = [...byReg.values()]
    .map((r) => ({ ...r, legs: r.legs.sort((a, b) => (a.departsAt ?? "").localeCompare(b.departsAt ?? "")) }))
    .sort((a, b) => a.registration.localeCompare(b.registration));
  res.json({ rotations });
});

// Maintenance engine state (jobs + parts) for the dashboards.
router.get("/ops/maintenance/state", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const jobs = await db.select().from(maintenanceJobsTable).where(inArray(maintenanceJobsTable.phase, ["deferred", "awaiting_part", "in_repair"])).orderBy(desc(maintenanceJobsTable.createdAt));
  const parts = await db.select().from(partsInventoryTable).orderBy(partsInventoryTable.part);
  res.json({
    jobs: jobs.map((j) => ({ id: j.id, registration: j.registration, category: j.category, part: j.part, phase: j.phase, etaAt: j.etaAt ? j.etaAt.toISOString() : null, location: j.location, note: j.note })),
    parts: parts.map((p) => ({ part: p.part, qty: p.qty })),
    skipDelivery: await skipDelivery(),
  });
});

// Toggle "skip delivery time": parts arrive instantly, repair stays real-time.
router.post("/ops/maintenance/skip-delivery", async (req, res): Promise<void> => {
  const u = await requireAdmin(req, res); if (!u) return;
  const on = req.body?.enabled === true || req.body?.enabled === "1";
  await setSetting("skip_delivery_time", on ? "1" : "0");
  await logEvent({ kind: "audit", actor: `user:${u.id}`, agentKey: "maintenance", title: `Skip delivery time ${on ? "ON" : "OFF"}`, body: on ? "Parts are now fitted immediately; repairs still run in real time." : "Parts are ferried in from the factory again." });
  res.json({ ok: true, skipDelivery: on });
});

router.patch("/ops/aircraft/:reg", async (req, res): Promise<void> => {
  const u = await requireAdmin(req, res); if (!u) return;
  const reg = String(req.params.reg).toUpperCase();
  const [ac] = await db.select().from(aircraftTable).where(eq(aircraftTable.registration, reg));
  if (!ac) { res.status(404).json({ error: "Aircraft not found" }); return; }
  const patch: any = { updatedAt: new Date() };
  if (["A320", "A20N", "A21N", "B788"].includes(req.body?.type)) patch.type = req.body.type;
  if (["active", "maintenance_hold", "grounded"].includes(req.body?.status)) patch.status = req.body.status;
  if (typeof req.body?.note === "string") patch.note = req.body.note || null;
  await db.update(aircraftTable).set(patch).where(eq(aircraftTable.registration, reg));
  await logEvent({ kind: "audit", actor: `user:${u.id}`, title: `Aircraft updated — ${reg}`, refType: "aircraft", refId: reg });
  res.json({ ok: true });
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

// ── AI model configuration ──────────────────────────────────────────────────
router.get("/ops/ai-config", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const models = await listModels();
  const agents = [];
  for (const a of AGENTS) {
    const cfg = await getConfig(a.key);
    const usage = await usageStats(a.key);
    agents.push({ key: a.key, name: a.name, responsibility: a.responsibility,
      provider: cfg.provider, modelId: cfg.modelId, enabled: cfg.enabled,
      temperature: cfg.temperature, maxTokens: cfg.maxTokens, timeoutMs: cfg.timeoutMs,
      maxRetries: cfg.maxRetries, fallbackModelId: cfg.fallbackModelId, usage });
  }
  res.json({ keyConfigured: !!process.env.OPENROUTER_API_KEY, models, agents });
});

router.post("/ops/ai-config/:key", async (req, res): Promise<void> => {
  const u = await requireAdmin(req, res); if (!u) return;
  const key = String(req.params.key);
  if (!AGENTS.some((a) => a.key === key)) { res.status(404).json({ error: "Unknown agent" }); return; }
  const b = req.body ?? {};
  const patch: any = {};
  if (typeof b.modelId === "string" && b.modelId.trim()) patch.modelId = b.modelId.trim();
  if (typeof b.fallbackModelId === "string") patch.fallbackModelId = b.fallbackModelId.trim() || null;
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
  if (Number.isFinite(Number(b.temperature))) patch.temperature = Math.max(0, Math.min(2, Number(b.temperature)));
  if (Number.isFinite(Number(b.maxTokens))) patch.maxTokens = Math.max(16, Math.min(4000, Math.round(Number(b.maxTokens))));
  if (Number.isFinite(Number(b.timeoutMs))) patch.timeoutMs = Math.max(2000, Math.min(60000, Math.round(Number(b.timeoutMs))));
  if (Number.isFinite(Number(b.maxRetries))) patch.maxRetries = Math.max(0, Math.min(3, Math.round(Number(b.maxRetries))));

  let warning: string | undefined;
  if (patch.modelId && !(await isValidModel(patch.modelId))) warning = `"${patch.modelId}" isn't in your OpenRouter model list — saved anyway, but check the ID.`;
  await setConfig(key, patch);
  await logEvent({ kind: "audit", actor: `user:${u.id}`, title: `AI model updated — ${key}`, body: patch.modelId ? `model ${patch.modelId}` : "settings changed" });
  res.json({ ok: true, warning });
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
  const result = await applyApproval(a, u.id, `user:${u.id}`);
  const newStatus = result.ok ? "applied" : "failed";
  await db.update(approvalsTable).set({ status: newStatus, decidedByUserId: u.id, decidedAt: new Date(), appliedAt: result.ok ? new Date() : null, note: result.ok ? (req.body?.note ?? null) : result.error ?? "apply failed" }).where(eq(approvalsTable.id, id));
  await logEvent({ kind: "audit", severity: result.ok ? "info" : "warn", actor: `user:${u.id}`, title: `${result.ok ? "Applied" : "Apply failed"}: ${a.title}`, body: result.error ?? "", refType: "approval", refId: id });
  res.json({ ok: result.ok, status: newStatus, error: result.error });
});

// ── Fleet / aircraft ─────────────────────────────────────────────────────────
router.get("/ops/aircraft", async (req, res): Promise<void> => {
  if (!(await requireUser(req, res))) return;
  const list = await db.select().from(aircraftTable).orderBy(aircraftTable.type, aircraftTable.registration);
  const assigns = await db.select().from(aircraftAssignmentsTable).where(eq(aircraftAssignmentsTable.status, "assigned"));
  const busy = new Set(assigns.map(a => a.registration));
  res.json({ aircraft: list.map(a => ({ registration: a.registration, type: a.type, status: a.status, note: a.note, base: a.base, assigned: busy.has(a.registration) })) });
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

  // If the pilot flags it unfit → precautionary hold, then move its remaining
  // booked flights onto a spare (or cancel them). The Ops Manager auto-approves.
  if (requestRestriction) {
    await applyHold(registration, `Pilot report: ${category}`, { reportId: report.id, actor: `user:${u.id}` });
    await reassignOrCancel(registration, `${registration} on maintenance hold: ${category}`);
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
