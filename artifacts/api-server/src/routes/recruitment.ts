// vJetstar pilot-recruitment routes.
//
// These were originally Cloudflare Pages Functions in the standalone application
// site. They are ported here to run on the normal Express server (Render), which
// removes the Cloudflare↔Discord `fetch()` hang that forced the old fire-and-forget
// hacks — on a long-running Node process we can await Discord calls normally.
//
//   GET  /api/discord-user          — look up a Discord account for the preview
//   POST /api/apply                 — deliver an application to the recruiter's DMs
//   POST /api/discord-interactions  — handle Accept / Decline / onboarded buttons
//
// Required env vars (routes degrade to a 503 "not configured" when missing, so the
// rest of the app still boots without them):
//   DISCORD_BOT_TOKEN   — bot token used for all Discord API calls
//   DISCORD_USER_ID     — numeric user ID of the recruitment admin (DM recipient)
//   DISCORD_PUBLIC_KEY  — application public key, for interaction signature checks
//   DISCORD_GUILD_ID    — (optional) server used for username search + role swaps
//   ROLE_NO_APPLICATION_ID / ROLE_ACCEPTED_ID / ROLE_PILOT_ID — (optional) role IDs

import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db, usersTable, applicationsTable, eq } from "@workspace/db";
import { logger } from "../lib/logger";

// Default temporary password for an auto-created pilot account. The account is
// flagged mustChangePassword, so the pilot is forced to change it on first login.
const DEFAULT_PILOT_PASSWORD = "Vjet1234";

const router: IRouter = Router();

const DISCORD_API = "https://discord.com/api/v10";
const USER_AGENT = "vJetstar (Render, +https://github.com/AABNE/vjet)";

// Canonical vJetstar fleet codes — must match the pilot hub (A320, A20N, A21N, B788).
const ALLOWED_AIRCRAFT = ["A320", "A20N", "A21N", "B788"];

function botHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };
}

// Add ("PUT") or remove ("DELETE") a guild role from a member, logging the
// result. Discord returns 204 on success, 403 if the bot's own role sits below
// the target role (hierarchy), 404 if the member or role no longer exists.
async function changeMemberRole(
  token: string,
  guildId: string,
  memberId: string,
  roleId: string,
  method: "PUT" | "DELETE",
  label: string,
): Promise<void> {
  try {
    const r = await fetch(
      `${DISCORD_API}/guilds/${guildId}/members/${memberId}/roles/${roleId}`,
      { method, headers: botHeaders(token) },
    );
    if (r.ok) {
      logger.info({ status: r.status, roleId, label }, "role change ok");
    } else {
      const body = await r.text().catch(() => "");
      logger.warn(
        { status: r.status, roleId, label, body: body.slice(0, 200) },
        "role change failed — check the bot can manage this role (its role must be ABOVE the target role)",
      );
    }
  } catch (err) {
    logger.error({ err, roleId, label }, "role change error");
  }
}

