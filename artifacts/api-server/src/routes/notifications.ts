import { Router, type IRouter } from "express";
import { db, notificationsTable, eq, and, isNull, desc } from "@workspace/db";

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

export default router;
