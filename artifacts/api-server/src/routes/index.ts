import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import flightsRouter from "./flights";
import timetableRouter from "./timetable";
import adminRouter from "./admin";
import simbriefRouter from "./simbrief";
import trackerRouter from "./tracker";
import recruitmentRouter from "./recruitment";

const router: IRouter = Router();

// Always available: health check + pilot recruitment (application site).
router.use(healthRouter);
router.use(recruitmentRouter);

// Pilot hub API — hidden until the hub is finished. Set PILOT_HUB_ENABLED=true
// to bring it back.
if (process.env["PILOT_HUB_ENABLED"] === "true") {
  router.use(authRouter);
  router.use(flightsRouter);
  router.use(timetableRouter);
  router.use(adminRouter);
  router.use(simbriefRouter);
  router.use(trackerRouter);
}

export default router;