function escapeDiscord(value: unknown): string {
  return String(value).replace(/[`@*_~|><[\]]/g, "\\$&").slice(0, 500);
}

function avatarUrl(user: { id: string; avatar?: string | null }): string {
  if (user.avatar) {
    const ext = user.avatar.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
  }
  const index = Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

// ── GET /api/discord-user ────────────────────────────────────────────────────
router.get("/discord-user", async (req: Request, res: Response): Promise<void> => {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    res.status(503).json({ error: "Discord lookup is not configured." });
    return;
  }

  const idParam = String(req.query["id"] || "").trim();
  const usernameParam = String(req.query["username"] || "").trim().toLowerCase();
  const value = idParam || usernameParam;

  const isId = /^[0-9]{17,20}$/.test(value);
  const isUsername = /^[a-z0-9._]{2,32}$/.test(value);

  if (!isId && !isUsername) {
    res.status(400).json({ error: "Enter a valid Discord username or user ID." });
    return;
  }

  try {
    let user: { id: string; username: string; global_name?: string | null; avatar?: string | null } | undefined;

    if (isId) {
      const response = await fetch(`${DISCORD_API}/users/${value}`, {
        headers: { Authorization: `Bot ${token}`, "User-Agent": USER_AGENT },
      });
      if (response.status === 404) {
        res.status(404).json({ error: "No Discord account found for that ID." });
        return;
      }
      if (!response.ok) {
        res.status(502).json({ error: "Discord could not verify that account. Try again shortly." });
        return;
      }
      user = (await response.json()) as typeof user;
    } else {
      const guildId = process.env["DISCORD_GUILD_ID"];
      if (!guildId) {
        res.status(400).json({
          error: "Username lookup requires a server to search. Please enter your numeric Discord user ID instead, or ask an admin to configure DISCORD_GUILD_ID.",
        });
        return;
      }

      const searchResp = await fetch(
        `${DISCORD_API}/guilds/${guildId}/members/search?query=${encodeURIComponent(value)}&limit=5`,
        { headers: { Authorization: `Bot ${token}`, "User-Agent": USER_AGENT } },
      );
      if (!searchResp.ok) {
        res.status(502).json({ error: "Username search failed. Try again or use your user ID." });
        return;
      }

      const members = (await searchResp.json()) as Array<{
        user: { id: string; username: string; global_name?: string | null; avatar?: string | null };
      }>;
      const match = members.find(
        (m) =>
          m.user.username.toLowerCase() === value ||
          (m.user.global_name || "").toLowerCase() === value,
      );
      if (!match) {
        res.status(404).json({
          error: "No Discord account found with that username in the server. Make sure you've joined the vJetstar Discord server, or enter your numeric user ID.",
        });
        return;
      }
      user = match.user;
    }

    if (!user) {
      res.status(502).json({ error: "Discord account lookup failed. Please try again." });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.json({
      id: user.id,
      username: user.username,
      globalName: user.global_name || user.username,
      avatar: avatarUrl(user),
    });
  } catch {
    res.status(502).json({ error: "Discord account lookup failed. Please try again." });
  }
});

// ── GET /api/pilot/discord — the signed-in pilot's current linked account ─────
router.get("/pilot/discord", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  res.json({ discordId: u?.discordId ?? null });
});

// ── POST /api/pilot/discord — link the pilot's Discord. Enforces server
// membership (via a guild-member lookup) so people can't DM random accounts. ──
router.post("/pilot/discord", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const token = process.env["DISCORD_BOT_TOKEN"];
  const guildId = process.env["DISCORD_GUILD_ID"];
  if (!token) { res.status(503).json({ error: "Discord linking isn't configured on the server." }); return; }
  if (!guildId) { res.status(503).json({ error: "Discord linking needs DISCORD_GUILD_ID set on the server." }); return; }

  const value = String(req.body?.value || "").trim();
  const isId = /^[0-9]{17,20}$/.test(value);
  const isUsername = /^[a-z0-9._]{2,32}$/i.test(value);
  if (!isId && !isUsername) { res.status(400).json({ error: "Enter a valid Discord username or user ID." }); return; }

  try {
    let du: { id: string; username: string; global_name?: string | null; avatar?: string | null } | undefined;
    if (isId) {
      // Guild-member endpoint → 404 if they're not in the server.
      const r = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${value}`, { headers: botHeaders(token) });
      if (r.status === 404) { res.status(404).json({ error: "That account isn't in the vJetstar Discord server. Join the server first, then link." }); return; }
      if (!r.ok) { res.status(502).json({ error: "Discord lookup failed. Try again shortly." }); return; }
      du = ((await r.json()) as any).user;
    } else {
      const r = await fetch(`${DISCORD_API}/guilds/${guildId}/members/search?query=${encodeURIComponent(value)}&limit=5`, { headers: botHeaders(token) });
      if (!r.ok) { res.status(502).json({ error: "Username search failed. Try again or use your numeric user ID." }); return; }
      const members = (await r.json()) as Array<{ user: { id: string; username: string; global_name?: string | null; avatar?: string | null } }>;
      const lv = value.toLowerCase();
      du = members.find((m) => m.user.username.toLowerCase() === lv || (m.user.global_name || "").toLowerCase() === lv)?.user;
      if (!du) { res.status(404).json({ error: "No member with that username in the vJetstar server. Make sure you've joined, or use your numeric user ID." }); return; }
    }
    if (!du) { res.status(502).json({ error: "Discord lookup failed. Please try again." }); return; }

    const [taken] = await db.select().from(usersTable).where(eq(usersTable.discordId, du.id));
    if (taken && taken.id !== userId) { res.status(409).json({ error: "That Discord account is already linked to another pilot." }); return; }

    const [me] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    const patch: { discordId: string; avatarUrl?: string } = { discordId: du.id };
    if (!me?.avatarUrl) patch.avatarUrl = avatarUrl(du); // default profile pic from Discord
    await db.update(usersTable).set(patch).where(eq(usersTable.id, userId));
    res.json({ ok: true, id: du.id, username: du.username, globalName: du.global_name || du.username, avatar: avatarUrl(du) });
  } catch {
    res.status(502).json({ error: "Discord linking failed. Please try again." });
  }
});

