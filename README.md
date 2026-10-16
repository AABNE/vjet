# vJet

The combined vJetstar virtual airline app — **pilot hub**, **pilot application site**, and their Discord integration, in one repo that deploys as a single service on Render.

> Combines the old `vjetpilothub` and `applicationforshittyjetstarairline` repos. The standalone Discord bot was dropped; the recruitment Discord integration (apply DM + accept/decline buttons) now runs server-side as Express routes instead of fragile Cloudflare Functions.

## What it serves

One Node/Express service serves everything:

| Path | What |
| --- | --- |
| `/` | Jetstar Virtual Ops **pilot hub** — React SPA (timetable, SimBrief import, flight logging, admin) |
| `/apply` | **Pilot application** site — recruitment form with live Discord account preview |
| `/api/*` | Express API — pilot hub endpoints **plus** the recruitment endpoints below |

### Recruitment API (ported from the old Cloudflare Pages Functions)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/discord-user` | Look up a Discord account (by username or numeric ID) for the form preview |
| `POST /api/apply` | Deliver an application to the recruiter's Discord DMs, with Accept/Decline buttons |
| `POST /api/discord-interactions` | Discord interactions webhook — Accept / Decline / "make me a Pilot" buttons |

## Stack

pnpm workspace monorepo · Node 20+ · TypeScript 5.9 · Express 5 · PostgreSQL + Drizzle · React + Vite · esbuild.

```
artifacts/
  api-server/        Express API + serves the SPA and /apply  (Render runs this)
    public/apply/    the static pilot-application site
    src/routes/      hub routes + recruitment.ts (apply/discord-user/discord-interactions)
  flight-timetable/  React pilot-hub SPA
  mockup-sandbox/    design sandbox (not built/deployed)
lib/                 db (Drizzle), api-spec, generated zod + react-query clients
scripts/             seed + reset scripts
render.yaml          Render blueprint (web service + keep-alive cron)
```

## Deploy on Render

1. Push this repo to GitHub (already at `AABNE/vjet`).
2. In Render: **New → Blueprint**, point it at this repo. `render.yaml` defines the `vjet` web service and a keep-alive cron.
3. Add a **PostgreSQL** instance (Render or Neon) and set `DATABASE_URL`.
4. Set the environment variables below, then deploy.

Build: `pnpm install --frozen-lockfile && pnpm run build` · Start: `node artifacts/api-server/dist/index.mjs` · Health check: `/api/healthz`.

### Environment variables

**Required (pilot hub):**

| Var | Notes |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (Neon-compatible — the app uses the Neon serverless driver) |
| `SESSION_SECRET` | e.g. `openssl rand -hex 64` |
| `PORT` | Render sets this; `render.yaml` defaults it to `10000` |
| `NODE_ENV` | `production` |

**Optional (recruitment / Discord — routes return `503 not configured` until set, so the app boots fine without them):**

| Var | Notes |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Bot token used for all Discord API calls |
| `DISCORD_USER_ID` | Numeric user ID of the recruitment admin (DM recipient + the only one who can decide applications) |
| `DISCORD_PUBLIC_KEY` | Application public key — verifies interaction signatures. Set the Discord **Interactions Endpoint URL** to `https://<your-service>/api/discord-interactions` |
| `DISCORD_GUILD_ID` | Enables username→ID search for the preview, and role swaps |
| `ROLE_NO_APPLICATION_ID` / `ROLE_ACCEPTED_ID` / `ROLE_PILOT_ID` | Optional role IDs for the accept→onboard flow |

**Keep-alive cron:** set `KEEPALIVE_URL` to `https://<your-service>.onrender.com/api/healthz` (defaults to `https://vjet.onrender.com/api/healthz`).

## First run

On first boot the API creates its tables and seeds a default admin — **username `admin` / password `admin1234`** (change it immediately). Load sample routes with `pnpm --filter @workspace/scripts run seed`.

## Fleet codes

The application form and the pilot hub now share the same fleet codes: **`A320`, `A20N` (A320neo), `A21N` (A321neo), `B788` (787-8)**.

## Local dev

```bash
pnpm install
# backend (needs DATABASE_URL + SESSION_SECRET in the env)
pnpm --filter @workspace/api-server run dev
# frontend (separate terminal, proxies /api to the backend)
pnpm --filter @workspace/flight-timetable run dev
```

`DEPLOY.md` covers an alternative self-hosted VPS setup.
