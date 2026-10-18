import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import flightsRouter from "./flights";
import timetableRouter from "./timetable";
import adminRouter from "./admin";
import simbriefRouter from "./simbrief";
import trackerRouter from "./tracker";
import recruitmentRouter from "./recruitment";
import dispatchRouter from "./dispatch";
import notificationsRouter from "./notifications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(recruitmentRouter);
router.use(authRouter);
router.use(flightsRouter);
router.use(timetableRouter);
router.use(adminRouter);
router.use(simbriefRouter);
router.use(trackerRouter);
router.use(dispatchRouter);
router.use(notificationsRouter);

export default router;
