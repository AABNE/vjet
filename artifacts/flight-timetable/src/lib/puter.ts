// Client-side dispatch LLM via Puter.js (keyless), with the server OpenRouter
// proxy as a fallback. Voice is handled separately in lib/voice.ts (ElevenLabs).
import { apiPost } from "@/lib/api";

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

function puter(): any | null {
  return typeof window !== "undefined" ? (window as any).puter ?? null : null;
}
export function hasPuter(): boolean {
  return !!puter()?.ai;
}

// Default chat model. Puter exposes many; this one is widely available.
const CHAT_MODEL = "gpt-4o-mini";

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
  const turns = messages.filter((m) => m.role !== "system");
  const { reply } = await apiPost<{ reply: string }>("/api/dispatch/chat", { messages: turns });
  return reply;
}
