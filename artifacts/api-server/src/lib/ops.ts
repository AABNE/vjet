// Shared ops helpers: notifications + the manual ban check. (The old
// infraction→strike→auto-ban discipline model has been removed; bans are now
// only ever set manually by an admin — see users.banned and the admin routes.)
import {
  db, eq,
  notificationsTable,
  usersTable,
  opsSettingsTable,
} from "@workspace/db";
import { sendDiscordDM } from "./discord-dm";

// Admin policy: is the pilot hub required to fly / host a shared cockpit?
// (ops_settings "require_hub", default on). Admins can switch it off.
export async function hubRequired(): Promise<boolean> {
  try {
    const [r] = await db.select().from(opsSettingsTable).where(eq(opsSettingsTable.key, "require_hub"));
    return (r?.value ?? "1") !== "0";
  } catch { return true; }
}

// The pilot hub (vJetstar Sim Link desktop app) is considered connected when it
// sent a heartbeat recently. Flying actions (start / clearance) require it.
const HUB_PRESENCE_MS = 5 * 60_000;
export async function hubConnected(userId: number): Promise<boolean> {
  try {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    return !!(u?.lastSeenAt && Date.now() - new Date(u.lastSeenAt).getTime() < HUB_PRESENCE_MS);
  } catch { return false; }
}

// Manual ban: set by an admin on the account (users.banned).
export async function isUserBanned(userId: number): Promise<boolean> {
  try {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    return !!u?.banned;
  } catch { return false; }
}

export async function notify(
  userId: number,
  kind: "dispatch" | "ops" | "strike" | "info",
  title: string,
  body = "",
): Promise<void> {
  try {
    await db.insert(notificationsTable).values({ userId, kind, title, body });
  } catch {
    /* notifications are best-effort */
  }
  // Also DM the pilot's Discord inbox (the account they signed up with).
  try {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (u?.discordId) void sendDiscordDM(u.discordId, title, body);
  } catch {
    /* best-effort */
  }
}
