import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { useProfile } from "@/hooks/useProfile";
import { Avatar } from "@/components/Avatar";
import { apiPost } from "@/lib/api";
import { Check, Loader2, MessageCircle, Trash2 } from "lucide-react";

export default function Personalisation() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const profile = useProfile();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const current = profile.data?.avatarUrl ?? null;

  async function save(action: "url" | "discord" | "clear") {
    setErr(""); setBusy(action);
    try {
      if (action === "discord") await apiPost("/api/pilot/avatar/discord");
      else await apiPost("/api/pilot/avatar", { url: action === "clear" ? "" : url.trim() });
      await profile.refetch();
      qc.invalidateQueries({ queryKey: ["profile"] });
      if (action === "url") setUrl("");
    } catch (e: any) { setErr(e?.message || "Could not update your picture."); }
    finally { setBusy(null); }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Your profile</p>
        <h1 className="mt-2 text-5xl font-black uppercase leading-none tracking-tight text-[#1a1a1a] md:text-6xl">Personalisation</h1>
        <p className="mt-3 text-sm text-[#6b7280]">Set your profile picture — it shows in the header and across the hub.</p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
        <div className="flex items-center gap-4 border-b border-[#f3f4f6] px-6 py-5">
          <Avatar url={current} name={user?.username} size={64} />
          <div>
            <h2 className="font-bold uppercase tracking-tight text-[#1a1a1a]">Profile picture</h2>
            <p className="text-xs text-[#6b7280]">{current ? "This is your current picture." : "You're using your initial — add a picture below."}</p>
          </div>
        </div>
        <div className="space-y-5 p-6">
          <div>
            <button onClick={() => save("discord")} disabled={!profile.data?.discordLinked || busy !== null}
              className="flex items-center gap-2 rounded-xl bg-[#5865F2] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#4752c4] disabled:opacity-50">
              {busy === "discord" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />} Use my Discord picture
            </button>
            {!profile.data?.discordLinked && <p className="mt-1.5 text-[11px] text-[#9ca3af]">Link your Discord in Settings to use your Discord avatar.</p>}
          </div>

          <div className="border-t border-[#f3f4f6] pt-5">
            <label className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[.16em] text-[#6b7280]">…or paste an image URL</label>
            <div className="flex flex-wrap gap-2">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/me.png"
                className="h-11 flex-1 rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-4 text-sm outline-none transition focus:border-[#fb5713] focus:ring-2 focus:ring-[#fb5713]/20 md:max-w-md" />
              <button onClick={() => save("url")} disabled={busy !== null || !url.trim()}
                className="flex h-11 items-center gap-2 rounded-xl bg-[#fb5713] px-5 text-sm font-bold text-white transition hover:bg-[#e04d0e] disabled:opacity-50">
                {busy === "url" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Set picture
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-[#9ca3af]">Must be an https image link (e.g. from Discord, imgur, or your own host).</p>
          </div>

          {current && (
            <button onClick={() => save("clear")} disabled={busy !== null}
              className="flex items-center gap-2 rounded-xl border border-[#e5e7eb] px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#6b7280] transition hover:border-red-200 hover:text-red-600 disabled:opacity-50">
              {busy === "clear" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Remove picture
            </button>
          )}
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      </section>
    </div>
  );
}
