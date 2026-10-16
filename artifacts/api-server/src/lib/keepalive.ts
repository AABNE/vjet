// Self-keepalive: stops a Render free-tier web service from spinning down.
//
// Render free web services sleep after ~15 minutes with no inbound HTTP
// request, and the cold start that follows (30-60s) is far longer than
// Discord's 3-second interaction window — which is why Accept/Decline buttons
// return "the application didn't respond in time" after the service has been
// idle. Pinging our own public URL on an interval generates inbound traffic and
// keeps the instance awake, so interaction requests hit a warm server.
//
// Render injects RENDER_EXTERNAL_URL automatically. KEEPALIVE_URL overrides it
// (e.g. for a custom domain). If neither is set (local dev), this is a no-op.

import { logger } from "./logger";

const EVERY_MS = 10 * 60 * 1000; // 10 min < Render's ~15 min idle window

export function startSelfKeepalive(): void {
  const base = process.env["KEEPALIVE_URL"] || process.env["RENDER_EXTERNAL_URL"];
  if (!base) {
    logger.info("self-keepalive: no RENDER_EXTERNAL_URL/KEEPALIVE_URL set, skipping");
    return;
  }

  const url = base.endsWith("/healthz") ? base : base.replace(/\/+$/, "") + "/api/healthz";

  const ping = async (): Promise<void> => {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "vjet-self-keepalive" } });
      logger.debug({ status: res.status }, "self-keepalive ping");
    } catch (err) {
      logger.warn({ err }, "self-keepalive ping failed");
    }
  };

  const timer = setInterval(ping, EVERY_MS);
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ url, everyMs: EVERY_MS }, "self-keepalive started");
}
