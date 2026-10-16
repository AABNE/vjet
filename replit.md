# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Auth**: express-session + bcryptjs

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   └── flight-timetable/   # React + Vite frontend (Jetstar Virtual Ops)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
│   └── src/seed.ts         # Database seed script
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Application: Jetstar Virtual Ops

Microsoft Flight Simulator 2020/2024 pilot portal. Pilots can browse Jetstar route examples, manage a personal timetable, track completed flights, and import their latest SimBrief OFP into the timetable on demand.

### Fleet
- **A320** — Airbus A320-200
- **A20N** — Airbus A320neo
- **A21N** — Airbus A321neo LR
- **B788** — Boeing 787-8

Pilot accounts select a simulator version and one or more assigned aircraft. The first account is created through the one-time administrator bootstrap screen.

### SimBrief
Pilots save their SimBrief/Navigraph username in Pilot Settings. An explicit import action retrieves the latest plan via SimBrief's public JSON v2 API. There is no API key and no background polling. Imported aircraft must match the pilot's assigned Jetstar fleet.

### Sample routes
`pnpm --filter @workspace/scripts run seed` loads 14 days of sample routes based on published Jetstar route information. Times are simulation examples only, not live Jetstar schedules or operational status. Route sources are documented in the seed script.

`pnpm --filter @workspace/scripts run reset-jetstar` destructively clears pilot accounts, timetable records, flights, and sessions. Do not run it unless a full development-data reset is intended.

### Environment variables needed
- `SESSION_SECRET` — Express session secret
- `DATABASE_URL` — PostgreSQL connection string (auto-provisioned by Replit)

## DB Schema

- `users` — pilot accounts, password hash, assigned aircraft, simulator version, and SimBrief username
- `flights` — available flights (id, flight_number, departure, arrival, aircraft, departure_time, flight_date, duration_minutes)
- `timetable` — pilot's scheduled flights (id, user_id, flight_id, status, started_at, finished_at, flight_duration_seconds)
- `session` — PostgreSQL-backed login sessions

## API Routes

- `GET /api/auth/bootstrap-status` — check whether the first administrator is needed
- `POST /api/auth/bootstrap` — atomically create the first administrator
- `POST /api/auth/login` — login
- `POST /api/auth/logout` — logout
- `GET /api/auth/me` — get current user
- `PATCH /api/auth/profile` — update simulator and SimBrief settings
- `GET /api/flights` — available flights for user's aircraft
- `POST /api/simbrief/import` — explicitly import the latest SimBrief plan
- `GET /api/timetable` — user's timetable
- `POST /api/timetable` — add flight to timetable
- `POST /api/timetable/:id/start` — start flight
- `POST /api/timetable/:id/finish` — finish and log a flight
- `DELETE /api/timetable/:id` — remove completed flight
- `/api/admin/*` — administrator dispatch and account management

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

## Workflows and checks

- Frontend workflow: `artifacts/flight-timetable: web`
- Backend workflow: `artifacts/api-server: API Server`
- Run `pnpm run typecheck` for shared libraries, frontend, backend, and scripts.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API client + Zod schemas
- `pnpm --filter @workspace/db run push` — push schema changes to DB
