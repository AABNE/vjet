// Shared ops helpers: notifications + the pilot discipline (strike/ban) model.
//
// Discipline rules (from the VA owner):
//   • 3 infractions  = 1 strike
//   • 3 strikes      = a ban, doubling each time: 1h, 2h, 4h, 8h, 16h…
//   • everything resets at the start of each month
import {
  db, eq,
  notificationsTable,
  pilotDisciplineTable,
  pilotInfractionsTable,
  type PilotDiscipline,
} from "@workspace/db";

export function periodKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
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
}

// Fetch the pilot's discipline row for the CURRENT month, creating it or
// resetting a stale one as needed.
export async function getDiscipline(userId: number): Promise<PilotDiscipline> {
  const period = periodKey();
  const [existing] = await db.select().from(pilotDisciplineTable).where(eq(pilotDisciplineTable.userId, userId));
  if (!existing) {
    const [created] = await db.insert(pilotDisciplineTable)
      .values({ userId, periodKey: period })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [row] = await db.select().from(pilotDisciplineTable).where(eq(pilotDisciplineTable.userId, userId));
    return row;
  }
  if (existing.periodKey !== period) {
    const [reset] = await db.update(pilotDisciplineTable)
      .set({ periodKey: period, infractions: 0, strikes: 0, banLevel: 0, bannedUntil: null })
      .where(eq(pilotDisciplineTable.userId, userId))
      .returning();
    return reset;
  }
  return existing;
}

export interface BanInfo { banned: boolean; until: Date | null; }

export async function getBan(userId: number): Promise<BanInfo> {
  const d = await getDiscipline(userId);
  const banned = !!d.bannedUntil && d.bannedUntil.getTime() > Date.now();
  return { banned, until: banned ? d.bannedUntil : null };
}

export interface InfractionResult {
  infractions: number;
  strikes: number;
  gainedStrike: boolean;
  banned: boolean;
  banHours: number;
  bannedUntil: Date | null;
}

export async function addInfraction(userId: number, type: string, reason: string): Promise<InfractionResult> {
  const d = await getDiscipline(userId); // already period-correct
  await db.insert(pilotInfractionsTable).values({ userId, type, reason });

  let infractions = d.infractions + 1;
  let strikes = d.strikes;
  let banLevel = d.banLevel;
  let bannedUntil: Date | null = d.bannedUntil;
  let gainedStrike = false;
  let banned = false;
  let banHours = 0;

  if (infractions >= 3) {
    infractions -= 3; // keep any remainder toward the next strike
    strikes += 1;
    gainedStrike = true;
  }
  if (strikes >= 3) {
    banLevel += 1;
    banHours = Math.pow(2, banLevel - 1); // 1, 2, 4, 8, 16…
    bannedUntil = new Date(Date.now() + banHours * 3_600_000);
    banned = true;
    strikes = 0; // reset strikes after a ban, then repeat
  }

  await db.update(pilotDisciplineTable)
    .set({ periodKey: periodKey(), infractions, strikes, banLevel, bannedUntil })
    .where(eq(pilotDisciplineTable.userId, userId));

  if (banned) {
    await notify(userId, "strike", "Grounded — 3 strikes",
      `${reason}. That's your third strike this month, so you're grounded for ${banHours}h (until ${bannedUntil!.toUTCString()}). Counts reset at the start of next month.`);
  } else if (gainedStrike) {
    await notify(userId, "strike", `Strike ${strikes}/3`,
      `${reason}. That's a strike — ${3 - strikes} more this month means a ban.`);
  } else {
    await notify(userId, "strike", "Infraction logged",
      `${reason}. ${infractions}/3 toward a strike this month.`);
  }

  return { infractions, strikes, gainedStrike, banned, banHours, bannedUntil };
}

export async function recentInfractions(userId: number, limit = 20) {
  return db.select().from(pilotInfractionsTable)
    .where(eq(pilotInfractionsTable.userId, userId))
    .orderBy(pilotInfractionsTable.createdAt)
    .limit(limit);
}
