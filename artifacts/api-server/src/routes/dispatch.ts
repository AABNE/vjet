import { Router, type IRouter } from "express";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { db, timetableTable, flightsTable, usersTable, eq, and } from "@workspace/db";
import { fetchSimbriefBriefing, SimbriefError, type SimbriefBriefing } from "../lib/simbrief";
import { notify, getBan, addInfraction } from "../lib/ops";

const router: IRouter = Router();

const OPENROUTER_MODEL = "google/gemma-4-26b-a4b-it:free";

// Current ElevenLabs default-library voices (used if we can't read the account's
// own list). These are the modern IDs every account has — not the legacy ones.
const FALLBACK_VOICES: { voice_id: string; name: string }[] = [
  { voice_id: "JBFqnCBsd6RMkjVDRZzb", name: "George" },
  { voice_id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah" },
  { voice_id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura" },
  { voice_id: "IKne3meq5aSn9XLyUdCD", name: "Charlie" },
  { voice_id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum" },
  { voice_id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte" },
  { voice_id: "cgSgspJ2msm6clMCkdW9", name: "Jessica" },
  { voice_id: "cjVigY5qzO86Huf0OWal", name: "Eric" },
  { voice_id: "nPczCjzI2devNBz1zQrb", name: "Brian" },
  { voice_id: "pqHfZKP75CvOlQylNhV4", name: "Bill" },
];

// Cache the account's actual voice library so we only pick IDs that exist there.
let voicesCache: { at: number; voices: { voice_id: string; name: string }[] } | null = null;
async function accountVoices(client: ElevenLabsClient): Promise<{ voices: { voice_id: string; name: string }[]; error?: string }> {
  if (voicesCache && Date.now() - voicesCache.at < 600_000) return { voices: voicesCache.voices };
  try {
    const res: any = await client.voices.getAll();
    const list = Array.isArray(res?.voices)
      ? res.voices
          .map((v: any) => ({ voice_id: String(v.voiceId ?? v.voice_id ?? ""), name: String(v.name ?? "") }))
          .filter((v: any) => v.voice_id)
      : [];
    if (list.length === 0) return { voices: FALLBACK_VOICES };
    voicesCache = { at: Date.now(), voices: list };
    return { voices: list };
  } catch (e: any) {
    return { voices: FALLBACK_VOICES, error: String(e?.message ?? e).slice(0, 200) };
  }
}
function pickVoice(voices: { voice_id: string; name: string }[], seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return voices[h % voices.length];
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function requireUser(req: any, res: any) {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return null; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user) { res.status(401).json({ error: "User not found" }); return null; }
  return user;
}

// The flight dispatch is currently concerned with: the active one, else the
// earliest upcoming (pending) sector.
async function currentEntry(userId: number) {
  const rows = await db.select().from(timetableTable).where(eq(timetableTable.userId, userId));
  const open = rows.filter((e) => e.status === "active" || e.status === "pending");
  if (open.length === 0) return null;
  const active = open.find((e) => e.status === "active");
  let entry = active;
  if (!entry) {
    const withFlights = [];
    for (const e of open) {
      const [f] = await db.select().from(flightsTable).where(eq(flightsTable.id, e.flightId));
      if (f) withFlights.push({ e, f });
    }
    withFlights.sort((a, b) =>
      `${a.f.flightDate} ${a.f.departureTime}`.localeCompare(`${b.f.flightDate} ${b.f.departureTime}`));
    entry = withFlights[0]?.e;
  }
  if (!entry) return null;
  const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, entry.flightId));
  return flight ? { entry, flight } : null;
}

function briefingOf(entry: typeof timetableTable.$inferSelect): SimbriefBriefing | null {
  if (!entry.briefing) return null;
  try { return JSON.parse(entry.briefing) as SimbriefBriefing; } catch { return null; }
}

function publicEntry(entry: typeof timetableTable.$inferSelect, flight: typeof flightsTable.$inferSelect) {
  return {
    id: entry.id,
    status: entry.status,
    dispatchStatus: entry.dispatchStatus,
    pushbackViolation: entry.pushbackViolation,
    briefing: briefingOf(entry),
    flight: {
      id: flight.id,
      flightNumber: flight.flightNumber,
      departure: flight.departure,
      arrival: flight.arrival,
      aircraft: flight.aircraft,
      departureTime: flight.departureTime,
      flightDate: flight.flightDate,
      durationMinutes: flight.durationMinutes,
    },
  };
}

// GET /api/dispatch/state — the pilot's current flight + dispatch status + ban.
router.get("/dispatch/state", async (req, res): Promise<void> => {
  const user = await requireUser(req, res); if (!user) return;
  const ban = await getBan(user.id);
  const cur = await currentEntry(user.id);
  res.json({
    ban: { banned: ban.banned, until: ban.until ? ban.until.toISOString() : null },
    entry: cur ? publicEntry(cur.entry, cur.flight) : null,
  });
});

// GET /api/simbrief/plan — parsed latest SimBrief OFP for custom-flight prefill
// (does NOT add anything to the timetable).
router.get("/simbrief/plan", async (req, res): Promise<void> => {
  const user = await requireUser(req, res); if (!user) return;
  if (!user.simbriefUsername) {
    res.status(400).json({ error: "Add your SimBrief/Navigraph username in Pilot Settings first." });
    return;
  }
  try {
    const briefing = await fetchSimbriefBriefing(user.simbriefUsername);
    res.json({ briefing });
  } catch (e) {
    if (e instanceof SimbriefError) { res.status(e.status).json({ error: e.message }); return; }
    res.status(502).json({ error: "Could not reach SimBrief." });
  }
});

// POST /api/dispatch/:id/import-briefing — attach the latest SimBrief briefing to
// a timetable entry; dispatch then "sends" it.
router.post("/dispatch/:id/import-briefing", async (req, res): Promise<void> => {
  const user = await requireUser(req, res); if (!user) return;
  if (!user.simbriefUsername) {
    res.status(400).json({ error: "Add your SimBrief/Navigraph username in Pilot Settings first." });
    return;
  }
  const id = parseInt(String(req.params.id), 10);
  const [entry] = await db.select().from(timetableTable)
    .where(and(eq(timetableTable.id, id), eq(timetableTable.userId, user.id)));
  if (!entry) { res.status(404).json({ error: "Flight not found" }); return; }
  const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, entry.flightId));
  if (!flight) { res.status(404).json({ error: "Flight not found" }); return; }

  let briefing: SimbriefBriefing;
  try {
    briefing = await fetchSimbriefBriefing(user.simbriefUsername);
  } catch (e) {
    if (e instanceof SimbriefError) { res.status(e.status).json({ error: e.message }); return; }
    res.status(502).json({ error: "Could not reach SimBrief." }); return;
  }

  const [updated] = await db.update(timetableTable)
    .set({ briefing: JSON.stringify(briefing) })
    .where(eq(timetableTable.id, entry.id)).returning();

  await notify(user.id, "dispatch", `Briefing ready — ${flight.flightNumber}`,
    `Your SimBrief flight plan for ${flight.departure}→${flight.arrival} is loaded. Request dispatch when you're ready to board.`);

  res.json(publicEntry(updated, flight));
});

