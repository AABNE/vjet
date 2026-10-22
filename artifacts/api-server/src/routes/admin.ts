import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, timetableTable, flightsTable, userReportsTable, eq, ne, desc } from "@workspace/db";
import { addInfraction, notify } from "../lib/ops";
import { listSessionsForAdmin } from "../lib/cockpit";
import { backfillFromApplications, deleteUserCascade } from "../lib/account-info";

import {
  CreateAdminUserBody,
  GetAdminFlightsResponse,
  GetAdminUsersResponse,
  UpdateAdminUserBody,
  UpdateAdminUserResponse,
} from "@workspace/api-zod";

const DEFAULT_PASSWORD = "Vjet1234";

const router: IRouter = Router();

// Normalise an admin-supplied VATSIM CID. Empty/blank clears it (null). A
// non-empty value must be numeric (VATSIM CIDs are digits). Returns the value
// to store, or { error } for a bad input.
function normalizeCid(raw: unknown): { value: string | null } | { error: string } {
  if (raw === undefined || raw === null) return { value: null };
  const cid = String(raw).trim();
  if (cid === "") return { value: null };
  if (!/^[0-9]{1,12}$/.test(cid)) return { error: "Enter a valid VATSIM CID (digits only)." };
  return { value: cid };
}

async function requireAdmin(req: any, res: any): Promise<boolean> {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user || user.isAdmin !== "true") {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

router.get("/admin/flights", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const entries = await db
    .select()
    .from(timetableTable)
    .where(ne(timetableTable.status, "completed"))
    .orderBy(timetableTable.createdAt);

  const result = [];
  for (const entry of entries) {
    const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, entry.flightId));
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, entry.userId));
    if (flight && user) {
      result.push({
        id: entry.id,
        userId: entry.userId,
        pilotUsername: user.username,
        pilotAircraft: user.aircraft.split(",").map((type) => type.trim()).filter(Boolean).join(" · "),
        flightId: entry.flightId,
        status: entry.status,
        startedAt: entry.startedAt ? entry.startedAt.toISOString() : null,
        finishedAt: entry.finishedAt ? entry.finishedAt.toISOString() : null,
        flightDurationSeconds: entry.flightDurationSeconds,
        flight: {
          id: flight.id,
          flightNumber: flight.flightNumber,
          departure: flight.departure,
          arrival: flight.arrival,
          aircraft: flight.aircraft,
          departureTime: flight.departureTime,
          flightDate: flight.flightDate,
          durationMinutes: flight.durationMinutes,
        },
      });
    }
  }

  res.json(GetAdminFlightsResponse.parse(result));
});

// Avatars for the admin list (kept separate from the zod-validated users list).
router.get("/admin/avatars", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const users = await db.select().from(usersTable).where(eq(usersTable.isVirtual, false));
  const map: Record<number, string> = {};
  for (const u of users) if (u.avatarUrl) map[u.id] = u.avatarUrl;
  res.json({ avatars: map });
});

// Per-pilot account state for the admin list: what's missing, ban/appeal
// status, admin flag — plus whether the viewer is the owner (shows admin
// toggles).
router.get("/admin/account-info", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const [viewer] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId!));
  const users = await db.select().from(usersTable).where(eq(usersTable.isVirtual, false));
  const info: Record<number, { missing: string[]; banned: boolean; appealStatus: string; appealText: string | null; isAdmin: boolean; isOwner: boolean }> = {};
  for (const u of users) {
    const missing: string[] = [];
    if (!u.cid) missing.push("CID");
    if (!u.discordId) missing.push("Discord");
    if (!u.simbriefUsername) missing.push("SimBrief");
    info[u.id] = {
      missing, banned: u.banned, appealStatus: u.appealStatus, appealText: u.appealText,
      isAdmin: u.isAdmin === "true", isOwner: u.isOwner,
    };
  }
  res.json({ info, viewerIsOwner: !!viewer?.isOwner });
});

// Re-run the application backfill on demand (also runs on boot).
router.post("/admin/backfill-info", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const filled = await backfillFromApplications();
  res.json({ ok: true, filled });
});