// ── DELETE /api/pilot/discord — unlink ────────────────────────────────────────
router.delete("/pilot/discord", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  await db.update(usersTable).set({ discordId: null }).where(eq(usersTable.id, userId));
  res.json({ ok: true });
});

// ── GET /api/pilot/profile — avatar + identity for the header/menu ────────────
router.get("/pilot/profile", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  res.json({ username: u?.username ?? null, avatarUrl: u?.avatarUrl ?? null, discordLinked: !!u?.discordId });
});

// ── POST /api/pilot/avatar — set a profile picture by URL ("" clears it) ──────
router.post("/pilot/avatar", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const raw = String(req.body?.url ?? "").trim();
  const isHttps = /^https:\/\/[^\s]+$/i.test(raw);
  const isDataImg = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(raw);
  if (raw) {
    if (!isHttps && !isDataImg) { res.status(400).json({ error: "Upload an image or enter a valid https image URL." }); return; }
    if (isDataImg && raw.length > 120_000) { res.status(400).json({ error: "That image is too large — it should be a small photo (under ~80KB). Try a smaller one." }); return; }
  }
  const url = raw ? (isDataImg ? raw : raw.slice(0, 500)) : null;
  await db.update(usersTable).set({ avatarUrl: url }).where(eq(usersTable.id, userId));
  res.json({ ok: true, avatarUrl: url });
});

// ── POST /api/pilot/avatar/discord — use the linked Discord picture ───────────
router.post("/pilot/avatar/discord", async (req: Request, res: Response): Promise<void> => {
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const token = process.env["DISCORD_BOT_TOKEN"];
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!u?.discordId) { res.status(400).json({ error: "Link your Discord first (in Settings)." }); return; }
  if (!token) { res.status(503).json({ error: "Discord isn't configured on the server." }); return; }
  try {
    const r = await fetch(`${DISCORD_API}/users/${u.discordId}`, { headers: botHeaders(token) });
    if (!r.ok) { res.status(502).json({ error: "Couldn't fetch your Discord picture." }); return; }
    const du = (await r.json()) as { id: string; avatar?: string | null };
    const url = avatarUrl(du);
    await db.update(usersTable).set({ avatarUrl: url }).where(eq(usersTable.id, userId));
    res.json({ ok: true, avatarUrl: url });
  } catch { res.status(502).json({ error: "Couldn't fetch your Discord picture." }); }
});

