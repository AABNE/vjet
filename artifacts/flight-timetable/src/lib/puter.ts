// Client-side dispatch brain via Puter.js (keyless, "user-pays" — the pilot may
// see a one-time Puter sign-in popup). Gives us a free LLM for the conversation
// and ElevenLabs voices for the "call", with graceful fallbacks when Puter isn't
// available (e.g. inside the desktop app's Electron shell).
import { apiPost } from "@/lib/api";

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

function puter(): any | null {
  return typeof window !== "undefined" ? (window as any).puter ?? null : null;
}
export function hasPuter(): boolean {
  return !!puter()?.ai;
}

// Default chat model. Puter exposes many; this one is widely available. Easy to swap.
const CHAT_MODEL = "gpt-4o-mini";

// A spread of real ElevenLabs premade voices so each dispatcher sounds different.
export const DISPATCH_VOICES: { id: string; name: string }[] = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam" },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli" },
];

export function randomVoice() {
  return DISPATCH_VOICES[Math.floor(Math.random() * DISPATCH_VOICES.length)];
}

function extractText(res: any): string {
  if (typeof res === "string") return res;
  if (res?.message?.content) {
    const c = res.message.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((p: any) => p?.text ?? "").join(" ").trim();
  }
  if (typeof res?.text === "string") return res.text;
  if (res?.content) return String(res.content);
  return "";
}

// Ask dispatch. Tries Puter first; falls back to the server proxy.
export async function dispatchChat(messages: ChatMsg[]): Promise<string> {
  const p = puter();
  if (p?.ai?.chat) {
    try {
      const res = await p.ai.chat(messages, { model: CHAT_MODEL, temperature: 0.85 });
      const text = extractText(res).trim();
      if (text) return text;
    } catch {
      /* fall through to server */
    }
  }
  // Fallback: server OpenRouter proxy (only the non-system turns are needed).
  const turns = messages.filter((m) => m.role !== "system");
  const { reply } = await apiPost<{ reply: string }>("/api/dispatch/chat", { messages: turns });
  return reply;
}

let currentAudio: HTMLAudioElement | null = null;

export function stopSpeaking() {
  try { currentAudio?.pause(); } catch { /* */ }
  currentAudio = null;
  try { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); } catch { /* */ }
}

// Speak with an ElevenLabs voice via Puter; fall back to the browser's own TTS.
export async function speak(text: string, voiceId?: string): Promise<void> {
  stopSpeaking();
  const p = puter();
  if (p?.ai?.txt2speech) {
    try {
      const audio: HTMLAudioElement = await p.ai.txt2speech(text, {
        provider: "elevenlabs",
        voice: voiceId || DISPATCH_VOICES[0].id,
        model: "eleven_turbo_v2_5",
      });
      currentAudio = audio;
      await audio.play();
      return;
    } catch {
      /* fall through to browser speech */
    }
  }
  try {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.03;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }
  } catch { /* ignore */ }
}
