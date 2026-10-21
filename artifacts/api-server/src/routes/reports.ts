import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, userReportsTable, eq } from "@workspace/db";
import { notify } from "../lib/ops";

const router: IRouter = Router();

// POST /api/reports { reportedUserId, reason, detail?, context? } — report another pilot.
router.post("/reports", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const reportedId = Number(req.body?.reportedUserId);
  const reason = String(req.body?.reason || "").trim();
  const detail = String(req.body?.detail || "").trim().slice(0, 2000);
  const context = String(req.body?.context || "").trim().slice(0, 200);

  if (!reportedId || Number.isNaN(reportedId)) { res.status(400).json({ error: "Pick a pilot to report." }); return; }
  if (reportedId === userId) { res.status(400).json({ error: "You can't report yourself." }); return; }
  if (!reason) { res.status(400).json({ error: "Give a reason for the report." }); return; }

  const [reported] = await db.select().from(usersTable).where(eq(usersTable.id, reportedId));
  if (!reported) { res.status(404).json({ error: "That pilot doesn't exist." }); return; }
  const [reporter] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

  await db.insert(userReportsTable).values({ reporterId: userId, reportedId, reason, detail, context });

  // Ping every admin so it lands in their inbox too.
  const admins = await db.select().from(usersTable).where(eq(usersTable.isAdmin, "true"));
  for (const a of admins) {
    await notify(a.id, "strike", `Pilot report: ${reported.username}`,
      `${reporter?.username ?? "A pilot"} reported ${reported.username} — ${reason}${context ? ` (${context})` : ""}`);
  }

  res.json({ ok: true });
});

export default router;
