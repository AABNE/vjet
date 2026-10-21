// Temporary, locked voice channels for shared cockpits. The bot spins up a
// private VC per flight, grants only the crew access, and deletes it when the
// flight ends. This offloads all the NAT/relay pain to Discord. Best-effort:
// every call silently no-ops if the bot isn't configured.
import { logger } from "./logger";

const DISCORD_API = "https://discord.com/api/v10";

// Permission bit-flags (as strings, since they're 64-bit fields).
const VIEW_CHANNEL = 1n << 10n;
const CONNECT = 1n << 20n;
const SPEAK = 1n << 21n;
const ALLOW_MEMBER = (VIEW_CHANNEL | CONNECT | SPEAK).toString();
const DENY_EVERYONE = (VIEW_CHANNEL | CONNECT).toString();

const DISCORD_ID = /^[0-9]{17,20}$/;

function cfg() {
  const token = process.env["DISCORD_BOT_TOKEN"];
  const guildId = process.env["DISCORD_GUILD_ID"];
  if (!token || !guildId) return null;
  return {
    token, guildId,
    categoryId: process.env["DISCORD_COCKPIT_CATEGORY_ID"] || undefined,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "vJetstar-ops (https://vjetstar, 1.0)",
    },
  };
}

export function voiceConfigured(): boolean { return !!cfg(); }

// Create a locked voice channel visible only to the given crew Discord IDs.
export async function createCockpitVc(name: string, memberDiscordIds: (string | null | undefined)[]): Promise<{ channelId: string; url: string } | null> {
  const c = cfg();
  if (!c) return null;
  const overwrites: Array<{ id: string; type: number; allow?: string; deny?: string }> = [
    // @everyone role id == guild id. Hide + block the channel from everyone...
    { id: c.guildId, type: 0, deny: DENY_EVERYONE },
  ];
  // ...then open it for each crew member that has a linked Discord.
  for (const id of memberDiscordIds) {
    if (id && DISCORD_ID.test(id)) overwrites.push({ id, type: 1, allow: ALLOW_MEMBER });
  }
  try {
    const res = await fetch(`${DISCORD_API}/guilds/${c.guildId}/channels`, {
      method: "POST", headers: c.headers,
      body: JSON.stringify({
        name: name.slice(0, 95),
        type: 2, // GUILD_VOICE
        ...(c.categoryId ? { parent_id: c.categoryId } : {}),
        user_limit: 4,
        permission_overwrites: overwrites,
      }),
    });
    if (!res.ok) { logger.warn({ status: res.status }, "cockpit VC create failed"); return null; }
    const ch = (await res.json()) as { id: string };
    return { channelId: ch.id, url: `https://discord.com/channels/${c.guildId}/${ch.id}` };
  } catch (err) { logger.warn({ err }, "cockpit VC create error"); return null; }
}

// Grant a late-joining crew member access to an existing cockpit VC.
export async function addMemberToCockpitVc(channelId: string, discordId: string | null | undefined): Promise<boolean> {
  const c = cfg();
  if (!c || !discordId || !DISCORD_ID.test(discordId)) return false;
  try {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/permissions/${discordId}`, {
      method: "PUT", headers: c.headers,
      body: JSON.stringify({ type: 1, allow: ALLOW_MEMBER, deny: "0" }),
    });
    return res.ok;
  } catch (err) { logger.warn({ err }, "cockpit VC add-member error"); return false; }
}

export async function deleteCockpitVc(channelId: string): Promise<void> {
  const c = cfg();
  if (!c) return;
  try { await fetch(`${DISCORD_API}/channels/${channelId}`, { method: "DELETE", headers: c.headers }); }
  catch (err) { logger.warn({ err }, "cockpit VC delete error"); }
}

// On boot, sweep any leftover cockpit channels (in-memory sessions are gone
// after a restart, so their VCs are orphaned). Only touches our category.
export async function cleanupOrphanCockpitVcs(): Promise<void> {
  const c = cfg();
  if (!c || !c.categoryId) return;
  try {
    const res = await fetch(`${DISCORD_API}/guilds/${c.guildId}/channels`, { headers: c.headers });
    if (!res.ok) return;
    const channels = (await res.json()) as Array<{ id: string; type: number; parent_id: string | null }>;
    const stale = channels.filter((ch) => ch.type === 2 && ch.parent_id === c.categoryId);
    for (const ch of stale) await deleteCockpitVc(ch.id);
    if (stale.length) logger.info({ count: stale.length }, "swept orphan cockpit VCs");
  } catch (err) { logger.warn({ err }, "cockpit VC cleanup error"); }
}
