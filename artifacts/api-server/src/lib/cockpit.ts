// Shared-cockpit sessions: two (or more) pilots on the same flight, with live
// presence, role assignment, in-page chat and WebRTC voice signalling. State is
// in memory (fine for a single instance) — a live call session doesn't need to
// survive a restart. SSE pushes state changes and relays WebRTC signalling.
import { logger } from "./logger";

export type Role = "pilot_flying" | "pilot_monitoring" | "flap_operator";
export const ROLE_LABELS: Record<Role, string> = {
  pilot_flying: "Pilot Flying",
  pilot_monitoring: "Pilot Monitoring",
  flap_operator: "Flap Operator",
};

export interface Participant {
  userId: number;
  username: string;
  avatarUrl: string | null;
  role: Role;
  hasHub: boolean;
  joinedAt: number;
}

export interface FlightInfo {
  timetableId: number;
  flightId: number;
  flightNumber: string;
  departure: string;
  arrival: string;
  aircraft: string;
  registration: string | null;
  departureTime: string;
  flightDate: string;
}

interface Session {
  code: string;
  hostUserId: number;
  flight: FlightInfo;
  participants: Map<number, Participant>;
  createdAt: number;
  // userId → SSE response (for targeted signalling + broadcast)
  streams: Map<number, { write: (s: string) => void }>;
}

const sessions = new Map<string, Session>();          // code → session
const byUser = new Map<number, string>();             // userId → code (one at a time)

function genCode(): string {
  let c = "";
  do { c = Math.random().toString(36).slice(2, 8).toUpperCase(); } while (sessions.has(c));
  return c;
}

export function sessionOfUser(userId: number): Session | undefined {
  const code = byUser.get(userId);
  return code ? sessions.get(code) : undefined;
}
export function getSession(code: string): Session | undefined { return sessions.get(code.toUpperCase()); }

function publicState(s: Session) {
  return {
    code: s.code,
    hostUserId: s.hostUserId,
    flight: s.flight,
    participants: [...s.participants.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({ userId: p.userId, username: p.username, avatarUrl: p.avatarUrl, role: p.role, hasHub: p.hasHub })),
  };
}

function broadcast(s: Session): void {
  const payload = `event: state\ndata: ${JSON.stringify(publicState(s))}\n\n`;
  for (const stream of s.streams.values()) { try { stream.write(payload); } catch { /* ignore */ } }
}

export function createSession(host: { userId: number; username: string; avatarUrl: string | null; hasHub: boolean }, flight: FlightInfo): Session {
  // One session per host flight: reuse if they already have one.
  const existingCode = byUser.get(host.userId);
  if (existingCode) { const ex = sessions.get(existingCode); if (ex && ex.hostUserId === host.userId) return ex; }
  const code = genCode();
  const s: Session = {
    code, hostUserId: host.userId, flight,
    participants: new Map(), createdAt: Date.now(), streams: new Map(),
  };
  s.participants.set(host.userId, { userId: host.userId, username: host.username, avatarUrl: host.avatarUrl, role: "pilot_flying", hasHub: host.hasHub, joinedAt: Date.now() });
  sessions.set(code, s);
  byUser.set(host.userId, code);
  logger.info({ code, host: host.userId }, "cockpit session created");
  return s;
}

export function joinSession(code: string, user: { userId: number; username: string; avatarUrl: string | null; hasHub: boolean }): { ok: boolean; error?: string; session?: Session } {
  const s = sessions.get(code.toUpperCase());
  if (!s) return { ok: false, error: "That shared cockpit doesn't exist or has ended." };
  if (s.participants.has(user.userId)) { return { ok: true, session: s }; }
  if (s.participants.size >= 4) return { ok: false, error: "This cockpit is full." };
  // New joiners come in as the Flap Operator.
  s.participants.set(user.userId, { userId: user.userId, username: user.username, avatarUrl: user.avatarUrl, role: "flap_operator", hasHub: user.hasHub, joinedAt: Date.now() });
  byUser.set(user.userId, s.code);
  broadcast(s);
  return { ok: true, session: s };
}

export function leaveSession(userId: number): void {
  const code = byUser.get(userId);
  if (!code) return;
  const s = sessions.get(code);
  byUser.delete(userId);
  if (!s) return;
  s.participants.delete(userId);
  s.streams.delete(userId);
  // Notify remaining peers that this user left (so they can tear down voice).
  for (const stream of s.streams.values()) { try { stream.write(`event: peer-left\ndata: ${JSON.stringify({ userId })}\n\n`); } catch { /* */ } }
  if (s.participants.size === 0 || userId === s.hostUserId) {
    // Host leaving (or empty) ends the session.
    for (const stream of s.streams.values()) { try { stream.write(`event: ended\ndata: {}\n\n`); } catch { /* */ } }
    for (const p of s.participants.keys()) byUser.delete(p);
    sessions.delete(code);
    logger.info({ code }, "cockpit session ended");
  } else {
    broadcast(s);
  }
}

// Only the host can set roles. Keeps role assignment sane.
export function setRole(hostUserId: number, targetUserId: number, role: Role): { ok: boolean; error?: string } {
  const code = byUser.get(hostUserId);
  const s = code ? sessions.get(code) : undefined;
  if (!s) return { ok: false, error: "No active cockpit." };
  if (s.hostUserId !== hostUserId) return { ok: false, error: "Only the pilot who started the flight can change roles." };
  const p = s.participants.get(targetUserId);
  if (!p) return { ok: false, error: "That pilot isn't in the cockpit." };
  p.role = role;
  broadcast(s);
  return { ok: true };
}

// Attach an SSE stream for a user; returns a detach function.
export function attachStream(code: string, userId: number, write: (s: string) => void): (() => void) | null {
  const s = sessions.get(code.toUpperCase());
  if (!s || !s.participants.has(userId)) return null;
  s.streams.set(userId, { write });
  // Send current state immediately.
  try { write(`event: state\ndata: ${JSON.stringify(publicState(s))}\n\n`); } catch { /* */ }
  // Tell existing peers someone is ready (so the host can start the WebRTC offer).
  for (const [uid, stream] of s.streams) { if (uid !== userId) { try { stream.write(`event: peer-ready\ndata: ${JSON.stringify({ userId })}\n\n`); } catch { /* */ } } }
  return () => { const cur = sessions.get(code.toUpperCase()); cur?.streams.delete(userId); };
}

// Relay a WebRTC signalling message to a specific peer in the session.
export function signal(fromUserId: number, toUserId: number, data: unknown): boolean {
  const code = byUser.get(fromUserId);
  const s = code ? sessions.get(code) : undefined;
  if (!s) return false;
  const target = s.streams.get(toUserId);
  if (!target) return false;
  try { target.write(`event: signal\ndata: ${JSON.stringify({ from: fromUserId, data })}\n\n`); return true; } catch { return false; }
}

export { publicState };