// ── POST /api/apply ──────────────────────────────────────────────────────────
router.post("/apply", async (req: Request, res: Response): Promise<void> => {
  const token = process.env["DISCORD_BOT_TOKEN"];
  const recruiterId = process.env["DISCORD_USER_ID"];
  const modChannelId = process.env["DISCORD_APPLICATIONS_CHANNEL_ID"];
  if (!token || (!recruiterId && !modChannelId)) {
    res.status(503).json({ error: "Application delivery is not configured." });
    return;
  }

  const body = req.body ?? {};

  // Hidden-field spam trap.
  if (body.website) {
    res.json({ ok: true });
    return;
  }

  const username = String(body.username || "").trim();
  const discordId = String(body.discordId || "").trim();
  const email = String(body.email || "").trim();
  const cid = body.noVatsim ? "Does not have a VATSIM CID yet" : String(body.cid || "").trim();

  const aircraft = Array.isArray(body.aircraft)
    ? [...new Set(body.aircraft.map(String).filter((x: string) => ALLOWED_AIRCRAFT.includes(x)))]
    : [];

  if (
    username.length < 3 || username.length > 32 ||
    !/^[0-9]{17,20}$/.test(discordId) ||
    email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    (!body.noVatsim && !/^[0-9]{1,12}$/.test(cid)) ||
    !aircraft.length
  ) {
    res.status(400).json({ error: "Check your details and select at least one aircraft." });
    return;
  }

  try {
    // Re-verify the Discord ID server-side; never trust browser-submitted profile data.
    const lookup = await fetch(`${DISCORD_API}/users/${discordId}`, {
      headers: { Authorization: `Bot ${token}`, "User-Agent": USER_AGENT },
    });
    if (!lookup.ok) {
      res.status(400).json({ error: "Could not verify that Discord account." });
      return;
    }
    const user = (await lookup.json()) as { id: string; username: string; global_name?: string | null };

    const message = [
      "**New vJetstar pilot application**",
      "",
      `**Pilot hub username:** ${escapeDiscord(username)}`,
      `**Discord account:** ${escapeDiscord(user.global_name || user.username)} (@${escapeDiscord(user.username)})`,
      `**Discord user ID:** ${user.id}`,
      `**VATSIM CID:** ${escapeDiscord(cid)}`,
      `**Preferred aircraft:** ${aircraft.map(escapeDiscord).join(", ")}`,
      `**Email:** ${escapeDiscord(email)}`,
      "",
      "_No password was requested or stored._",
    ].join("\n");

    const headers = botHeaders(token);
    const modRole = process.env["DISCORD_MOD_ROLE_ID"];
    const components = [{
      type: 1,
      components: [
        { type: 2, style: 3, label: "Accept application", custom_id: `vjetstar:accept:${discordId}` },
        { type: 2, style: 4, label: "Decline application", custom_id: `vjetstar:decline:${discordId}` },
      ],
    }];

    let delivered = false;

    // Preferred: post into the mods channel so any mod can accept/decline.
    if (modChannelId) {
      const content = (modRole ? `<@&${modRole}> ` : "") + message;
      const sent = await fetch(`${DISCORD_API}/channels/${modChannelId}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          content,
          components,
          allowed_mentions: { parse: [], roles: modRole ? [modRole] : [] },
        }),
      });
      if (sent.ok) delivered = true;
      else logger.warn({ status: sent.status, detail: await sent.text().catch(() => "") }, "apply: mods-channel post failed");
    }

    // Fallback (or if no channel configured): DM the recruiter.
    if (!delivered && recruiterId) {
      const dmResponse = await fetch(`${DISCORD_API}/users/@me/channels`, {
        method: "POST",
        headers,
        body: JSON.stringify({ recipient_id: String(recruiterId) }),
      });
      if (dmResponse.ok) {
        const dm = (await dmResponse.json()) as { id: string };
        const sent = await fetch(`${DISCORD_API}/channels/${dm.id}/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({ content: message, components, allowed_mentions: { parse: [] } }),
        });
        if (sent.ok) delivered = true;
      }
    }

    if (!delivered) {
      res.status(502).json({ error: "Discord could not deliver the application. Check the bot's access to the applications channel." });
      return;
    }

    // Store the application so we can auto-create the pilot's hub account if the
    // recruiter accepts it later. Keyed by Discord ID — re-applying overwrites.
    try {
      const aircraftCsv = aircraft.join(",");
      const storedCid = body.noVatsim ? null : cid;
      await db
        .insert(applicationsTable)
        .values({
          discordId,
          username,
          aircraft: aircraftCsv,
          email,
          cid: storedCid,
          status: "pending",
        })
        .onConflictDoUpdate({
          target: applicationsTable.discordId,
          set: {
            username,
            aircraft: aircraftCsv,
            email,
            cid: storedCid,
            status: "pending",
            createdAt: new Date(),
            decidedAt: null,
          },
        });
    } catch (err) {
      // Non-fatal: the recruiter still got the application DM. Auto-create on
      // accept just won't have a stored record to work from.
      logger.error({ err }, "apply: failed to store application");
    }

    res.json({ ok: true });
  } catch {
    res.status(502).json({ error: "A delivery error occurred. Please try again later." });
  }
});

