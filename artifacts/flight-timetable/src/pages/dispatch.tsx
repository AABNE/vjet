import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import {
  Radio, Send, Phone, PhoneOff, Mic, DownloadCloud, CheckCircle2, ShieldAlert,
  Plane, MapPin, Fuel, Cloud, Route as RouteIcon, Loader2,
} from "lucide-react";

const ORANGE = "#fb5713";

interface Briefing {
  flightNumber?: string; route?: string; initialAltitude?: string; routeDistanceNm?: number;
  costIndex?: string; fuelRamp?: number; fuelBurn?: number; fuelUnits?: string;
  origMetar?: string; destMetar?: string; aircraftRaw?: string;
}
interface DispatchEntry {
  id: number; status: string; dispatchStatus: string; pushbackViolation: boolean;
  briefing: Briefing | null;
  flight: { flightNumber: string; departure: string; arrival: string; aircraft: string; departureTime: string; flightDate: string; durationMinutes: number };
}
interface DispatchState { ban: { banned: boolean; until: string | null }; entry: DispatchEntry | null; }
interface PilotRecord { periodKey: string; infractions: number; strikes: number; banLevel: number; ban: { banned: boolean; until: string | null }; history: { type: string; reason: string; createdAt: string }[]; }

type Msg = { role: "user" | "assistant"; content: string };

const GREETING =
  "vJetstar Dispatch, go ahead. Import your SimBrief plan and I'll send your briefing, then hit Request dispatch and Request clearance before you push — or just ask me here.";

function pickVoice(): SpeechSynthesisVoice | null {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  if (voices.length === 0) return null;
  const score = (v: SpeechSynthesisVoice) => {
    const n = v.name.toLowerCase();
    if (n.includes("natural")) return 5;       // Windows 11 neural voices
    if (n.includes("google")) return 4;        // Chrome's cloud voices
    if (n.includes("aria") || n.includes("guy") || n.includes("libby")) return 3;
    if (v.lang.toLowerCase() === "en-au") return 2;
    return 1;
  };
  return voices.sort((a, b) => score(b) - score(a))[0] ?? null;
}

