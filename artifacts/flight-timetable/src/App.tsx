import { Switch, Route, Router as WouterRouter, useLocation, Link } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/components/auth-provider";
import { useLogout, getGetMeQueryKey } from "@workspace/api-client-react";
import { CalendarDays, Plane, ClipboardList, Settings2, ShieldCheck, LogOut, Download, KeyRound, Check, ArrowRight, X, Radar, Palette, Radio, FileText, Gauge, Bot, Wrench, PanelLeft, Sparkles, ChevronDown } from "lucide-react";
import { VJetstarLogo } from "@/components/VJetstarLogo";
import { Avatar } from "@/components/Avatar";
import { useProfile } from "@/hooks/useProfile";
import { useEffect, useState, useRef } from "react";
import { useIsDesktopApp } from "@/hooks/useSimLink";
import { AutoFlightTimer } from "@/components/AutoFlightTimer";
import { NotificationBell } from "@/components/NotificationBell";
import Login from "@/pages/login";
import Timetable from "@/pages/timetable";
import Flights from "@/pages/flights";
import Logs from "@/pages/logs";
import Admin from "@/pages/admin";
import Settings from "@/pages/settings";
import Liveries from "@/pages/liveries";
import Software from "@/pages/software";
import LiveMap from "@/pages/live-map";
import Dispatch from "@/pages/dispatch";
import Paperwork from "@/pages/paperwork";
import OpsDashboard from "@/pages/ops-dashboard";
import ControlRoom from "@/pages/control-room";
import MaintenanceOps from "@/pages/maintenance-ops";
import AiModels from "@/pages/ai-models";
import Fleet from "@/pages/fleet";
import Personalisation from "@/pages/personalisation";
import Cockpit from "@/pages/cockpit";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 15_000 } } });

const navItems = [
  { href: "/timetable",  label: "My timetable",     icon: CalendarDays },
  { href: "/flights",    label: "Available routes",  icon: Plane },
  { href: "/dispatch",   label: "Dispatch",          icon: Radio },
  { href: "/paperwork",  label: "My paperwork",      icon: FileText },
  { href: "/liveries",   label: "Liveries",          icon: Palette },
];

// These live under the profile menu (top-right), not the sidebar.
const profileMenu = [
  { href: "/settings",        label: "Settings",        icon: Settings2 },
  { href: "/logs",            label: "Flight records",  icon: ClipboardList },
  { href: "/personalisation", label: "Personalisation", icon: Sparkles },
];

// Only shown when the hub runs inside the vJetstar Sim Link desktop app.
const appOnlyNavItems = [
  { href: "/live-map", label: "Live map", icon: Radar },
];

// Only shown on the website (not inside the desktop app — you're already in it).
const webOnlyNavItems = [
  { href: "/software", label: "Software", icon: Download },
];

function JetstarStar({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <polygon points="50,5 61,35 95,35 68,57 79,91 50,70 21,91 32,57 5,35 39,35" fill="currentColor" />
    </svg>
  );
}

