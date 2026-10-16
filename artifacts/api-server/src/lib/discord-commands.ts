// Registers the bot's slash commands with Discord on boot.
//
// Commands are invoked through the same HTTP interactions endpoint that handles
// the recruitment buttons (/api/discord-interactions) — there is no separate
// gateway bot process. Discord still needs the command *definitions* registered
// via the API, which is what this does (an idempotent PUT that replaces the set).
//
// If DISCORD_GUILD_ID is set, commands are registered to that guild (instant).
// Otherwise they're registered globally (can take up to ~1 hour to appear).

import { logger } from "./logger";

const DISCORD_API = "https://discord.com/api/v10";

// Manage Messages (0x2000). Only members with this permission can use /say by
// default — this stops any member from making the bot say anything. You can
// widen or narrow it per-command in Discord:
//   Server Settings → Integrations → (the app) → Command permissions.
const MANAGE_MESSAGES = "8192";

const COMMANDS = [
  {
    name: "say",
    type: 1, // CHAT_INPUT (slash command)
    description: "Make the bot post a message in this channel",
    default_member_permissions: MANAGE_MESSAGES,
    options: [
      {
        name: "message",
        description: "What the bot should say",
        type: 3, // STRING
        required: true,
        max_length: 2000,
      },
    ],
  },
];

export async function registerDiscordCommands(): Promise<void> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    logger.info("discord-commands: DISCORD_BOT_TOKEN not set — skipping command registration");
    return;
  }

  const authHeaders = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };

  try {
    // The application ID is derived from the bot token.
    const meRes = await fetch(`${DISCORD_API}/applications/@me`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!meRes.ok) {
      logger.warn({ status: meRes.status }, "discord-commands: could not fetch application id — commands not registered");
      return;
    }
    const me = (await meRes.json()) as { id: string };
    const appId = me.id;

    const guildId = process.env["DISCORD_GUILD_ID"];
    const url = guildId
      ? `${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`
      : `${DISCORD_API}/applications/${appId}/commands`;

    const res = await fetch(url, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify(COMMANDS),
    });

    if (res.ok) {
      logger.info(
        { scope: guildId ? `guild ${guildId}` : "global", commands: COMMANDS.map((c) => c.name) },
        "discord-commands registered",
      );
    } else {
      const body = await res.text().catch(() => "");
      logger.warn(
        { status: res.status, body: body.slice(0, 300) },
        "discord-commands registration failed",
      );
    }
  } catch (err) {
    logger.error({ err }, "discord-commands registration error");
  }
}