// ── Ban / appeal ─────────────────────────────────────────────────────────────
async function loadTarget(req: any, res: any): Promise<typeof usersTable.$inferSelect | null> {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user ID" }); return null; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!u) { res.status(404).json({ error: "User not found" }); return null; }
  return u;
}

router.post("/admin/users/:id/ban", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const u = await loadTarget(req, res); if (!u) return;
  if (u.id === req.session.userId) { res.status(400).json({ error: "You can't ban yourself." }); return; }
  if (u.isOwner) { res.status(400).json({ error: "The owner can't be banned." }); return; }
  const reason = String(req.body?.reason || "").trim().slice(0, 500) || "No reason provided.";
  await db.update(usersTable).set({ banned: true, banReason: reason, appealStatus: "none", appealText: null }).where(eq(usersTable.id, u.id));
  res.json({ ok: true });
});

router.post("/admin/users/:id/unban", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const u = await loadTarget(req, res); if (!u) return;
  await db.update(usersTable).set({ banned: false, banReason: null, appealStatus: "none", appealText: null }).where(eq(usersTable.id, u.id));
  res.json({ ok: true });
});

router.post("/admin/users/:id/deny-appeal", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const u = await loadTarget(req, res); if (!u) return;
  await db.update(usersTable).set({ appealStatus: "denied" }).where(eq(usersTable.id, u.id));
  res.json({ ok: true });
});

// ── Owner-only: add / remove admin on another account ───────────────────────
router.post("/admin/users/:id/admin", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const [viewer] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId!));
  if (!viewer?.isOwner) { res.status(403).json({ error: "Only the owner can change admin access." }); return; }
  const u = await loadTarget(req, res); if (!u) return;
  if (u.id === viewer.id) { res.status(400).json({ error: "You can't change your own admin status." }); return; }
  if (u.isOwner) { res.status(400).json({ error: "Can't change the owner's admin status." }); return; }
  const makeAdmin = !!req.body?.isAdmin;
  await db.update(usersTable).set({ isAdmin: makeAdmin ? "true" : "false" }).where(eq(usersTable.id, u.id));
  res.json({ ok: true });
});

router.get("/admin/users", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const users = await db.select().from(usersTable).where(eq(usersTable.isVirtual, false)).orderBy(usersTable.username);
  res.json(GetAdminUsersResponse.parse(users.map((u) => ({
    id: u.id,
    username: u.username,
    aircraft: u.aircraft.split(",").map((type) => type.trim()).filter(Boolean),
    simulatorVersion: u.simulatorVersion,
    simbriefUsername: u.simbriefUsername,
    cid: u.cid ?? null,
    isAdmin: u.isAdmin === "true",
  }))));
});

router.post("/admin/users", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const parsed = CreateAdminUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { username, password, aircraft, simulatorVersion, isAdmin } = parsed.data;

  const cidResult = normalizeCid(parsed.data.cid);
  if ("error" in cidResult) {
    res.status(400).json({ error: cidResult.error });
    return;
  }

  // If no password supplied, use the default and require change on first login
  const chosenPassword = (password && password.trim().length > 0) ? password.trim() : DEFAULT_PASSWORD;
  const mustChange = (!password || password.trim().length === 0) ? "true" : "false";

  const existing = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (existing.length > 0) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  const passwordHash = await bcrypt.hash(chosenPassword, 10);
  const [user] = await db.insert(usersTable).values({
    username: username.trim(),
    passwordHash,
    aircraft: aircraft.join(","),
    simulatorVersion,
    cid: cidResult.value,
    isAdmin: isAdmin ? "true" : "false",
    mustChangePassword: mustChange,
    hasSeenTutorial: "false",
  }).returning();

  const [createdUser] = GetAdminUsersResponse.parse([{
    id: user.id,
    username: user.username,
    aircraft: user.aircraft.split(",").map((type) => type.trim()).filter(Boolean),
    simulatorVersion: user.simulatorVersion,
    simbriefUsername: user.simbriefUsername,
    cid: user.cid ?? null,
    isAdmin: user.isAdmin === "true",
  }]);
  res.status(201).json(createdUser);
});

