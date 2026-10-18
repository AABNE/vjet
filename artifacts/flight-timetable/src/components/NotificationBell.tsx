import { useEffect, useRef, useState } from "react";
import { Bell, Radio, ShieldAlert, Info, Plane } from "lucide-react";
import { useNotifications, useMarkAllRead, type HubNotification } from "@/hooks/useNotifications";

const ICONS = {
  dispatch: Radio,
  ops: Plane,
  strike: ShieldAlert,
  info: Info,
} as const;

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationBell() {
  const { data } = useNotifications();
  const markAll = useMarkAllRead();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const unread = data?.unread ?? 0;
  const items: HubNotification[] = data?.notifications ?? [];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) markAll.mutate();
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} data-testid="button-notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition hover:bg-white/20">
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#fb5713] px-1 text-[9px] font-black text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#f3f4f6] px-4 py-3">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-[#6b7280]">Notifications</span>
            {unread > 0 && <span className="rounded-full bg-[#fff7ed] px-2 py-0.5 font-mono text-[9px] font-bold text-[#fb5713]">{unread} new</span>}
          </div>
          <div className="max-h-[22rem] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[#9ca3af]">No notifications yet.</div>
            ) : items.map((n) => {
              const Icon = ICONS[n.kind] ?? Info;
              return (
                <div key={n.id} className={`flex gap-3 border-b border-[#f6f7f8] px-4 py-3 ${n.read ? "" : "bg-[#fff9f5]"}`}>
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${n.kind === "strike" ? "bg-red-50 text-red-600" : "bg-[#fff7ed] text-[#fb5713]"}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#1a1a1a]">{n.title}</div>
                    {n.body && <div className="mt-0.5 text-[11px] leading-snug text-[#6b7280]">{n.body}</div>}
                    <div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-[#c7ccd4]">{timeAgo(n.createdAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