// POST /api/dispatch/:id/request — pilot requests dispatch; ops reviews & approves.
router.post("/dispatch/:id/request", async (req, res): Promise<void> => {
  const user = await requireUser(req, res); if (!user) return;
  const id = parseInt(String(req.params.id), 10);
  const [entry] = await db.select().from(timetableTable)
    .where(and(eq(timetableTable.id, id), eq(timetableTable.userId, user.id)));
  if (!entry) { res.status(404).json({ error: "Flight not found" }); return; }
  const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, entry.flightId));
  if (!flight) { res.status(404).json({ error: "Flight not found" }); return; }

  const ban = await getBan(user.id);
  if (ban.banned) {
    res.status(403).json({ error: `You're grounded until ${ban.until?.toUTCString()}.`, bannedUntil: ban.until?.toISOString() });
    return;
  }

  const [updated] = await db.update(timetableTable)
    .set({ dispatchStatus: "approved" })
    .where(eq(timetableTable.id, entry.id)).returning();
  await notify(user.id, "dispatch", `Dispatch approved — ${flight.flightNumber}`,
    `${flight.departure}→${flight.arrival} approved. Request clearance when boarding is complete, then push back.`);
  res.json(publicEntry(updated, flight));
});

// POST /api/dispatch/:id/clearance — after approval, issue pushback/start clearance.
router.post("/dispatch/:id/clearance", async (req, res): Promise<void> => {
  const user = await requireUser(req, res); if (!user) return;
  const id = parseInt(String(req.params.id), 10);
  const [entry] = await db.select().from(timetableTable)
    .where(and(eq(timetableTable.id, id), eq(timetableTable.userId, user.id)));
  if (!entry) { res.status(404).json({ error: "Flight not found" }); return; }
  const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, entry.flightId));
  if (!flight) { res.status(404).json({ error: "Flight not found" }); return; }
  if (entry.dispatchStatus !== "approved" && entry.dispatchStatus !== "cleared") {
    res.status(409).json({ error: "Request dispatch approval before clearance." });
    return;
  }
  const [updated] = await db.update(timetableTable)
    .set({ dispatchStatus: "cleared" })
    .where(eq(timetableTable.id, entry.id)).returning();
  await notify(user.id, "dispatch", `Cleared — ${flight.flightNumber}`,
    `Cleared to push and start. Have a good flight.`);
  res.json(publicEntry(updated, flight));
});

