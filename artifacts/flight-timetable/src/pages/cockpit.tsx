import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useAuth } from "@/components/auth-provider";
import { Avatar } from "@/components/Avatar";
import { apiGet, apiPost } from "@/lib/api";
import { dispatchChat } from "@/lib/puter";
import { VoiceManager } from "@/lib/cockpitVoice";
import { Mic, MicOff, Send, Plane, Users, LinkIcon, Loader2, LogOut, Volume2 } from "lucide-react";

interface ChatMsgRow { userId: number; username: string; text: string; at: number }
interface Participant { userId: number; username: string; avatarUrl: string | null; role: string; hasHub: boolean }
interface Flight { flightNumber: string; departure: string; arrival: string; aircraft: string; registration: string | null; departureTime: string; flightDate: string; timetableId: number; flightId: number }
interface State { code: string; hostUserId: number; flight: Flight; participants: Participant[]; you?: number; isHost?: boolean; joined?: boolean }
interface Msg { role: "user" | "assistant"; content: string }

const ROLE_LABEL: Record<string, string> = { pilot_flying: "Pilot Flying", pilot_monitoring: "Pilot Monitoring", flap_operator: "Flap Operator" };
const ROLE_STYLE: Record<string, string> = { pilot_flying: "bg-[#fb5713] text-white", pilot_monitoring: "bg-sky-100 text-sky-700", flap_operator: "bg-amber-100 text-amber-700" };
const ROLE_ORDER = ["pilot_flying", "pilot_monitoring", "flap_operator"];