// ── POST /api/discord-interactions ───────────────────────────────────────────
function verifyDiscordSignature(rawBody: Buffer, signature: string, timestamp: string, publicKeyHex: string): boolean {
  if (!signature || !timestamp || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  try {
    // Wrap the raw 32-byte Ed25519 public key in a DER/SPKI envelope so Node's
    // crypto can import it (Node has no raw-key import for Ed25519).
    const der = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(publicKeyHex, "hex"),
    ]);
    const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    const msg = Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]);
    return crypto.verify(null, msg, key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

async function dmUser(token: string, recipientId: string, content: string, components: unknown[]): Promise<void> {
  const dmChRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: botHeaders(token),
    body: JSON.stringify({ recipient_id: recipientId }),
  });
  if (!dmChRes.ok) return;
  const dmCh = (await dmChRes.json()) as { id: string };
  await fetch(`${DISCORD_API}/channels/${dmCh.id}/messages`, {
    method: "POST",
    headers: botHeaders(token),
    body: JSON.stringify({ content, components, allowed_mentions: { parse: [] } }),
  });
}

router.post("/discord-interactions", async (req: Request, res: Response): Promise<void> => {
  const token = process.env["DISCORD_BOT_TOKEN"];
  const recruiterId = process.env["DISCORD_USER_ID"];
  const publicKey = process.env["DISCORD_PUBLIC_KEY"];
  if (!token || !publicKey) {
    res.status(503).json({ error: "Discord interactions are not configured." });
    return;
  }

  const signature = String(req.header("X-Signature-Ed25519") || "");
  const timestamp = String(req.header("X-Signature-Timestamp") || "");
  const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

  if (!verifyDiscordSignature(rawBody, signature, timestamp, publicKey)) {
    logger.warn(
      { hasSig: !!signature, hasTs: !!timestamp, hasRawBody: !!req.rawBody, rawLen: rawBody.length },
      "discord-interactions: signature verification failed",
    );
    res.status(401).json({ error: "Invalid Discord request signature." });
    return;
  }

  const interaction = req.body ?? {};
  logger.info(
    { type: interaction.type, customId: interaction.data?.custom_id },
    "discord-interactions: handling",
  );

  // PING
  if (interaction.type === 1) {
    res.json({ type: 1 });
    return;
  }

  // ── Slash commands (type 2) ───────────────────────────────────────────────
  if (interaction.type === 2) {
    const commandName = String(interaction.data?.name || "");

    // /say <message> — post the message as a plain bot message in the channel
    // it was used in. No reply, no command attribution; the invoker gets a
    // private "Sent" confirmation.
    if (commandName === "say") {
      const options: Array<{ name: string; value?: unknown }> = interaction.data?.options || [];
      const message = String(options.find((o) => o.name === "message")?.value ?? "").slice(0, 2000);
      const channelId = String(interaction.channel_id || interaction.channel?.id || "");

      if (!message.trim()) {
        res.json({ type: 4, data: { content: "You need to give me something to say.", flags: 64 } });
        return;
      }
      if (!channelId) {
        res.json({ type: 4, data: { content: "Couldn't tell which channel to post in.", flags: 64 } });
        return;
      }

      // Defer with an ephemeral response (only the invoker sees it), then post
      // the real message and edit the confirmation with the outcome.
      res.json({ type: 5, data: { flags: 64 } });

      const appId = String(interaction.application_id || "");
      const interactionToken = String(interaction.token || "");
      void (async () => {
        let ok = false;
        try {
          const r = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
            method: "POST",
            headers: botHeaders(token),
            // parse: [] → the message never pings @everyone/@here, roles or users,
            // so /say can't be used to mass-mention.
            body: JSON.stringify({ content: message, allowed_mentions: { parse: [] } }),
          });
          ok = r.ok;
          if (!ok) {
            const body = await r.text().catch(() => "");
            logger.warn({ status: r.status, channelId, body: body.slice(0, 200) }, "say: failed to post message");
          }
        } catch (err) {
          logger.error({ err }, "say: post error");
        }

        if (appId && interactionToken) {
          try {
            await fetch(`${DISCORD_API}/webhooks/${appId}/${interactionToken}/messages/@original`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: ok
                  ? "✅ Sent."
                  : "❌ Couldn't send that — check I have permission to post in this channel.",
              }),
            });
          } catch { /* best-effort */ }
        }
      })();
      return;
    }

    res.json({ type: 4, data: { content: "Unknown command.", flags: 64 } });
    return;
  }

  // Only component (button) interactions beyond this point
  if (interaction.type !== 3) {
    res.json({ type: 4, data: { content: "Unsupported interaction.", flags: 64 } });
    return;
  }

  const customId = String(interaction.data?.custom_id || "");
  const guildId = process.env["DISCORD_GUILD_ID"];

  // ── Applicant onboarding button ───────────────────────────────────────────
  const readMatch = /^vjetstar:onboarded:([0-9]{17,20})$/.exec(customId);
  if (readMatch) {
    const applicantId = readMatch[1]!;
    const clickerId = String(interaction.member?.user?.id || interaction.user?.id || "");
    if (clickerId !== applicantId) {
      res.json({ type: 4, data: { content: "This button is only for the applicant.", flags: 64 } });
      return;
    }

    res.json({
      type: 7,
      data: {
        content: "✅ You've been added as a **vJetstar Pilot**. Welcome to the team — see you in the skies! 🛫",
        components: [],
        allowed_mentions: { parse: [] },
      },
    });

    // Background role swap (response already sent). A confirmed pilot should
    // hold ONLY the pilot role, so strip both the "no application yet" and
    // "accepted" roles first (in case accept couldn't remove them earlier), then
    // add the pilot role LAST.
    if (guildId) {
      const noApp = process.env["ROLE_NO_APPLICATION_ID"];
      const accepted = process.env["ROLE_ACCEPTED_ID"];
      const pilot = process.env["ROLE_PILOT_ID"];
      void (async () => {
        if (noApp) await changeMemberRole(token, guildId, applicantId, noApp, "DELETE", "remove no-application");
        if (accepted) await changeMemberRole(token, guildId, applicantId, accepted, "DELETE", "remove accepted");
        if (pilot) await changeMemberRole(token, guildId, applicantId, pilot, "PUT", "add pilot");
      })();
    }
    return;
  }

  // ── Accept / Decline (recruiter only) ─────────────────────────────────────
  const match = /^vjetstar:(accept|decline):([0-9]{17,20})$/.exec(customId);
  if (!match) {
    res.json({ type: 4, data: { content: "This application button is invalid.", flags: 64 } });
    return;
  }

  // Any mod can decide. The application is posted in a mods-only channel, so
  // channel visibility already gates who can click; if DISCORD_MOD_ROLE_ID is
  // set we additionally require that role. The recruiter can always decide.
  const actorId = String(interaction.member?.user?.id || interaction.user?.id || "");
  const modRole = process.env["DISCORD_MOD_ROLE_ID"];
  const actorRoles: string[] = Array.isArray(interaction.member?.roles) ? interaction.member.roles : [];
  const isRecruiter = recruiterId ? actorId === String(recruiterId) : false;
  const isMod = modRole ? actorRoles.includes(modRole) : true;
  if (!isRecruiter && !isMod) {
    res.json({ type: 4, data: { content: "You need to be a vJetstar moderator to decide applications.", flags: 64 } });
    return;
  }

  const decision = match[1]!;
  const applicantId = match[2]!;
  const decisionLabel = decision === "accept" ? "ACCEPTED" : "DECLINED";

  const dmComponents = decision === "accept"
    ? [{
        type: 1,
        components: [{
          type: 2,
          style: 3,
          label: "✅ I've read #whats-next — make me a Pilot!",
          custom_id: `vjetstar:onboarded:${applicantId}`,
        }],
      }]
    : [];

  // Respond immediately: update the original message in place and disable its buttons.
  const originalContent = String(interaction.message?.content || "**vJetstar pilot application**");
  const disabledComponents = (interaction.message?.components || []).map((row: any) => ({
    type: 1,
    components: (row.components || []).map((btn: any) => ({
      type: 2,
      style: btn.style,
      label: btn.label,
      custom_id: btn.custom_id,
      disabled: true,
    })),
  }));

  res.json({
    type: 7,
    data: {
      content: `${originalContent}\n\n**Decision: ${decisionLabel}**`,
      components: disabledComponents,
      allowed_mentions: { parse: [] },
    },
  });

  // Background work (response already sent): on accept, create the pilot's hub
  // account; then DM the applicant and swap roles. On decline, just record it.
  void (async () => {
    if (decision === "decline") {
      try {
        await db.update(applicationsTable)
          .set({ status: "declined", decidedAt: new Date() })
          .where(eq(applicationsTable.discordId, applicantId));
      } catch (err) { logger.error({ err }, "decline: failed to update application status"); }

      try {
        await dmUser(
          token,
          applicantId,
          "Thank you for applying to vJetstar. Unfortunately, your pilot application has been **declined** at this time.",
          [],
        );
      } catch { /* best-effort */ }
      return;
    }

    // ── Accept: auto-create the hub account from the stored application ──
    let hubUsername: string | undefined;
    let accountCreated = false;
    let usernameTaken = false;
    try {
      const [appRow] = await db.select().from(applicationsTable)
        .where(eq(applicationsTable.discordId, applicantId));

      if (appRow?.username) {
        hubUsername = appRow.username;
        const hash = await bcrypt.hash(DEFAULT_PILOT_PASSWORD, 12);
        const aircraft = appRow.aircraft && appRow.aircraft.trim() ? appRow.aircraft : "A320";
        const inserted = await db.insert(usersTable).values({
          username: appRow.username,
          passwordHash: hash,
          aircraft,
          simulatorVersion: "MSFS2024",
          isAdmin: "false",
          hasSeenTutorial: "false",
          mustChangePassword: "true",
          discordId: applicantId,
        }).onConflictDoNothing({ target: usersTable.username }).returning();

        accountCreated = inserted.length > 0;
        usernameTaken = !accountCreated;
        if (usernameTaken) {
          logger.warn({ username: appRow.username }, "accept: hub username already exists — no account created");
        }

        await db.update(applicationsTable)
          .set({ status: "accepted", decidedAt: new Date() })
          .where(eq(applicationsTable.discordId, applicantId));
      } else {
        logger.warn({ applicantId }, "accept: no stored application found — cannot auto-create account");
      }
    } catch (err) {
      logger.error({ err }, "accept: account creation failed");
    }

    // Build the acceptance DM, including login details when an account was made.
    const lines = [
      "🎉 Congratulations — your **vJetstar pilot application has been accepted!**",
    ];
    if (accountCreated && hubUsername) {
      lines.push(
        "",
        "**Your pilot hub account is ready:**",
        `• Username: \`${hubUsername}\``,
        `• Temporary password: \`${DEFAULT_PILOT_PASSWORD}\``,
        "You'll be asked to set a new password the first time you sign in.",
      );
    } else if (usernameTaken && hubUsername) {
      lines.push(
        "",
        `We couldn't auto-create your hub account because the username \`${hubUsername}\` is already taken. An admin will sort this out with you.`,
      );
    }
    lines.push(
      "",
      "Head to **#❔︱whats-next** in our Discord server to find out everything you need to do next.",
      "",
      "Once you've had a read through, hit the button below and you'll be granted your Pilot role automatically.",
    );

    try {
      await dmUser(token, applicantId, lines.join("\n"), dmComponents);
    } catch { /* best-effort */ }

    if (guildId) {
      const noApp = process.env["ROLE_NO_APPLICATION_ID"];
      const accepted = process.env["ROLE_ACCEPTED_ID"];
      // Remove the "no application yet" role on accept, then add the accepted role.
      if (noApp) {
        await changeMemberRole(token, guildId, applicantId, noApp, "DELETE", "remove no-application");
      } else {
        logger.warn("accept: ROLE_NO_APPLICATION_ID not set — cannot remove the 'no application yet' role");
      }
      if (accepted) await changeMemberRole(token, guildId, applicantId, accepted, "PUT", "add accepted");
    }
  })();
});