// POST /api/dispatch/:id/pushback — the app reports the aircraft rolling. Starts
// the sector; if it wasn't cleared first, that's a pushback-before-clearance
// infraction (you still fly, but it's logged).
router.post("/dispatch/:id/pushback", async (req, res): Promise<void> => {
  const user = await requireUser(req, res); if (!user) return;
  const id = parseInt(String(req.params.id), 10);
  const [entry] = await db.select().from(timetableTable)
    .where(and(eq(timetableTable.id, id), eq(timetableTable.userId, user.id)));
  if (!entry) { res.status(404).json({ error: "Flight not found" }); return; }
  const [flight] = await db.select().from(flightsTable).where(eq(flightsTable.id, entry.flightId));
  if (!flight) { res.status(404).json({ error: "Flight not found" }); return; }

  const ban = await getBan(user.id);
  if (ban.banned) {
    res.status(403).json({ error: `You're grounded until ${ban.until?.toUTCString()}.`, bannedUntil: ban.until?.toISOString() });
    return;
  }

  if (entry.status !== "pending") {
    res.json(publicEntry(entry, flight)); // already started/finished — no-op
    return;
  }

  let violation = false;
  if (entry.dispatchStatus !== "cleared" && !entry.pushbackViolation) {
    violation = true;
    await db.update(timetableTable).set({ pushbackViolation: true }).where(eq(timetableTable.id, entry.id));
    await notify(user.id, "ops", `Pushed back without clearance — ${flight.flightNumber}`,
      `You started moving before dispatch cleared you. This is an infraction.`);
    await addInfraction(user.id, "pushback_no_clearance",
      `Pushed back before clearance on ${flight.flightNumber} (${flight.departure}→${flight.arrival})`);
  }

  const [updated] = await db.update(timetableTable)
    .set({ status: "active", startedAt: new Date() })
    .where(eq(timetableTable.id, entry.id)).returning();
  res.json({ ...publicEntry(updated, flight), violation });
});

