import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

const app: Express = express();
app.set("trust proxy", 1);

app.use(pinoHttp({
  logger,
  serializers: {
    req(req: { id: string; method: string; url?: string }) {
      return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
    },
    res(res: { statusCode: number }) { return { statusCode: res.statusCode }; },
  },
}));

// CORS — allow configured origin or any in dev
const allowedOrigin = process.env["ALLOWED_ORIGIN"];
app.use(cors({
  origin: allowedOrigin
    ? (origin, cb) => {
        if (!origin || origin === allowedOrigin) cb(null, true);
        else cb(new Error("Not allowed by CORS"));
      }
    : true,
  credentials: true,
}));

// Capture the raw body so Discord interaction signatures (Ed25519 over the exact
// bytes) can be verified in the recruitment router.
app.use(express.json({
  verify: (req, _res, buf) => {
    (req as express.Request).rawBody = Buffer.from(buf);
  },
}));
app.use(express.urlencoded({ extended: true }));

const sessionSecret = process.env["SESSION_SECRET"];
if (!sessionSecret) throw new Error("SESSION_SECRET env var required");

// Always use Postgres session store in production
const PgSession = connectPgSimple(session);
const sessionStore = process.env["DATABASE_URL"]
  ? new PgSession({ pool: pool as any, createTableIfMissing: true })
  : undefined;

app.use(session({
  store: sessionStore,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env["NODE_ENV"] === "production",
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: process.env["NODE_ENV"] === "production" ? "strict" : "lax",
  },
}));

// API routes — single clean mount
app.use("/api", router);

// Serve the pilot-application site at /apply (committed static assets, any env).
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const applyDir = path.join(here, "../public/apply");
  app.use("/apply", express.static(applyDir));
}

// The pilot hub is hidden until it's finished — flip PILOT_HUB_ENABLED=true
// (env var) to bring the hub UI back. The application site stays live either way.
const pilotHubEnabled = process.env["PILOT_HUB_ENABLED"] === "true";

if (process.env["NODE_ENV"] === "production") {
  if (pilotHubEnabled) {
    // Serve the built pilot-hub SPA at / with a client-side-routing fallback.
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const staticDir = path.join(__dirname, "../../flight-timetable/dist/public");
    app.use(express.static(staticDir));
    app.get(/.*/, (req, res, next) => {
      if (req.path.startsWith("/api/")) return next(); // let unknown API routes 404
      res.sendFile(path.join(staticDir, "index.html"));
    });
  } else {
    // Hub hidden: send the root and any unknown page to the application form.
    app.get(/.*/, (req, res, next) => {
      if (req.path.startsWith("/api/")) return next(); // let unknown API routes 404
      res.redirect("/apply/");
    });
  }
}

export default app;