// ── GET /api/recruitment-diagnostics ─────────────────────────────────────────
// Self-check for the role automation. Open in a browser:
//   https://<your-domain>/api/recruitment-diagnostics?key=<DISCORD_PUBLIC_KEY>
// It reports whether the bot can actually manage each configured role — the
// usual reason a role removal silently does nothing is that the bot's own role
// sits below the target role, or the bot lacks Manage Roles.
const PERM_ADMINISTRATOR = 1n << 3n;
const PERM_MANAGE_ROLES = 1n << 28n;

router.get("/recruitment-diagnostics", async (req: Request, res: Response): Promise<void> => {
  const token = process.env["DISCORD_BOT_TOKEN"];
  const publicKey = process.env["DISCORD_PUBLIC_KEY"];
  const guildId = process.env["DISCORD_GUILD_ID"];

  // Simple auth: the caller must know the app's public key (an admin-only value).
  if (!publicKey || String(req.query["key"] || "") !== publicKey) {
    res.status(403).json({ error: "Forbidden. Append ?key=<DISCORD_PUBLIC_KEY>." });
    return;
  }
  if (!token) { res.status(503).json({ error: "DISCORD_BOT_TOKEN not set." }); return; }
  if (!guildId) { res.status(503).json({ error: "DISCORD_GUILD_ID not set." }); return; }

  const authHeader = { Authorization: `Bot ${token}`, "User-Agent": USER_AGENT };

  try {
    // Who is the bot?
    const meRes = await fetch(`${DISCORD_API}/users/@me`, { headers: authHeader });
    if (!meRes.ok) { res.status(502).json({ error: `Could not fetch bot user (HTTP ${meRes.status}). Is DISCORD_BOT_TOKEN a valid bot token?` }); return; }
    const me = (await meRes.json()) as { id: string; username: string };

    // All roles in the guild (with positions + permissions).
    const rolesRes = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, { headers: authHeader });
    if (!rolesRes.ok) {
      res.status(502).json({ error: `Could not fetch guild roles (HTTP ${rolesRes.status}). Is the bot in the server and is DISCORD_GUILD_ID correct?` });
      return;
    }
    const allRoles = (await rolesRes.json()) as Array<{ id: string; name: string; position: number; permissions: string }>;

    // The bot's own member record → which roles it has.
    const memberRes = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${me.id}`, { headers: authHeader });
    if (!memberRes.ok) {
      res.status(502).json({ error: `Bot is not a member of guild ${guildId} (HTTP ${memberRes.status}). Re-invite the bot to the server.` });
      return;
    }
    const member = (await memberRes.json()) as { roles: string[] };

    const byId = new Map(allRoles.map((r) => [r.id, r]));
    const botRoles = member.roles.map((id) => byId.get(id)).filter(Boolean) as typeof allRoles;
    const botHighest = botRoles.reduce((max, r) => Math.max(max, r.position), 0);

    // Does the bot have Manage Roles (or Administrator) anywhere?
    let perms = 0n;
    for (const r of botRoles) { try { perms |= BigInt(r.permissions); } catch { /* skip */ } }
    // @everyone role carries base permissions too.
    const everyone = byId.get(guildId);
    if (everyone) { try { perms |= BigInt(everyone.permissions); } catch { /* skip */ } }
    const hasManageRoles = (perms & PERM_MANAGE_ROLES) !== 0n || (perms & PERM_ADMINISTRATOR) !== 0n;

    const configured = {
      ROLE_NO_APPLICATION_ID: process.env["ROLE_NO_APPLICATION_ID"],
      ROLE_ACCEPTED_ID: process.env["ROLE_ACCEPTED_ID"],
      ROLE_PILOT_ID: process.env["ROLE_PILOT_ID"],
    };

    const report = Object.entries(configured).map(([envName, roleId]) => {
      if (!roleId) return { envName, set: false, note: "not set" };
      const role = byId.get(roleId);
      if (!role) return { envName, set: true, roleId, found: false, note: "No role with this ID exists in the server — wrong ID." };
      const manageable = hasManageRoles && botHighest > role.position;
      return {
        envName,
        set: true,
        roleId,
        found: true,
        roleName: role.name,
        rolePosition: role.position,
        manageable,
        note: manageable
          ? "OK — the bot can add/remove this role."
          : !hasManageRoles
            ? "Bot is missing the Manage Roles permission."
            : `Bot CANNOT manage this role: its position (${role.position}) is at or above the bot's highest role (${botHighest}). Move the bot's role ABOVE this one in Server Settings → Roles.`,
      };
    });

    const problems = report.filter((r) => r.set && r.found === true && r.manageable === false);
    res.json({
      bot: { id: me.id, username: me.username, highestRolePosition: botHighest, hasManageRoles },
      roles: report,
      verdict: !hasManageRoles
        ? "❌ The bot lacks Manage Roles. Give its role the Manage Roles permission."
        : problems.length
          ? "❌ The bot's role is too low to manage one or more configured roles. Drag the bot's role ABOVE them in Server Settings → Roles."
          : report.some((r) => r.set && r.found === false)
            ? "❌ One or more role IDs don't match any role in the server — check the env values."
            : "✅ The bot can manage all configured roles. If a role still isn't changing, check the Render logs for the 'role change' lines.",
    });
  } catch (err) {
    logger.error({ err }, "recruitment-diagnostics failed");
    res.status(502).json({ error: "Diagnostics failed — see server logs." });
  }
});

export default router;