// POST /api/dispatch/chat — proxy to OpenRouter (Gemma) with the flight plan as context.
router.post("/dispatch/chat", async (req, res): Promise<void> => {
  const user = await requireUser(req, res); if (!user) return;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Dispatch AI isn't configured yet — add OPENROUTER_API_KEY on the server." });
    return;
  }

  const body = req.body ?? {};
  const history: Array<{ role: string; content: string }> = Array.isArray(body.messages) ? body.messages : [];
  const trimmed = history
    .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
    .slice(-12)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));

  const cur = await currentEntry(user.id);
  const b = cur ? briefingOf(cur.entry) : null;
  const f = cur?.flight;

  const planLines: string[] = [];
  if (f) {
    planLines.push(`Flight: ${f.flightNumber} ${f.departure}→${f.arrival}, ${f.aircraft}, sched ${f.departureTime} on ${f.flightDate}, ${f.durationMinutes} min.`);
    planLines.push(`Dispatch status: ${cur!.entry.dispatchStatus} (flight status: ${cur!.entry.status}).`);
  } else {
    planLines.push("The pilot has no active or upcoming sector on their timetable right now.");
  }
  if (b) {
    if (b.route) planLines.push(`Filed route: ${b.route}`);
    if (b.initialAltitude) planLines.push(`Initial altitude: ${b.initialAltitude}`);
    if (b.routeDistanceNm) planLines.push(`Distance: ${b.routeDistanceNm} nm`);
    if (b.costIndex) planLines.push(`Cost index: ${b.costIndex}`);
    if (b.fuelRamp) planLines.push(`Ramp fuel: ${b.fuelRamp} ${b.fuelUnits ?? ""}`);
    if (b.origMetar) planLines.push(`Departure METAR: ${b.origMetar}`);
    if (b.destMetar) planLines.push(`Arrival METAR: ${b.destMetar}`);
  } else if (f) {
    planLines.push("No SimBrief briefing imported yet — suggest the pilot import one from the Dispatch screen.");
  }

  const system = [
    "You are 'vJetstar Dispatch', the operations/dispatch desk for the vJetstar virtual airline (a Jetstar Airways fan VA for Microsoft Flight Simulator).",
    "Speak like a real airline dispatcher/ops controller on the radio: concise, professional, friendly, use the callsign when you have it. Keep replies short (1-4 sentences) unless the pilot asks for detail.",
    "You are NOT air traffic control — you handle company dispatch: flight plans, fuel, weather, delays, approvals and clearances to push/start.",
    "The dispatch flow the pilot follows: import their SimBrief briefing → request dispatch (you approve) → request clearance (you clear them to push) → push back and fly. If they push back before clearance it's logged as an infraction, so remind them to get cleared first.",
    "If asked how to get dispatch: tell them to open the Dispatch screen, import their SimBrief plan, then use Request dispatch and Request clearance — or just ask you here.",
    "Never invent ATC clearances, squawks or frequencies as if official; keep it to company ops advice.",
    "",
    "Current operational picture:",
    ...planLines,
  ].join("\n");

  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://vjet.pilothub.aabne.net",
        "X-Title": "vJetstar Dispatch",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: "system", content: system }, ...trimmed],
        temperature: 0.6,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      req.log?.warn?.({ status: r.status, detail }, "OpenRouter error");
      res.status(502).json({ error: "Dispatch is unreachable right now. Try again shortly." });
      return;
    }
    const data = await r.json() as any;
    const reply = data?.choices?.[0]?.message?.content?.trim?.() || "Say again?";
    res.json({ reply });
  } catch (e) {
    req.log?.warn?.({ err: e }, "OpenRouter request failed");
    res.status(502).json({ error: "Dispatch is unreachable right now. Try again shortly." });
  }
});

// GET /api/dispatch/voice-status — is the ElevenLabs key configured?
router.get("/dispatch/voice-status", async (req, res): Promise<void> => {
  const user = await requireUser(req, res); if (!user) return;
  res.json({ configured: !!process.env.ELEVENLABS_API_KEY });
});

