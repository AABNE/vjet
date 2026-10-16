import app from "./app";
import { logger } from "./lib/logger";
import { initDb } from "./lib/init-db";
import { startRouteScheduler } from "./lib/route-scheduler";

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
  });
});
