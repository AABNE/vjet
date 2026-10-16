import app from "./app";
import { logger } from "./lib/logger";
import { initDb } from "./lib/init-db";
import { startRouteScheduler } from "./lib/route-scheduler";
import { startSelfKeepalive } from "./lib/keepalive";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

initDb().then(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");

    // Keep a rolling pool of random routes topped up, and prune routes
    // 30 minutes before departure. Only while the pilot hub is enabled.
    if (process.env["PILOT_HUB_ENABLED"] === "true") {
      startRouteScheduler();
    } else {
      logger.info("pilot hub disabled (PILOT_HUB_ENABLED != true) — route scheduler not started");
    }

    // Keep the free-tier instance warm so Discord interactions (Accept/Decline)
    // hit a running server within Discord's 3-second window.
    startSelfKeepalive();
  });
});
