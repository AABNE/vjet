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

// ── POST /api/apply ──────────────────────────────────────────────────────────
router.post("/apply", async (req: Request, res: Response): Promise<void> => {
  const token = process.env["DISCORD_BOT_TOKEN"];
  const recruiterId = process.env["DISCORD_USER_ID"];
  if (!token || !recruiterId) {
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

    const dmResponse = await fetch(`${DISCORD_API}/users/@me/channels`, {
      method: "POST",
      headers,
      body: JSON.stringify({ recipient_id: String(recruiterId) }),
    });
    if (!dmResponse.ok) {
      res.status(502).json({
        error: "Could not open your Discord DM. Check the bot token, your user ID, and whether the bot can contact you.",
      });
      return;
    }

    const dm = (await dmResponse.json()) as { id: string };
    const sent = await fetch(`${DISCORD_API}/channels/${dm.id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        content: message,
        components: [{
          type: 1,
          components: [
            { type: 2, style: 3, label: "Accept application", custom_id: `vjetstar:accept:${discordId}` },
            { type: 2, style: 4, label: "Decline application", custom_id: `vjetstar:decline:${discordId}` },
          ],
        }],
        allowed_mentions: { parse: [] },
      }),
    });
    if (!sent.ok) {
      res.status(502).json({ error: "Discord could not deliver the application." });
      return;
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
  if (!token || !recruiterId || !publicKey) {
    res.status(503).json({ error: "Discord interactions are not configured." });
    return;
  }

  const signature = String(req.header("X-Signature-Ed25519") || "");
  const timestamp = String(req.header("X-Signature-Timestamp") || "");
  const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

  if (!verifyDiscordSignature(rawBody, signature, timestamp, publicKey)) {
    res.status(401).json({ error: "Invalid Discord request signature." });
    return;
  }

  const interaction = req.body ?? {};

  // PING
  if (interaction.type === 1) {
    res.json({ type: 1 });
    return;
  }

  // Only component (button) interactions
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

    // Background role swap (response already sent)
    if (guildId) {
      const base = `${DISCORD_API}/guilds/${guildId}/members/${applicantId}/roles`;
      const accepted = process.env["ROLE_ACCEPTED_ID"];
      const pilot = process.env["ROLE_PILOT_ID"];
      void (async () => {
        try {
          if (accepted) await fetch(`${base}/${accepted}`, { method: "DELETE", headers: botHeaders(token) });
          if (pilot) await fetch(`${base}/${pilot}`, { method: "PUT", headers: botHeaders(token) });
        } catch { /* best-effort */ }
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

  const actorId = String(interaction.member?.user?.id || interaction.user?.id || "");
  if (actorId !== String(recruiterId)) {
    res.json({ type: 4, data: { content: "Only the vJetstar recruitment administrator can decide applications.", flags: 64 } });
    return;
  }

  const decision = match[1]!;
  const applicantId = match[2]!;
  const decisionLabel = decision === "accept" ? "ACCEPTED" : "DECLINED";

  const dmText = decision === "accept"
    ? [
        "🎉 Congratulations — your **vJetstar pilot application has been accepted!**",
        "",
        "Head to **#❔︱whats-next** in our Discord server to find out everything you need to do next.",
        "",
        "Once you've had a read through, hit the button below and you'll be granted your Pilot role automatically.",
      ].join("\n")
    : "Thank you for applying to vJetstar. Unfortunately, your pilot application has been **declined** at this time.";

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

  // Background work (response already sent): DM the applicant, then swap roles on accept.
  void (async () => {
    try {
      await dmUser(token, applicantId, dmText, dmComponents);
    } catch { /* best-effort */ }

    if (decision === "accept" && guildId) {
      const base = `${DISCORD_API}/guilds/${guildId}/members/${applicantId}/roles`;
      const noApp = process.env["ROLE_NO_APPLICATION_ID"];
      const accepted = process.env["ROLE_ACCEPTED_ID"];
      try {
        if (noApp) await fetch(`${base}/${noApp}`, { method: "DELETE", headers: botHeaders(token) });
        if (accepted) await fetch(`${base}/${accepted}`, { method: "PUT", headers: botHeaders(token) });
      } catch { /* best-effort */ }
    }
  })();
});

export default router;