// GET /api/dispatch/voice-debug — TEMP diagnostic (no secrets): reports whether
// the key is set, whether voices list, and whether a tiny TTS works, with the
// real ElevenLabs error if not.
router.get("/dispatch/voice-debug", async (req, res): Promise<void> => {
  const key = process.env.ELEVENLABS_API_KEY;
  const out: any = { keyPresent: !!key, keyLength: key ? key.length : 0 };
  if (!key) { res.json(out); return; }
  const client = new ElevenLabsClient({ apiKey: key });

  const send = req.query.send === "1";       // actually stream the MP3 back
  const vs = req.query.vs === "1";           // include voiceSettings
  const seed = String(req.query.seed ?? ""); // use the per-pilot picked voice

  let voiceId = FALLBACK_VOICES[0].voice_id;
  try {
    const { voices } = await accountVoices(client);
    voiceId = seed ? pickVoice(voices, seed).voice_id : voices[0].voice_id;
    out.voiceCount = voices.length;
  } catch (e: any) {
    out.voicesError = String(e?.message ?? e);
  }
  out.voiceId = voiceId;

  try {
    const opts: any = { text: "Radio check, reading you five by five.", modelId: "eleven_multilingual_v2", outputFormat: "mp3_44100_128" };
    if (vs) opts.voiceSettings = { stability: 0.45, similarityBoost: 0.8, style: 0.3, useSpeakerBoost: true };
    const stream = await client.textToSpeech.convert(voiceId, opts);
    const buf = await streamToBuffer(stream as unknown as ReadableStream<Uint8Array>);
    if (send) {
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      res.send(buf);
      return;
    }
    out.ttsOk = true;
    out.ttsBytes = buf.length;
  } catch (e: any) {
    out.ttsOk = false;
    out.ttsError = { status: e?.statusCode ?? e?.status, body: e?.body ? (typeof e.body === "string" ? e.body : JSON.stringify(e.body)) : String(e?.message ?? e) };
  }
  res.json(out);
});

// POST /api/dispatch/tts — proxy to the real ElevenLabs API and stream back MP3,
// so dispatch speaks with a natural voice and the API key stays server-side.
router.post("/dispatch/tts", async (req, res): Promise<void> => {
  const user = await requireUser(req, res); if (!user) return;

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    res.status(503).json({ error: "Voice isn't configured — add ELEVENLABS_API_KEY on the server." });
    return;
  }

  const text = String(req.body?.text ?? "").trim().slice(0, 900);
  if (!text) { res.status(400).json({ error: "No text to speak." }); return; }

  const seed = String(req.body?.seed || user.username || "pilot");
  const client = new ElevenLabsClient({ apiKey: key });
  const { voices, error: voicesErr } = await accountVoices(client);
  const chosen = pickVoice(voices, seed);

  try {
    const stream = await client.textToSpeech.convert(chosen.voice_id, {
      text,
      modelId: "eleven_multilingual_v2",
      outputFormat: "mp3_44100_128",
      voiceSettings: { stability: 0.45, similarityBoost: 0.8, style: 0.3, useSpeakerBoost: true },
    });
    const buf = await streamToBuffer(stream as unknown as ReadableStream<Uint8Array>);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Voice-Name", encodeURIComponent(chosen.name));
    res.send(buf);
  } catch (e: any) {
    const status = e?.statusCode ?? e?.status;
    const body = e?.body ? (typeof e.body === "string" ? e.body : JSON.stringify(e.body)) : "";
    const detail = (body || String(e?.message ?? e)).slice(0, 300);
    req.log?.warn?.({ status, detail, voicesErr }, "ElevenLabs TTS error");
    res.status(502).json({
      error: status === 401
        ? "ElevenLabs rejected the API key (check it has Text to Speech permission)."
        : `Voice error${status ? ` (${status})` : ""}.`,
      detail: detail || voicesErr,
    });
  }
});

export default router;
