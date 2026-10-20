// Send a direct message to a pilot's Discord account (the one they signed up
// with). Best-effort: silently no-ops if the bot token isn't configured, the
// user has no linked Discord, or the pilot has DMs from the server closed.
import { logger } from "./logger";

const DISCORD_API = "https://discord.com/api/v10";

export async function sendDiscordDM(discordId: string | null | undefined, title: string, body = ""): Promise<boolean> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token || !discordId || !/^[0-9]{17,20}$/.test(discordId)) return false;
  const headers = {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "vJetstar-ops (https://vjetstar, 1.0)",
  };
  try {
    const chRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
      method: "POST", headers, body: JSON.stringify({ recipient_id: String(discordId) }),
    });
    if (!chRes.ok) return false;
    const ch = (await chRes.json()) as { id: string };
    const content = body ? `**${title}**\n${body}` : `**${title}**`;
    const msgRes = await fetch(`${DISCORD_API}/channels/${ch.id}/messages`, {
      method: "POST", headers,
      body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
    });
    return msgRes.ok;
  } catch (err) {
    logger.warn({ err }, "discord DM failed");
    return false;
  }
}