// ─── Force-password-change modal ───────────────────────────────────────────
function ForcePasswordModal({ onDone }: { onDone: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("Vjet1234");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const qc = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (newPassword === "Vjet1234") { setError("Please choose a different password than the default."); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match."); return; }
    setPending(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to change password.");
      } else {
        // Refresh user state so mustChangePassword is false
        await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        onDone();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="bg-[#fb5713] px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <KeyRound className="h-6 w-6" />
            <div>
              <h2 className="font-black uppercase tracking-tight">Change your password</h2>
              <p className="mt-0.5 text-xs text-white/80">You're using the default password — set a new one to continue.</p>
            </div>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div>
            <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[.16em] text-[#6b7280]">Current password</label>
            <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required
              className="h-10 w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm outline-none focus:border-[#fb5713]" />
            <p className="mt-1 text-[10px] text-[#9ca3af]">Pre-filled with the default: Vjet1234</p>
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[.16em] text-[#6b7280]">New password</label>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={8}
              className="h-10 w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm outline-none focus:border-[#fb5713]" />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[.16em] text-[#6b7280]">Confirm new password</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8}
              className="h-10 w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm outline-none focus:border-[#fb5713]" />
          </div>
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          )}
          <button type="submit" disabled={pending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#fb5713] py-3 text-sm font-bold text-white transition hover:bg-[#e04d0e] disabled:opacity-50">
            {pending ? "Updating…" : "Set new password"}
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── First-time tutorial modal ──────────────────────────────────────────────
const tutorialSteps = [
  {
    title: "Welcome to VJetstar Ops",
    body: "This is your virtual operations hub for Jetstar Airways simulation. You can manage your flights, track hours, and dispatch routes — all from here.",
    icon: "✈️",
  },
  {
    title: "My Timetable",
    body: "Head to My Timetable to browse available routes and add flights to your schedule. Once dispatched, mark them as started and finished to log your hours.",
    icon: "📅",
  },
  {
    title: "Available Routes",
    body: "Browse current Jetstar routes filtered to your assigned aircraft type. Your fleet assignment determines which routes appear here.",
    icon: "🗺️",
  },
  {
    title: "SimBrief Integration",
    body: "Connect your SimBrief Pilot ID in Settings to import flight plans with one click. Your dispatch gets added straight to your timetable.",
    icon: "📋",
  },
  {
    title: "Settings",
    body: "Update your simulator version (MSFS 2020 or 2024), your aircraft assignments, SimBrief ID, and your account password anytime from Settings.",
    icon: "⚙️",
  },
];

// Save just the SimBrief Pilot ID (profile PATCH needs the other fields too, so
// we send the pilot's current sim version + aircraft unchanged).
async function patchSimbrief(pilot: any, value: string): Promise<void> {
  await fetch("/api/auth/profile", {
    method: "PATCH", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      simulatorVersion: pilot.simulatorVersion,
      aircraft: pilot.aircraft,
      simbriefUsername: value.trim() || null,
    }),
  });
}

function TutorialModal({ pilot, onDone }: { pilot: any; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [sbId, setSbId] = useState<string>(pilot.simbriefUsername || "");
  const [saving, setSaving] = useState(false);
  const isSimbriefStep = step === tutorialSteps.length; // extra final screen
  const totalDots = tutorialSteps.length + 1;
  const current = tutorialSteps[step];

  const finish = async () => {
    setSaving(true);
    try {
      if (sbId.trim()) await patchSimbrief(pilot, sbId);
      await fetch("/api/auth/tutorial-seen", { method: "PATCH", credentials: "include" });
    } catch { /* swallow */ }
    setSaving(false);
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="bg-[#1a1a1a] px-6 py-5 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <VJetstarLogo height={28} light />
              <span className="font-mono text-[9px] uppercase tracking-[.2em] text-white/40">Quick start</span>
            </div>
            <button onClick={finish} className="rounded-lg p-1 text-white/40 transition hover:text-white/70">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="p-6">
          {isSimbriefStep ? (
            <>
              <div className="mb-4 text-4xl">📋</div>
              <h2 className="text-2xl font-black uppercase tracking-tight text-[#1a1a1a]">Your SimBrief Pilot ID</h2>
              <p className="mt-3 text-sm leading-relaxed text-[#6b7280]">
                Pop in your SimBrief Pilot ID so you can import flight plans with one click. You'll find it on your{" "}
                <a href="https://www.simbrief.com/system/profile.php" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#fb5713] hover:underline">SimBrief account page</a>.
              </p>
              <input
                value={sbId} onChange={(e) => setSbId(e.target.value)} placeholder="e.g. 123456"
                className="mt-4 h-11 w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm outline-none focus:border-[#fb5713]" />
              <p className="mt-1.5 text-[11px] text-[#9ca3af]">You can always change it later in Settings.</p>
            </>
          ) : (
            <>
              <div className="mb-4 text-4xl">{current.icon}</div>
              <h2 className="text-2xl font-black uppercase tracking-tight text-[#1a1a1a]">{current.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-[#6b7280]">{current.body}</p>
            </>
          )}

          {/* Step dots */}
          <div className="mt-6 flex items-center gap-1.5">
            {Array.from({ length: totalDots }).map((_, i) => (
              <button key={i} onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-[#fb5713]" : "w-1.5 bg-[#d1d5db] hover:bg-[#9ca3af]"}`} />
            ))}
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <button onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}
              className="rounded-xl border border-[#e5e7eb] px-4 py-2 text-xs font-semibold text-[#6b7280] transition hover:bg-[#f3f4f6] disabled:opacity-0">
              Back
            </button>
            {isSimbriefStep ? (
              <button onClick={finish} disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-[#fb5713] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#e04d0e] disabled:opacity-50">
                <Check className="h-4 w-4" /> {saving ? "Saving…" : "Get started"}
              </button>
            ) : (
              <button onClick={() => setStep(s => s + 1)}
                className="flex items-center gap-2 rounded-xl bg-[#1a1a1a] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#333]">
                Next <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Shown on later logins to pilots who still have no SimBrief ID — they must set
// one to continue (no dismiss).
function SimBriefGateModal({ pilot, onDone }: { pilot: any; onDone: () => void }) {
  const [sbId, setSbId] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sbId.trim()) { setErr("Enter your SimBrief Pilot ID to continue."); return; }
    setSaving(true); setErr("");
    try { await patchSimbrief(pilot, sbId); onDone(); }
    catch { setErr("Couldn't save — please try again."); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="bg-[#fb5713] px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📋</span>
            <div>
              <h2 className="font-black uppercase tracking-tight">Add your SimBrief ID</h2>
              <p className="mt-0.5 text-xs text-white/80">We still need your SimBrief Pilot ID to dispatch your flights.</p>
            </div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4 p-6">
          <div>
            <label className="mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[.16em] text-[#6b7280]">SimBrief Pilot ID</label>
            <input value={sbId} onChange={(e) => setSbId(e.target.value)} autoFocus placeholder="e.g. 123456"
              className="h-10 w-full rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 text-sm outline-none focus:border-[#fb5713]" />
            <p className="mt-1.5 text-[11px] text-[#9ca3af]">
              Find it on your <a href="https://www.simbrief.com/system/profile.php" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#fb5713] hover:underline">SimBrief account page</a>.
            </p>
          </div>
          {err && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
          <button type="submit" disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#fb5713] py-3 text-sm font-bold text-white transition hover:bg-[#e04d0e] disabled:opacity-50">
            {saving ? "Saving…" : "Save and continue"}<ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Main layout ────────────────────────────────────────────────────────────
function Layout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [path, setPath] = useLocation();
  const qc = useQueryClient();
  const isApp = useIsDesktopApp();
  // In the app: show Live map after Available routes (and hide Software — you're
  // already in the app). On the website: show Software too.
  const displayedNav = isApp
    ? [navItems[0], navItems[1], ...appOnlyNavItems, ...navItems.slice(2)]
    : [...navItems, ...webOnlyNavItems];
  const logout = useLogout({
    mutation: {
      onSuccess: () => {
        qc.removeQueries({ queryKey: getGetMeQueryKey() });
        qc.setQueryData(getGetMeQueryKey(), null);
        setPath("/login");
      },
    },
  });

  // Local state to dismiss the modals for this session after handling
  const [pwDone, setPwDone] = useState(false);
  const [tutDone, setTutDone] = useState(false);
  const [sbDone, setSbDone] = useState(false);

  // Collapsible sidebar (slides away); preference persisted per browser.
  const [navOpen, setNavOpen] = useState(() => { try { return localStorage.getItem("vj-nav") !== "0"; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem("vj-nav", navOpen ? "1" : "0"); } catch { /* ignore */ } }, [navOpen]);

  // Profile dropdown (top-right): holds Settings, Flight records, Personalisation.
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const profile = useProfile();
  useEffect(() => {
    if (!profileOpen) return;
    const onDoc = (e: MouseEvent) => { if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [profileOpen]);
  useEffect(() => { setProfileOpen(false); }, [path]);

  const publicPage = path === "/login";
  useEffect(() => {
    if (!isLoading && !user && !publicPage) setPath("/login");
    if (!isLoading && user && publicPage) setPath("/timetable");
  }, [user, isLoading, publicPage, setPath]);

  if (isLoading) return (
    <div className="min-h-[100dvh] bg-[#f9fafb] p-6">
      <div className="mx-auto mt-[18vh] max-w-lg space-y-4">
        <div className="h-3 w-28 animate-pulse rounded bg-[#fb5713]/30" />
        <div className="h-12 w-3/4 animate-pulse rounded bg-[#f3f4f6]" />
        <div className="h-40 animate-pulse rounded-2xl bg-[#f3f4f6]" />
      </div>
    </div>
  );

  if ((!user && !publicPage) || (user && publicPage)) return null;
  if (!user) return <>{children}</>;

  const pilot = user as any;
  const needsPasswordChange = pilot.mustChangePassword && !pwDone;
  // Show tutorial only after password is set (if needed), and only once
  const needsTutorial = !needsPasswordChange && !pilot.hasSeenTutorial && !tutDone;
  // On later logins, a pilot who's past the tutorial but still has no SimBrief
  // ID must set one before continuing (not re-prompted the same session they
  // just finished the tutorial).
  const needsSimbrief = !needsPasswordChange && !needsTutorial && !tutDone && pilot.hasSeenTutorial && !pilot.simbriefUsername && !sbDone;

  // Shared cockpit: full-width, no sidebar — just the flight and a leave button
  // (the page itself provides the Leave control).
  if (path.startsWith("/cockpit/")) {
    return (
      <div className="min-h-[100dvh] bg-[#f9fafb] text-[#1a1a1a]">
        <header className="sticky top-0 z-30 flex h-[64px] items-center border-b border-[#e5e7eb] bg-white/90 px-4 backdrop-blur">
          <Link href="/timetable" className="flex items-center gap-3"><VJetstarLogo height={26} /></Link>
        </header>
        <main className="px-4 py-7 md:px-8">
          <div key={path} className="vj-page">{children}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#f9fafb] text-[#1a1a1a]">
      {needsPasswordChange && <ForcePasswordModal onDone={() => setPwDone(true)} />}
      {needsTutorial && <TutorialModal pilot={pilot} onDone={() => { setTutDone(true); qc.invalidateQueries({ queryKey: getGetMeQueryKey() }); }} />}
      {needsSimbrief && <SimBriefGateModal pilot={pilot} onDone={() => { setSbDone(true); qc.invalidateQueries({ queryKey: getGetMeQueryKey() }); }} />}
      <AutoFlightTimer />

      <header className="sticky top-0 z-30 flex h-[64px] items-center justify-between border-b border-[#e5e7eb] bg-white/90 px-3 backdrop-blur md:px-5">
        <div className="flex items-center gap-1.5">
          <button onClick={() => setNavOpen((o) => !o)} aria-label="Toggle menu"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#1a1a1a]">
            <PanelLeft className="h-5 w-5" />
          </button>
          <Link href="/timetable" className="flex items-center gap-3" data-testid="link-brand-home">
            <VJetstarLogo height={26} />
            <span className="ml-1 hidden font-mono text-[9px] uppercase tracking-[.2em] text-[#9ca3af] sm:block">Virtual ops · MSFS</span>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <NotificationBell />
          <div className="relative" ref={profileRef}>
            <button onClick={() => setProfileOpen((o) => !o)} data-testid="button-profile-menu"
              className="flex items-center gap-2 rounded-full border border-transparent p-0.5 pr-2 transition hover:border-[#e5e7eb] hover:bg-[#f9fafb]">
              <Avatar url={profile.data?.avatarUrl} name={user.username} size={36} />
              <div className="hidden min-w-[70px] text-left md:block">
                <div className="text-sm font-bold leading-tight text-[#1a1a1a]" data-testid="text-username">{user.username}</div>
                <div className="font-mono text-[9px] uppercase tracking-wider text-[#9ca3af]">{user.isAdmin ? "Admin" : (pilot.simulatorVersion || "Pilot")}</div>
              </div>
              <ChevronDown className={`h-4 w-4 text-[#9ca3af] transition-transform ${profileOpen ? "rotate-180" : ""}`} />
            </button>
            {profileOpen && (
              <div className="vj-fade absolute right-0 top-[calc(100%+8px)] z-40 w-56 overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-xl">
                <div className="flex items-center gap-3 border-b border-[#f3f4f6] px-4 py-3">
                  <Avatar url={profile.data?.avatarUrl} name={user.username} size={40} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-[#1a1a1a]">{user.username}</div>
                    <div className="font-mono text-[9px] uppercase tracking-wider text-[#9ca3af]">{user.isAdmin ? "Admin" : (pilot.simulatorVersion || "Pilot")}</div>
                  </div>
                </div>
                <div className="p-1.5">
                  {profileMenu.map(({ href, label, icon: Icon }) => (
                    <Link key={href} href={href} onClick={() => setProfileOpen(false)}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${path === href ? "bg-[#fff7ed] text-[#fb5713]" : "text-[#374151] hover:bg-[#f3f4f6]"}`}>
                      <Icon className="h-4 w-4" />{label}
                    </Link>
                  ))}
                  <button onClick={() => { setProfileOpen(false); logout.mutate(); }} disabled={logout.isPending}
                    className="mt-1 flex w-full items-center gap-3 rounded-xl border-t border-[#f3f4f6] px-3 py-2.5 text-sm font-semibold text-[#6b7280] transition hover:bg-[#f3f4f6] hover:text-red-600">
                    <LogOut className="h-4 w-4" />{logout.isPending ? "Signing out…" : "Sign out"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1500px] flex-col md:min-h-[calc(100dvh-64px)] md:flex-row">
        <aside className={`${navOpen ? "flex" : "hidden md:flex"} shrink-0 flex-row gap-1 overflow-x-auto border-b border-[#e5e7eb] bg-white p-2 transition-[width,opacity,padding] duration-300 ease-out md:sticky md:top-[64px] md:h-[calc(100dvh-64px)] md:flex-col md:gap-1 md:self-start md:overflow-x-hidden md:overflow-y-auto md:border-b-0 md:border-r md:p-4 ${navOpen ? "md:w-[220px] md:opacity-100" : "md:w-0 md:min-w-0 md:p-0 md:opacity-0 md:border-r-0 md:pointer-events-none"}`}>
          <div className="hidden px-3 pb-2 pt-3 font-mono text-[9px] font-bold uppercase tracking-[.24em] text-[#9ca3af] md:block">Flight deck</div>
          {displayedNav.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} data-testid={`link-nav-${href.slice(1)}`}
              className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold transition-colors ${
                path === href ? "bg-[#fb5713] text-white" : "text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#1a1a1a]"
              }`}>
              <Icon className="h-4 w-4" />
              <span>{label}</span>
              {path === href && <span className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-white md:block" />}
            </Link>
          ))}

          {user.isAdmin && (
            <>
              <div className="hidden px-3 pb-1 pt-5 font-mono text-[9px] font-bold uppercase tracking-[.24em] text-[#9ca3af] md:block">Control tower</div>
              {[
                { href: "/ops", label: "Ops dashboard", icon: Gauge },
                { href: "/control-room", label: "AI Control Room", icon: Bot },
                { href: "/maintenance-ops", label: "Maintenance", icon: Wrench },
                { href: "/fleet", label: "Fleet", icon: Plane },
                { href: "/admin", label: "Administration", icon: ShieldCheck },
              ].map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} data-testid={`link-nav-${href.slice(1)}`}
                  className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold transition-colors ${
                    path === href ? "bg-[#fb5713] text-white" : "text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#1a1a1a]"
                  }`}>
                  <Icon className="h-4 w-4" />{label}
                </Link>
              ))}
            </>
          )}

          <div className="mt-auto hidden border-t border-[#f3f4f6] pt-4 md:block">
            <button data-testid="button-sign-out" onClick={() => logout.mutate()} disabled={logout.isPending}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-semibold text-[#6b7280] transition hover:bg-[#f3f4f6] hover:text-[#1a1a1a]">
              <LogOut className="h-4 w-4" />
              {logout.isPending ? "Signing out…" : "Sign out"}
            </button>
            <p className="px-3 pt-4 font-mono text-[9px] leading-relaxed text-[#d1d5db]">
              Independent virtual ops. Not affiliated with Jetstar Airways.
            </p>
          </div>
          <button data-testid="button-sign-out-mobile" onClick={() => logout.mutate()}
            className="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold text-[#6b7280] md:hidden">
            <LogOut className="h-4 w-4" />Sign out
          </button>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-7 md:px-8 md:py-9">
          <div key={path} className="vj-page">{children}</div>
          <footer className="mt-16 border-t border-[#f3f4f6] py-4 font-mono text-[9px] uppercase tracking-[.17em] text-[#d1d5db]">
            Virtual operations only · Not affiliated with Jetstar Airways
          </footer>
        </main>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/login"    component={Login} />
        <Route path="/timetable" component={Timetable} />
        <Route path="/flights"  component={Flights} />
        <Route path="/logs"     component={Logs} />
        <Route path="/liveries" component={Liveries} />
        <Route path="/software" component={Software} />
        <Route path="/live-map" component={LiveMap} />
        <Route path="/dispatch" component={Dispatch} />
        <Route path="/paperwork" component={Paperwork} />
        <Route path="/ops" component={OpsDashboard} />
        <Route path="/control-room" component={ControlRoom} />
        <Route path="/maintenance-ops" component={MaintenanceOps} />
        <Route path="/ai-models" component={AiModels} />
        <Route path="/fleet" component={Fleet} />
        <Route path="/personalisation" component={Personalisation} />
        <Route path="/cockpit/:code" component={Cockpit} />
        <Route path="/settings" component={Settings} />
        <Route path="/admin"    component={Admin} />
        <Route path="/"><Timetable /></Route>
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
