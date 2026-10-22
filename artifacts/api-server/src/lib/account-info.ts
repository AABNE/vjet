// Backfill pilot accounts from their original application: match by the hub
// username they chose, and fill in anything the account is missing (VATSIM CID,
// linked Discord, tracking choice) without ever overwriting data already set.
import {
  db, eq, or, usersTable, applicationsTable,
  notificationsTable, pilotDisciplineTable, pilotInfractionsTable, userReportsTable, timetableTable,
} from "@workspace/db";
import { logger } from "./logger";

// Delete a user and every row that references them, in FK-safe order. Without
// this, deleting an account that has notifications / discipline / reports /
// flights fails with a foreign-key 500.
export async function deleteUserCascade(id: number): Promise<void> {
  await db.delete(notificationsTable).where(eq(notificationsTable.userId, id));
  await db.delete(pilotInfractionsTable).where(eq(pilotInfractionsTable.userId, id));
  await db.delete(pilotDisciplineTable).where(eq(pilotDisciplineTable.userId, id));
  await db.delete(userReportsTable).where(or(eq(userReportsTable.reporterId, id), eq(userReportsTable.reportedId, id)));
  await db.delete(timetableTable).where(eq(timetableTable.userId, id));
  await db.delete(usersTable).where(eq(usersTable.id, id));
}

export async function backfillFromApplications(): Promise<number> {
  const apps = await db.select().from(applicationsTable);
  if (!apps.length) return 0;
  let filled = 0;
  for (const app of apps) {
    if (!app.username) continue;
    const [u] = await db.select().from(usersTable).where(eq(usersTable.username, app.username));
    if (!u || u.isVirtual) continue;
    const set: Partial<typeof usersTable.$inferInsert> = {};
    if (!u.cid && app.cid) set.cid = app.cid;
    if (!u.discordId && app.discordId) set.discordId = app.discordId;
    if ((!u.trackingMethod || u.trackingMethod === "simlink") && app.trackingMethod && app.trackingMethod !== "simlink") set.trackingMethod = app.trackingMethod;
    if (!u.volantaUsername && app.volantaUsername) set.volantaUsername = app.volantaUsername;
    if (Object.keys(set).length) {
      await db.update(usersTable).set(set).where(eq(usersTable.id, u.id));
      filled++;
    }
  }
  if (filled) logger.info({ filled }, "backfilled pilot account info from applications");
  return filled;
}