router.patch("/admin/users/:id", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const parsed = UpdateAdminUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const patch: Partial<typeof usersTable.$inferInsert> = {
    aircraft: parsed.data.aircraft.join(","),
    simulatorVersion: parsed.data.simulatorVersion,
  };
  // Only touch cid when the key is present (undefined = leave unchanged).
  if (parsed.data.cid !== undefined) {
    const cidResult = normalizeCid(parsed.data.cid);
    if ("error" in cidResult) {
      res.status(400).json({ error: cidResult.error });
      return;
    }
    patch.cid = cidResult.value;
  }

  const [updated] = await db
    .update(usersTable)
    .set(patch)
    .where(eq(usersTable.id, id))
    .returning();

  res.json(UpdateAdminUserResponse.parse({
    id: updated.id,
    username: updated.username,
    aircraft: updated.aircraft.split(",").map((type) => type.trim()).filter(Boolean),
    simulatorVersion: updated.simulatorVersion,
    simbriefUsername: updated.simbriefUsername,
    cid: updated.cid ?? null,
    isAdmin: updated.isAdmin === "true",
  }));
});

router.get("/admin/users/:id/timetable", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const entries = await db
    .select()
    .from(timetableTable)
    .where(eq(timetableTable.userId, id))
    .orderBy(timetableTable.createdAt);

  const result = [];
  for (const entry of entries) {
    const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, entry.flightId));
    if (flight) {
      result.push({
        id: entry.id,
        flightId: entry.flightId,
        status: entry.status,
        startedAt: entry.startedAt ? entry.startedAt.toISOString() : null,
        finishedAt: entry.finishedAt ? entry.finishedAt.toISOString() : null,
        flightDurationSeconds: entry.flightDurationSeconds,
        flight: {
          flightNumber: flight.flightNumber,
          departure: flight.departure,
          arrival: flight.arrival,
          departureTime: flight.departureTime,
          flightDate: flight.flightDate,
          durationMinutes: flight.durationMinutes,
          aircraft: flight.aircraft,
        },
      });
    }
  }

  res.json(result);
});

router.delete("/admin/users/:id", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  // Prevent admin from deleting themselves
  if (id === req.session.userId) {
    res.status(400).json({ error: "Cannot delete your own account" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (user.isOwner) {
    res.status(400).json({ error: "The owner account can't be deleted." });
    return;
  }

  // Delete the user and everything that references them (FK-safe).
  await deleteUserCascade(id);

  res.sendStatus(204);
});

export default router;

// ─── Flagged flights review ──────────────────────────────────────────────────

router.get("/admin/flagged", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const entries = await db
    .select()
    .from(timetableTable)
    .where(eq(timetableTable.status, "flagged"))
    .orderBy(timetableTable.finishedAt);

  const result = [];
  for (const entry of entries) {
    const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, entry.flightId));
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, entry.userId));
    if (flight && user) {
      result.push({
        id: entry.id,
        userId: entry.userId,
        pilotUsername: user.username,
        flightId: entry.flightId,
        status: entry.status,
        startedAt: entry.startedAt ? entry.startedAt.toISOString() : null,
        finishedAt: entry.finishedAt ? entry.finishedAt.toISOString() : null,
        flightDurationSeconds: entry.flightDurationSeconds,
        flagReason: entry.flagReason,
        flight: {
          id: flight.id,
          flightNumber: flight.flightNumber,
          departure: flight.departure,
          arrival: flight.arrival,
          aircraft: flight.aircraft,
          departureTime: flight.departureTime,
          flightDate: flight.flightDate,
          durationMinutes: flight.durationMinutes,
        },
      });
    }
  }

  res.json(result);
});

