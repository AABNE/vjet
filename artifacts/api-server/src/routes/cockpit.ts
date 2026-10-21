import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, timetableTable, flightsTable, eq, and } from "@workspace/db";
import { hubConnected, hubRequired, notify } from "../lib/ops";
import {
  createSession, joinSession, leaveSession, setRole, getSession, sessionOfUser,
  attachStream, signal, postChat, publicState, type FlightInfo, type Role,
} from "../lib/cockpit";

const router: IRouter = Router();

async function me(req: Request): Promise<{ id: number; username: string; avatarUrl: string | null; hasHub: boolean } | null> {
  const userId = (req.session as any)?.userId;
  if (!userId) return null;
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!u) return null;
  return { id: u.id, username: u.username, avatarUrl: u.avatarUrl ?? null, hasHub: await hubConnected(u.id) };
}

const ROLES: Role[] = ["pilot_flying", "pilot_monitoring", "flap_operator"];

// POST /api/cockpit/create { timetableId } — start a shared cockpit for a flight.
router.post("/cockpit/create", async (req: Request, res: Response): Promise<void> => {
  const u = await me(req); if (!u) { res.status(401).json({ error: "Not authenticated" }); return; }
  const timetableId = Number(req.body?.timetableId);
  const [entry] = await db.select().from(timetableTable).where(and(eq(timetableTable.id, timetableId), eq(timetableTable.userId, u.id)));
  if (!entry) { res.status(404).json({ error: "That flight isn't on your timetable." }); return; }
  if (await hubRequired() && !u.hasHub) { res.status(409).json({ error: "You need the pilot hub open (Sim Link + MSFS) to host a shared cockpit." }); return; }
  const [f] = await db.select().from(flightsTable).where(eq(flightsTable.id, entry.flightId));
  if (!f) { res.status(404).json({ error: "Flight not found." }); return; }
  const flight: FlightInfo = {
    timetableId: entry.id, flightId: f.id, flightNumber: f.flightNumber,
    departure: f.departure, arrival: f.arrival, aircraft: f.aircraft,
    registration: f.registration ?? null, departureTime: f.departureTime, flightDate: f.flightDate,
  };
  const s = createSession({ userId: u.id, username: u.username, avatarUrl: u.avatarUrl, hasHub: u.hasHub }, flight);
  res.json({ code: s.code });
});

// GET /api/cockpit/ice — ICE servers for the voice mesh. TURN credentials come
// from env (served at runtime to signed-in users, never baked into the bundle)
// so two pilots on strict/CGNAT networks can still relay a call.
router.get("/cockpit/ice", async (req: Request, res: Response): Promise<void> => {
  const u = await me(req); if (!u) { res.status(401).json({ error: "Not authenticated" }); return; }
  const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];
  const urls = (process.env.TURN_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_CREDENTIAL;
  if (urls.length && username && credential) {
    iceServers.push({ urls, username, credential });
  }
  res.json({ iceServers });
});

// GET /api/cockpit/:code — current state.
router.get("/cockpit/:code", async (req: Request, res: Response): Promise<void> => {
  const u = await me(req); if (!u) { res.status(401).json({ error: "Not authenticated" }); return; }
  const s = getSession(String(req.params.code));
  if (!s) { res.status(404).json({ error: "That shared cockpit doesn't exist or has ended." }); return; }
  res.json({ ...publicState(s), you: u.id, isHost: s.hostUserId === u.id, joined: s.participants.has(u.id) });
});

// POST /api/cockpit/:code/join
router.post("/cockpit/:code/join", async (req: Request, res: Response): Promise<void> => {
  const u = await me(req); if (!u) { res.status(401).json({ error: "Not authenticated" }); return; }
  const r = joinSession(String(req.params.code), { userId: u.id, username: u.username, avatarUrl: u.avatarUrl, hasHub: u.hasHub });
  if (!r.ok) { res.status(400).json({ error: r.error }); return; }
  res.json({ ok: true, code: r.session!.code });
});

// POST /api/cockpit/:code/leave
router.post("/cockpit/:code/leave", async (req: Request, res: Response): Promise<void> => {
  const u = await me(req); if (!u) { res.status(401).json({ error: "Not authenticated" }); return; }
  leaveSession(u.id);
  res.json({ ok: true });
});

// POST /api/cockpit/:code/role { targetUserId, role } — host only.
router.post("/cockpit/:code/role", async (req: Request, res: Response): Promise<void> => {
  const u = await me(req); if (!u) { res.status(401).json({ error: "Not authenticated" }); return; }
  const target = Number(req.body?.targetUserId);
  const role = String(req.body?.role) as Role;
  if (!ROLES.includes(role)) { res.status(400).json({ error: "Invalid role." }); return; }
  const r = setRole(u.id, target, role);
  if (!r.ok) { res.status(400).json({ error: r.error }); return; }
  res.json({ ok: true });
});

// POST /api/cockpit/:code/invite { username } — ping another pilot with the link.
router.post("/cockpit/:code/invite", async (req: Request, res: Response): Promise<void> => {
  const u = await me(req); if (!u) { res.status(401).json({ error: "Not authenticated" }); return; }
  const s = getSession(String(req.params.code));
  if (!s || s.hostUserId !== u.id) { res.status(403).json({ error: "Only the host can invite." }); return; }
  const username = String(req.body?.username || "").trim();
  if (!username) { res.status(400).json({ error: "Enter a pilot's username." }); return; }
  const [target] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (!target) { res.status(404).json({ error: "No pilot with that username." }); return; }
  await notify(target.id, "ops", `Shared cockpit invite — ${s.flight.flightNumber}`,
    `${u.username} invited you to fly ${s.flight.departure}→${s.flight.arrival} together. Join at /cockpit/${s.code}`);
  res.json({ ok: true });
});

// POST /api/cockpit/:code/chat { text } — crew chat (flight plans, links, etc.).
router.post("/cockpit/:code/chat", async (req: Request, res: Response): Promise<void> => {
  const u = await me(req); if (!u) { res.status(401).json({ error: "Not authenticated" }); return; }
  const text = String(req.body?.text || "").trim();
  if (!text) { res.status(400).json({ error: "Empty message." }); return; }
  if (!postChat(u.id, text)) { res.status(400).json({ error: "You're not in this cockpit." }); return; }
  res.json({ ok: true });
});

// POST /api/cockpit/:code/signal { to, data } — relay a WebRTC signalling message.
router.post("/cockpit/:code/signal", async (req: Request, res: Response): Promise<void> => {
  const u = await me(req); if (!u) { res.status(401).json({ error: "Not authenticated" }); return; }
  const to = Number(req.body?.to);
  signal(u.id, to, req.body?.data);
  res.json({ ok: true });
});

// GET /api/cockpit/:code/stream — SSE: live state + peer presence + signalling.
router.get("/cockpit/:code/stream", async (req: Request, res: Response): Promise<void> => {
  const u = await me(req); if (!u) { res.status(401).json({ error: "Not authenticated" }); return; }
  const s = sessionOfUser(u.id);
  if (!s || s.code !== String(req.params.code).toUpperCase()) { res.status(404).json({ error: "Join the cockpit first." }); return; }
  res.writeHead(200, {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive", "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  const detach = attachStream(s.code, u.id, (str) => res.write(str));
  const hb = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* */ } }, 20_000);
  req.on("close", () => { clearInterval(hb); detach?.(); });
});

export default router;
