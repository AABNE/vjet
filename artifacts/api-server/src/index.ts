import app from "./app";
import { logger } from "./lib/logger";
import { initDb } from "./lib/init-db";
import { startRouteScheduler } from "./lib/route-scheduler";
import { startNoShowWatch } from "./lib/no-show";
import { startOpsMonitor } from "./lib/ops-monitor";
import { startSelfKeepalive } from "./lib/keepalive";
import { registerDiscordCommands } from "./lib/discord-commands";
import { cleanupOrphanCockpitVcs } from "./lib/discord-vc";
import { startCockpitReaper } from "./lib/cockpit";

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
    // 30 minutes before departure.
    startRouteScheduler();

    // Page pilots whose aircraft isn't up ~30 min before departure.
    startNoShowWatch();

    // Airline operations monitor: delay detection, dispatch + fleet checks,
    // all logged for the AI Control Room.
    startOpsMonitor();

    // Keep the free-tier instance warm so Discord interactions (Accept/Decline)
    // hit a running server within Discord's 3-second window.
    startSelfKeepalive();

    // Register the bot's slash commands (e.g. /say) with Discord.
    void registerDiscordCommands();

    // Sweep any cockpit voice channels orphaned by a restart.
    void cleanupOrphanCockpitVcs();

    // End abandoned shared cockpits + delete their voice channels.
    startCockpitReaper();
  });
});
