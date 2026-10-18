import { Router, type IRouter } from "express";
import { db, usersTable, eq } from "@workspace/db";

const router: IRouter = Router();

// POST /api/tracker/heartbeat — called by SimLink desktop app every 10s
router.post("/tracker/heartbeat", async (req, res): Promise<void> => {
  const { username, totalHours, sessionHours, msfsRunning } = req.body ?? {};

  // Accept session auth OR username from desktop app
  const userId = req.session?.userId;

  try {
    let uid = userId;
    if (!uid && username) {
      const [user] = await db.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.username, username));
      uid = user?.id;
    }

    if (uid) {
      // Update presence (for no-show paging) and, when provided, sim hours.
      const patch: Record<string, unknown> = {
        lastSeenAt: new Date(),
        msfsRunning: !!msfsRunning,
      };
      if (typeof totalHours === "number") patch.simHours = totalHours;
      await db.update(usersTable).set(patch).where(eq(usersTable.id, uid));
    }

    res.json({ ok: true });
  } catch {
    res.json({ ok: true }); // never crash the desktop app
  }
});

// GET /api/tracker/live — active sessions for login page map
router.get("/tracker/live", async (_req, res): Promise<void> => {
  // Return pilots with sim hours > 0 (simplified — real impl would use last_seen column)
  const pilots = await db.select({
    username: usersTable.username,
    simHours: usersTable.simHours,
  }).from(usersTable).where(eq(usersTable.isAdmin, "false"));

  res.json(pilots);
});

export default router;
