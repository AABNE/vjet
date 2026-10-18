import { Router, type IRouter } from "express";
import { db, notificationsTable, eq, and, isNull, desc } from "@workspace/db";
import { getDiscipline, recentInfractions, getBan } from "../lib/ops";

const router: IRouter = Router();

// GET /api/notifications — recent notifications + unread count.
router.get("/notifications", async (req, res): Promise<void> => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const userId = req.session.userId;

  const rows = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.userId, userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);

  const unread = rows.filter((n) => !n.readAt).length;
  res.json({
    unread,
    notifications: rows.map((n) => ({
      id: n.id, kind: n.kind, title: n.title, body: n.body,
      read: !!n.readAt, createdAt: n.createdAt.toISOString(),
    })),
  });
});

// POST /api/notifications/read-all — mark everything read.
router.post("/notifications/read-all", async (req, res): Promise<void> => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  await db.update(notificationsTable)
    .set({ readAt: new Date() })
    .where(and(eq(notificationsTable.userId, req.session.userId), isNull(notificationsTable.readAt)));
  res.json({ ok: true });
});

// GET /api/pilot/record — the pilot's discipline standing + recent infractions.
router.get("/pilot/record", async (req, res): Promise<void> => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const userId = req.session.userId;
  const d = await getDiscipline(userId);
  const ban = await getBan(userId);
  const log = await recentInfractions(userId, 20);
  res.json({
    periodKey: d.periodKey,
    infractions: d.infractions,
    strikes: d.strikes,
    banLevel: d.banLevel,
    ban: { banned: ban.banned, until: ban.until ? ban.until.toISOString() : null },
    history: log.map((i) => ({ type: i.type, reason: i.reason, createdAt: i.createdAt.toISOString() })),
  });
});

export default router;
