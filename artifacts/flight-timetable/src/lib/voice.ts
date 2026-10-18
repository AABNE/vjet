// Dispatch voice — real ElevenLabs via our server proxy (/api/dispatch/tts).
// Each pilot gets a consistent, distinct dispatcher voice. Falls back to the
// browser's own speech only if the server voice is unavailable.

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

// Deterministic voice per pilot so each person hears a distinct, consistent
// dispatcher (different voices per person).
export function voiceForUser(username?: string | null) {
  const key = username || "pilot";
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return DISPATCH_VOICES[h % DISPATCH_VOICES.length];
}

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

export function stopSpeaking(): void {
  try { currentAudio?.pause(); } catch { /* */ }
  if (currentUrl) { try { URL.revokeObjectURL(currentUrl); } catch { /* */ } currentUrl = null; }
  currentAudio = null;
  try { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); } catch { /* */ }
}

function browserSpeak(text: string): void {
  try {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.03;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }
  } catch { /* ignore */ }
}

export interface SpeakResult { ok: boolean; reason?: string }

export async function speak(text: string, voiceId: string): Promise<SpeakResult> {
  stopSpeaking();
  try {
    const res = await fetch("/api/dispatch/tts", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceId }),
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      currentUrl = url;
      const audio = new Audio(url);
      currentAudio = audio;
      audio.onended = () => { if (currentUrl === url) { URL.revokeObjectURL(url); currentUrl = null; } };
      await audio.play();
      return { ok: true };
    }
    const d = await res.json().catch(() => ({}));
    browserSpeak(text);
    return { ok: false, reason: (d as any)?.error || "Voice unavailable — using the browser voice." };
  } catch {
    browserSpeak(text);
    return { ok: false, reason: "Voice service unreachable — using the browser voice." };
  }
}