export default function Dispatch() {
  const qc = useQueryClient();
  const state = useQuery<DispatchState>({ queryKey: ["dispatch-state"], queryFn: () => apiGet("/api/dispatch/state"), refetchInterval: 15_000, retry: false });
  const record = useQuery<PilotRecord>({ queryKey: ["pilot-record"], queryFn: () => apiGet("/api/pilot/record"), refetchInterval: 30_000, retry: false });

  const entry = state.data?.entry ?? null;
  const ban = state.data?.ban;

  const [mode, setMode] = useState<"text" | "call">("text");
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState("");

  const scroller = useRef<HTMLDivElement | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const [listening, setListening] = useState(false);
  const [callNote, setCallNote] = useState("");
  const recog = useRef<any>(null);

  const speechOk = typeof window !== "undefined" && "speechSynthesis" in window;
  const recogOk = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  useEffect(() => {
    if (!speechOk) return;
    const set = () => { voiceRef.current = pickVoice(); };
    set();
    window.speechSynthesis.onvoiceschanged = set;
    return () => { try { window.speechSynthesis.onvoiceschanged = null; window.speechSynthesis.cancel(); } catch { /* */ } };
  }, [speechOk]);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [messages, sending]);

  function speak(text: string) {
    if (!speechOk) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (voiceRef.current) u.voice = voiceRef.current;
      u.rate = 1.05; u.pitch = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || sending) return;
    const next: Msg[] = [...messages, { role: "user", content: clean }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const { reply } = await apiPost<{ reply: string }>("/api/dispatch/chat", { messages: next });
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      if (mode === "call") speak(reply);
    } catch (e: any) {
      const msg = e?.message || "Dispatch is unreachable right now.";
      setMessages((m) => [...m, { role: "assistant", content: `(${msg})` }]);
    } finally {
      setSending(false);
    }
  }

  function talk() {
    if (!recogOk) { setCallNote("Voice input isn't available here — type below and I'll still reply out loud."); return; }
    try {
      const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const r = new SR();
      r.lang = "en-AU"; r.interimResults = false; r.maxAlternatives = 1;
      r.onresult = (e: any) => { const t = e.results[0][0].transcript; setCallNote(""); send(t); };
      r.onerror = () => { setListening(false); setCallNote("Didn't catch that — try again or type."); };
      r.onend = () => setListening(false);
      recog.current = r;
      r.start();
      setListening(true);
      setCallNote("Listening…");
    } catch {
      setCallNote("Couldn't start the mic — type instead.");
      setListening(false);
    }
  }
  function stopTalk() { try { recog.current?.stop(); } catch { /* */ } setListening(false); }

  async function act(path: string, okMsg: string) {
    if (!entry) return;
    setActionErr("");
    setBusy(path);
    try {
      await apiPost(`/api/dispatch/${entry.id}/${path}`);
      await Promise.all([state.refetch(), qc.invalidateQueries({ queryKey: ["notifications"] })]);
      setMessages((m) => [...m, { role: "assistant", content: okMsg }]);
      if (mode === "call") speak(okMsg);
    } catch (e: any) {
      setActionErr(e?.message || "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  const ds = entry?.dispatchStatus ?? "none";
  const hasBriefing = !!entry?.briefing;
  const step = ds === "cleared" ? 3 : ds === "approved" || ds === "requested" ? 2 : hasBriefing ? 1 : 0;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Operations · ground</p>
        <h1 className="mt-2 text-5xl font-black uppercase leading-none tracking-tight text-[#1a1a1a] md:text-6xl">Dispatch</h1>
        <p className="mt-3 max-w-2xl text-sm text-[#6b7280]">
          Your company ops desk. Import your SimBrief plan to get a briefing, then <b>request dispatch</b> and <b>request clearance</b> before you push back. Push before you're cleared and it's logged as an infraction. Talk to dispatch by text or call.
        </p>
      </div>

      {ban?.banned && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="banner-grounded">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <span>You're grounded until <b>{new Date(ban.until!).toLocaleString()}</b>. New flights are locked while suspended.</span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Chat / call */}
        <div className="flex flex-col overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white" style={{ height: 560 }}>
          <div className="flex items-center justify-between border-b border-[#f3f4f6] bg-[#1a1a1a] px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" /></span>
              <span className="font-mono text-[11px] font-bold uppercase tracking-widest">vJetstar Dispatch</span>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-white/10 p-0.5">
              <button onClick={() => setMode("text")} className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition ${mode === "text" ? "bg-white text-[#1a1a1a]" : "text-white/70"}`}>Text</button>
              <button onClick={() => setMode("call")} className={`flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition ${mode === "call" ? "bg-[#fb5713] text-white" : "text-white/70"}`}><Phone className="h-3 w-3" />Call</button>
            </div>
          </div>

          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto bg-[#f9fafb] p-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.role === "user" ? "bg-[#1a1a1a] text-white" : "border border-[#e5e7eb] bg-white text-[#1a1a1a]"}`}>
                  {m.role === "assistant" && <div className="mb-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-[#fb5713]">Dispatch</div>}
                  {m.content}
                </div>
              </div>
            ))}
            {sending && <div className="flex justify-start"><div className="flex items-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white px-3.5 py-2 text-sm text-[#9ca3af]"><Loader2 className="h-3.5 w-3.5 animate-spin" />Dispatch is responding…</div></div>}
          </div>

          {mode === "call" ? (
            <div className="flex flex-col items-center gap-2 border-t border-[#f3f4f6] bg-white px-4 py-4">
              <button
                onMouseDown={talk} onMouseUp={stopTalk} onTouchStart={talk} onTouchEnd={stopTalk}
                disabled={sending}
                className={`flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg transition disabled:opacity-50 ${listening ? "scale-110 bg-red-500" : "bg-[#fb5713] hover:bg-[#e04d0e]"}`}
                data-testid="button-push-to-talk">
                {listening ? <PhoneOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
              </button>
              <div className="text-center text-[11px] text-[#9ca3af]">
                {callNote || (recogOk ? "Hold to talk — release to send. Dispatch replies out loud." : "Hold-to-talk needs Chrome mic support; type below instead.")}
              </div>
              <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex w-full items-center gap-2">
                <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="…or type to dispatch"
                  className="h-10 flex-1 rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm outline-none focus:border-[#fb5713]" />
                <button type="submit" disabled={sending || !input.trim()} className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1a1a1a] text-white disabled:opacity-40"><Send className="h-4 w-4" /></button>
              </form>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-center gap-2 border-t border-[#f3f4f6] bg-white px-4 py-3">
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message dispatch…" data-testid="input-dispatch-message"
                className="h-11 flex-1 rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3.5 text-sm outline-none focus:border-[#fb5713]" />
              <button type="submit" disabled={sending || !input.trim()} className="flex h-11 items-center gap-2 rounded-xl bg-[#fb5713] px-4 text-sm font-bold text-white transition hover:bg-[#e04d0e] disabled:opacity-40">
                <Send className="h-4 w-4" />Send
              </button>
            </form>
          )}
        </div>

        {/* Right rail: flight plan + actions + record */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-[#e5e7eb] bg-white p-5">
            <div className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[.18em] text-[#9ca3af]"><Plane className="h-3.5 w-3.5 text-[#fb5713]" />Flight plan</div>
            {entry ? (
              <>
                <div className="mt-3 flex items-baseline justify-between">
                  <span className="font-mono text-sm font-bold text-[#fb5713]">{entry.flight.flightNumber}</span>
                  <span className="font-mono text-[10px] text-[#9ca3af]">{entry.flight.aircraft}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-2xl font-black uppercase tracking-tight text-[#1a1a1a]">
                  {entry.flight.departure}<MapPin className="h-4 w-4 text-[#e5e7eb]" />{entry.flight.arrival}
                </div>
                {/* progress */}
                <div className="mt-4 flex items-center gap-1">
                  {["Briefing", "Approved", "Cleared"].map((lab, i) => (
                    <div key={lab} className="flex-1">
                      <div className={`h-1.5 rounded-full ${step >= i + 1 ? "bg-[#fb5713]" : "bg-[#e5e7eb]"}`} />
                      <div className={`mt-1 text-center font-mono text-[8px] font-bold uppercase tracking-wider ${step >= i + 1 ? "text-[#fb5713]" : "text-[#c7ccd4]"}`}>{lab}</div>
                    </div>
                  ))}
                </div>
                {entry.briefing && (
                  <div className="mt-4 space-y-1.5 border-t border-[#f3f4f6] pt-3 text-[11px] text-[#6b7280]">
                    {entry.briefing.route && <div className="flex gap-1.5"><RouteIcon className="h-3.5 w-3.5 shrink-0 text-[#9ca3af]" /><span className="font-mono leading-snug">{entry.briefing.route}</span></div>}
                    {entry.briefing.initialAltitude && <div>Initial alt: <b className="text-[#1a1a1a]">{entry.briefing.initialAltitude}</b></div>}
                    {typeof entry.briefing.fuelRamp === "number" && <div className="flex items-center gap-1.5"><Fuel className="h-3.5 w-3.5 text-[#9ca3af]" />Ramp fuel: <b className="text-[#1a1a1a]">{entry.briefing.fuelRamp} {entry.briefing.fuelUnits}</b></div>}
                    {entry.briefing.origMetar && <div className="flex gap-1.5"><Cloud className="h-3.5 w-3.5 shrink-0 text-[#9ca3af]" /><span className="font-mono leading-snug">{entry.briefing.origMetar}</span></div>}
                  </div>
                )}
                {actionErr && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{actionErr}</div>}
                <div className="mt-4 space-y-2">
                  <button onClick={() => act("import-briefing", "Briefing sent — check your flight plan on the right.")} disabled={!!busy}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#fb5713] bg-[#fff7ed] px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[#fb5713] transition hover:bg-[#ffeadf] disabled:opacity-50">
                    {busy === "import-briefing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />}{hasBriefing ? "Re-import briefing" : "Import SimBrief briefing"}
                  </button>
                  <button onClick={() => act("request", "Dispatch approved. Request clearance when you're ready to push.")} disabled={!!busy || ban?.banned || ds === "approved" || ds === "cleared"}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1a1a1a] px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white transition disabled:opacity-40">
                    {busy === "request" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{ds === "approved" || ds === "cleared" ? "Dispatch approved" : "Request dispatch"}
                  </button>
                  <button onClick={() => act("clearance", "Cleared to push and start. Safe flight.")} disabled={!!busy || (ds !== "approved" && ds !== "cleared") || ds === "cleared"}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white transition disabled:opacity-40">
                    {busy === "clearance" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}{ds === "cleared" ? "Cleared" : "Request clearance"}
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-[#6b7280]">No active or upcoming sector. Pick up a flight from <span className="font-bold text-[#fb5713]">Available routes</span> first.</p>
            )}
          </div>

          {/* Pilot record */}
          <div className="rounded-2xl border border-[#e5e7eb] bg-white p-5">
            <div className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[.18em] text-[#9ca3af]"><ShieldAlert className="h-3.5 w-3.5 text-[#fb5713]" />Your record · this month</div>
            {record.data ? (
              <>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-[#f9fafb] py-2"><div className="text-xl font-black text-[#1a1a1a]">{record.data.infractions}<span className="text-xs text-[#9ca3af]">/3</span></div><div className="font-mono text-[8px] uppercase tracking-wider text-[#9ca3af]">Infractions</div></div>
                  <div className="rounded-xl bg-[#f9fafb] py-2"><div className="text-xl font-black text-[#1a1a1a]">{record.data.strikes}<span className="text-xs text-[#9ca3af]">/3</span></div><div className="font-mono text-[8px] uppercase tracking-wider text-[#9ca3af]">Strikes</div></div>
                  <div className="rounded-xl bg-[#f9fafb] py-2"><div className={`text-xl font-black ${record.data.ban.banned ? "text-red-600" : "text-[#1a1a1a]"}`}>{record.data.ban.banned ? "ON" : "—"}</div><div className="font-mono text-[8px] uppercase tracking-wider text-[#9ca3af]">Ban</div></div>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-[#9ca3af]">3 infractions = 1 strike. 3 strikes = a ban (1h, then doubling). Resets at month start.</p>
                {record.data.history.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-[#f3f4f6] pt-3">
                    {record.data.history.slice(-4).reverse().map((h, i) => (
                      <div key={i} className="text-[11px] text-[#6b7280]"><span className="text-[#9ca3af]">{new Date(h.createdAt).toLocaleDateString()}</span> — {h.reason}</div>
                    ))}
                  </div>
                )}
              </>
            ) : <p className="mt-3 text-sm text-[#6b7280]">Clean record.</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
