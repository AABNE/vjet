// Backfill pilot accounts from their original application: match by the hub
// username they chose, and fill in anything the account is missing (VATSIM CID,
// linked Discord, tracking choice) without ever overwriting data already set.
import { db, eq, usersTable, applicationsTable } from "@workspace/db";
import { logger } from "./logger";

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