export default function Cockpit() {
  const params = useParams();
  const code = (params.code || "").toUpperCase();
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const [state, setState] = useState<State | null>(null);
  const [chat, setChat] = useState<ChatMsgRow[]>([]);
  const [error, setError] = useState("");
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceLive, setVoiceLive] = useState(false);
  const [muted, setMuted] = useState(false);

  const voiceRef = useRef<VoiceManager | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const leftRef = useRef(false);

  const sendSignal = useCallback((to: number, data: unknown) => {
    apiPost(`/api/cockpit/${code}/signal`, { to, data }).catch(() => {});
  }, [code]);

  // Join + open the live stream.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s: State = await apiGet(`/api/cockpit/${code}`);
        if (!s.joined) await apiPost(`/api/cockpit/${code}/join`);
        if (cancelled) return;
        const fresh: State = await apiGet(`/api/cockpit/${code}`);
        setState(fresh);
        openStream(fresh.you ?? 0);
      } catch (e: any) { if (!cancelled) setError(e?.message || "Couldn't join the cockpit."); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  function openStream(myId: number) {
    const es = new EventSource(`/api/cockpit/${code}/stream`);
    esRef.current = es;
    es.addEventListener("state", (ev: MessageEvent) => {
      try {
        const s = JSON.parse(ev.data);
        setState((prev) => ({ ...(prev as State), ...s, you: prev?.you ?? myId, isHost: s.hostUserId === (prev?.you ?? myId) }));
        voiceRef.current?.syncPeers((s.participants as Participant[]).map((p) => p.userId)).catch(() => {});
      } catch { /* */ }
    });
    es.addEventListener("signal", (ev: MessageEvent) => {
      try { const { from, data } = JSON.parse(ev.data); voiceRef.current?.onSignal(from, data).catch(() => {}); } catch { /* */ }
    });
    es.addEventListener("peer-left", (ev: MessageEvent) => {
      try { const { userId } = JSON.parse(ev.data); voiceRef.current?.removePeer(userId); } catch { /* */ }
    });
    es.addEventListener("chat-history", (ev: MessageEvent) => { try { setChat(JSON.parse(ev.data)); } catch { /* */ } });
    es.addEventListener("chat", (ev: MessageEvent) => { try { const m = JSON.parse(ev.data); setChat((c) => [...c, m]); } catch { /* */ } });
    es.addEventListener("ended", () => { setError("The host ended this shared cockpit."); cleanup(false); });
  }

  // Warn before leaving the tab; leave the session on unmount.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "Leaving this page will leave the shared flight."; return e.returnValue; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => { window.removeEventListener("beforeunload", onBeforeUnload); cleanup(true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanup(sendLeave: boolean) {
    if (leftRef.current) return; leftRef.current = true;
    try { esRef.current?.close(); } catch { /* */ }
    voiceRef.current?.stop();
    if (sendLeave) apiPost(`/api/cockpit/${code}/leave`).catch(() => {});
  }

  async function enableVoice() {
    const myId = state?.you ?? 0;
    const vm = new VoiceManager(myId, sendSignal, (c) => setVoiceLive(c));
    const ok = await vm.start();
    if (!ok) { setError("Couldn't access your microphone — check the browser permission."); return; }
    voiceRef.current = vm; setVoiceOn(true);
    await vm.syncPeers((state?.participants ?? []).map((p) => p.userId));
  }
  function toggleMute() { const m = !muted; setMuted(m); voiceRef.current?.setMuted(m); }

  async function setRole(targetUserId: number, role: string) {
    await apiPost(`/api/cockpit/${code}/role`, { targetUserId, role }).catch((e: any) => setError(e?.message || "Couldn't change role."));
  }

  function leaveNow() { cleanup(true); navigate("/timetable"); }

  if (error && !state) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-[#e5e7eb] bg-white p-10 text-center">
        <p className="text-sm text-[#6b7280]">{error}</p>
        <Link href="/timetable" className="mt-4 inline-block rounded-xl bg-[#fb5713] px-4 py-2 text-sm font-bold text-white">Back to timetable</Link>
      </div>
    );
  }
  if (!state) return <div className="mx-auto max-w-lg p-10 text-center text-sm text-[#9ca3af]"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>;

  const me = state.participants.find((p) => p.userId === state.you);
  const isHost = state.hostUserId === state.you;
  const f = state.flight;
  const anyHub = state.participants.some((p) => p.hasHub);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Shared cockpit</p>
          <h1 className="mt-2 text-4xl font-black uppercase leading-none tracking-tight text-[#1a1a1a] md:text-5xl">{f.departure} → {f.arrival}</h1>
          <p className="mt-2 text-sm text-[#6b7280]">{f.flightNumber} · {f.aircraft}{f.registration ? ` · ${f.registration}` : ""} · {f.departureTime}Z {f.flightDate}</p>
        </div>
        <button onClick={leaveNow} className="flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-red-600 transition hover:bg-red-50">
          <LogOut className="h-4 w-4" />Leave flight
        </button>
      </div>

      {error && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">{error}</div>}
      {!anyHub && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">Nobody in this cockpit has the pilot hub connected — at least one of you needs Sim Link + MSFS running to actually fly it.</div>}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* Left: crew + voice + invite */}
        <div className="space-y-5">
          <section className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
            <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[.2em] text-[#6b7280]"><Users className="h-4 w-4 text-[#fb5713]" />Crew</h2>
            <div className="space-y-2">
              {state.participants.map((p) => (
                <div key={p.userId} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#f3f4f6] bg-[#f9fafb] px-3 py-2.5">
                  <Avatar url={p.avatarUrl} name={p.username} size={36} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-bold text-[#1a1a1a]">{p.username}{p.userId === state.hostUserId && <span className="font-mono text-[9px] uppercase tracking-wider text-[#9ca3af]">host</span>}</div>
                    <div className="font-mono text-[9px] uppercase tracking-wider text-[#9ca3af]">{p.hasHub ? "hub connected" : "no hub"}</div>
                  </div>
                  <span className={`ml-auto rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ${ROLE_STYLE[p.role] ?? "bg-[#f3f4f6] text-[#6b7280]"}`}>{ROLE_LABEL[p.role] ?? p.role}</span>
                  {isHost && (
                    <select value={p.role} onChange={(e) => setRole(p.userId, e.target.value)}
                      className="rounded-lg border border-[#e5e7eb] bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#6b7280] outline-none">
                      {ROLE_ORDER.filter((r) => r !== "flap_operator" || p.role === "flap_operator").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  )}
                </div>
              ))}
            </div>
            {isHost && <p className="mt-2 text-[11px] text-[#9ca3af]">You started the flight, so you assign who's Pilot Flying, Pilot Monitoring, and who's on flaps.</p>}
          </section>

          {/* Voice */}
          <section className="rounded-2xl border border-[#1a1a1a] bg-[#1a1a1a] p-4 text-white">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-[#fb5713]" />
              <span className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-white/70">Cockpit voice</span>
              {voiceOn && <span className={`ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider ${voiceLive ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/50"}`}><span className={`h-1.5 w-1.5 rounded-full ${voiceLive ? "animate-ping bg-emerald-400" : "bg-white/40"}`} />{voiceLive ? "Connected" : "Connecting…"}</span>}
            </div>
            <div className="mt-3 flex items-center gap-2">
              {!voiceOn ? (
                <button onClick={enableVoice} className="flex items-center gap-2 rounded-xl bg-[#fb5713] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#e04d0e]"><Mic className="h-4 w-4" />Join voice</button>
              ) : (
                <button onClick={toggleMute} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition ${muted ? "bg-red-500 hover:bg-red-600" : "bg-white/10 hover:bg-white/20"}`}>{muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}{muted ? "Unmute" : "Mute"}</button>
              )}
              <span className="text-[11px] text-white/50">Always-on — just talk to your {me?.role === "flap_operator" ? "captain" : "flap operator"}.</span>
            </div>
          </section>

          {isHost && <InvitePanel code={code} />}

          <CrewChat code={code} chat={chat} myId={state.you ?? 0} participants={state.participants} />
        </div>

        {/* Right: dispatch chat */}
        <DispatchChat flight={f} />
      </div>
    </div>
  );
}

function InvitePanel({ code }: { code: string }) {
  const [username, setUsername] = useState("");
  const [note, setNote] = useState("");
  const link = typeof window !== "undefined" ? `${window.location.origin}/cockpit/${code}` : `/cockpit/${code}`;
  async function invite() {
    setNote("");
    try { await apiPost(`/api/cockpit/${code}/invite`, { username: username.trim() }); setNote(`Invited ${username.trim()}.`); setUsername(""); }
    catch (e: any) { setNote(e?.message || "Couldn't send the invite."); }
  }
  return (
    <section className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
      <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[.2em] text-[#6b7280]"><LinkIcon className="h-4 w-4 text-[#fb5713]" />Invite a pilot</h2>
      <div className="flex flex-wrap gap-2">
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Their username"
          className="h-10 flex-1 rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm outline-none focus:border-[#fb5713] md:max-w-[180px]" />
        <button onClick={invite} disabled={!username.trim()} className="h-10 rounded-xl bg-[#fb5713] px-4 text-xs font-bold uppercase tracking-wider text-white disabled:opacity-50">Invite</button>
      </div>
      <button onClick={() => { navigator.clipboard?.writeText(link).then(() => setNote("Link copied!")).catch(() => {}); }}
        className="mt-2 w-full truncate rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2 text-left text-[11px] text-[#6b7280] hover:bg-[#f3f4f6]">Copy invite link: {link}</button>
      {note && <p className="mt-2 text-[11px] text-[#6b7280]">{note}</p>}
    </section>
  );
}

function DispatchChat({ flight }: { flight: Flight }) {
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: `Dispatch here — you're set up for ${flight.flightNumber} ${flight.departure}→${flight.arrival}. Shout if you need anything.` }]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [messages, sending]);

  async function send() {
    const clean = input.trim(); if (!clean || sending) return;
    const next: Msg[] = [...messages, { role: "user", content: clean }];
    setMessages(next); setInput(""); setSending(true);
    try {
      const system = `You are vJetstar Dispatch helping a shared-cockpit crew on ${flight.flightNumber} ${flight.departure}→${flight.arrival} (${flight.aircraft}). Keep it short and on company ops only.`;
      const reply = await dispatchChat([{ role: "system", content: system }, ...next.slice(-12)]);
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (e: any) { setMessages((m) => [...m, { role: "assistant", content: `(dispatch unreachable — ${e?.message || "try again"})` }]); }
    finally { setSending(false); }
  }

  return (
    <aside className="flex h-[520px] flex-col overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
      <div className="flex items-center gap-2 border-b border-[#f3f4f6] bg-[#1a1a1a] px-4 py-3 text-white">
        <Plane className="h-4 w-4 text-[#fb5713]" /><span className="font-mono text-[11px] font-bold uppercase tracking-widest">Dispatch</span>
      </div>
      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto bg-[#f9fafb] p-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${m.role === "user" ? "bg-[#1a1a1a] text-white" : "border border-[#e5e7eb] bg-white text-[#1a1a1a]"}`}>{m.content}</div>
          </div>
        ))}
        {sending && <div className="flex justify-start"><div className="rounded-2xl border border-[#e5e7eb] bg-white px-3 py-2 text-sm text-[#9ca3af]">Dispatch is on it…</div></div>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2 border-t border-[#f3f4f6] bg-white px-3 py-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message dispatch…" className="h-10 flex-1 rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm outline-none focus:border-[#fb5713]" />
        <button type="submit" disabled={sending || !input.trim()} className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fb5713] text-white disabled:opacity-40"><Send className="h-4 w-4" /></button>
      </form>
    </aside>
  );
}

// Render plain text with clickable links (flight plans, software links, etc.).
function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((p, i) =>
    /^https?:\/\//.test(p)
      ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="break-all underline">{p}</a>
      : <span key={i}>{p}</span>);
}

function CrewChat({ code, chat, myId, participants }: { code: string; chat: ChatMsgRow[]; myId: number; participants: Participant[] }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [chat]);
  const avatarOf = (uid: number) => participants.find((p) => p.userId === uid)?.avatarUrl ?? null;
  async function send() {
    const t = input.trim(); if (!t || busy) return;
    setBusy(true); setInput("");
    try { await apiPost(`/api/cockpit/${code}/chat`, { text: t }); } catch { /* */ } finally { setBusy(false); }
  }
  return (
    <section className="flex h-[340px] flex-col overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
      <h2 className="flex items-center gap-2 border-b border-[#f3f4f6] px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[.2em] text-[#6b7280]"><Users className="h-4 w-4 text-[#fb5713]" />Crew chat</h2>
      <div ref={scroller} className="flex-1 space-y-2.5 overflow-y-auto bg-[#f9fafb] p-3">
        {chat.length === 0 && <p className="px-2 py-6 text-center text-[11px] text-[#9ca3af]">Send flight plans, SimBrief or software links, anything — just between the crew.</p>}
        {chat.map((m, i) => (
          <div key={i} className={`flex items-end gap-2 ${m.userId === myId ? "flex-row-reverse" : ""}`}>
            <Avatar url={avatarOf(m.userId)} name={m.username} size={24} />
            <div className={`max-w-[82%] rounded-2xl px-3 py-1.5 text-sm leading-snug ${m.userId === myId ? "bg-[#1a1a1a] text-white" : "border border-[#e5e7eb] bg-white text-[#1a1a1a]"}`}>
              <div className={`font-mono text-[8px] uppercase tracking-wider ${m.userId === myId ? "text-white/50" : "text-[#9ca3af]"}`}>{m.username}</div>
              <div className="break-words">{linkify(m.text)}</div>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2 border-t border-[#f3f4f6] bg-white px-3 py-2.5">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message your crew…" className="h-10 flex-1 rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm outline-none focus:border-[#fb5713]" />
        <button type="submit" disabled={busy || !input.trim()} className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fb5713] text-white disabled:opacity-40"><Send className="h-4 w-4" /></button>
      </form>
    </section>
  );
}