router.post("/admin/flagged/:id/approve", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid entry ID" }); return; }

  const [entry] = await db.select().from(timetableTable).where(eq(timetableTable.id, id));
  if (!entry || entry.status !== "flagged") {
    res.status(404).json({ error: "Flagged entry not found" });
    return;
  }

  // Move to completed and credit sim hours
  await db.update(timetableTable)
    .set({ status: "completed", approvedByAdmin: true })
    .where(eq(timetableTable.id, id));

  if (entry.flightDurationSeconds) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, entry.userId));
    if (user) {
      const addHours = entry.flightDurationSeconds / 3600;
      await db.update(usersTable)
        .set({ simHours: (user.simHours ?? 0) + addHours })
        .where(eq(usersTable.id, entry.userId));
    }
  }

  res.json({ ok: true });
});

router.post("/admin/flagged/:id/reject", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid entry ID" }); return; }

  const [entry] = await db.select().from(timetableTable).where(eq(timetableTable.id, id));
  if (!entry || entry.status !== "flagged") {
    res.status(404).json({ error: "Flagged entry not found" });
    return;
  }

  // Record an infraction against the pilot before removing the rejected flight.
  const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, entry.flightId));
  const label = flight ? `${flight.flightNumber} (${flight.departure}→${flight.arrival})` : `flight #${entry.flightId}`;
  await notify(entry.userId, "ops", "Flight rejected", `Your flagged flight ${label} was reviewed and rejected by an admin.`);
  await addInfraction(entry.userId, "flight_rejected", `Flagged flight ${label} rejected by admin`);

  // Delete the entry entirely — no hours credited, gone from logs
  await db.delete(timetableTable).where(eq(timetableTable.id, id));
  res.json({ ok: true });
});

// Every live shared cockpit, with its crew and full crew-chat transcript.
router.get("/admin/cockpits", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  res.json({ sessions: listSessionsForAdmin() });
});

// Pilot reports — newest first, with reporter/reported usernames + avatars.
router.get("/admin/reports", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const rows = await db.select().from(userReportsTable).orderBy(desc(userReportsTable.createdAt));
  const users = await db.select().from(usersTable);
  const byId = new Map(users.map((u) => [u.id, u]));

  res.json({
    reports: rows.map((r) => {
      const reporter = byId.get(r.reporterId);
      const reported = byId.get(r.reportedId);
      return {
        id: r.id,
        reason: r.reason,
        detail: r.detail,
        context: r.context,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
        chat: (() => { try { return JSON.parse(r.chat) as Array<{ userId: number; username: string; text: string; at: number }>; } catch { return []; } })(),
        hasAudio: !!r.audioClip,
        reporter: { id: r.reporterId, username: reporter?.username ?? "(deleted)", avatarUrl: reporter?.avatarUrl ?? null },
        reported: { id: r.reportedId, username: reported?.username ?? "(deleted)", avatarUrl: reported?.avatarUrl ?? null },
      };
    }),
  });
});

// The recorded crew-call audio for a report, as an audio/webm stream (served
// separately so the reports list stays light).
router.get("/admin/reports/:id/audio", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid report ID" }); return; }
  const [report] = await db.select().from(userReportsTable).where(eq(userReportsTable.id, id));
  if (!report || !report.audioClip) { res.status(404).json({ error: "No audio for this report" }); return; }
  const m = /^data:(audio\/[\w.+-]+);base64,(.*)$/s.exec(report.audioClip);
  if (!m) { res.status(404).json({ error: "No audio for this report" }); return; }
  res.setHeader("Content-Type", m[1]);
  res.send(Buffer.from(m[2], "base64"));
});

// Resolve a report. action "strike" records an infraction against the pilot;
// "dismiss" just closes it. Both mark it handled.
router.post("/admin/reports/:id/resolve", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid report ID" }); return; }
  const action = String(req.body?.action || "dismiss");

  const [report] = await db.select().from(userReportsTable).where(eq(userReportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Report not found" }); return; }

  if (action === "strike") {
    await addInfraction(report.reportedId, "reported", `Pilot report upheld: ${report.reason}`);
  }
  await db.update(userReportsTable)
    .set({ status: action === "strike" ? "resolved" : "dismissed", resolvedAt: new Date() })
    .where(eq(userReportsTable.id, id));

  res.json({ ok: true });
});
