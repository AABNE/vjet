import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey, useLogin } from "@workspace/api-client-react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { VJetstarLogo } from "@/components/VJetstarLogo";

export default function Login() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const login = useLogin({
    mutation: {
      onSuccess: (user) => {
        qc.setQueryData(getGetMeQueryKey(), user);
        setLocation("/timetable");
      },
    },
  });

  const busy = login.isPending;
  const error = login.error as any;

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#fb5713]">
      {/* Diagonal stripe texture */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 40px, rgba(255,255,255,0.04) 40px, rgba(255,255,255,0.04) 41px)" }}
      />

      <div className="relative mx-auto grid min-h-[100dvh] max-w-7xl grid-cols-1 lg:grid-cols-[1fr_.9fr]">

        {/* LEFT: Branding — just the logo, centred */}
        <section className="flex flex-col items-center justify-center px-8 py-14 text-white">
          <VJetstarLogo height={64} light />
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[.3em] text-white/55">Pilot hub login</p>
        </section>

        {/* RIGHT: Login card */}
        <section className="flex items-center justify-center bg-white px-6 py-12 text-[#1a1a1a] lg:my-8 lg:mr-8 lg:rounded-2xl">
          <div className="w-full max-w-md">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Pilot Access</p>
            <h2 className="mt-2 text-3xl font-black uppercase tracking-tight text-[#1a1a1a]">Welcome back</h2>
            <p className="mt-2 text-sm leading-6 text-[#6b7280]">Sign in to view your roster and dispatch your next flight.</p>

            <form
              className="mt-8 space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                login.mutate({ data: { username: username.trim(), password } });
              }}
            >
              <label className="block">
                <span className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[.16em] text-[#6b7280]">Pilot username</span>
                <input
                  data-testid="input-login-username"
                  type="text"
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={32}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="h-12 w-full rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-4 text-sm text-[#1a1a1a] outline-none transition focus:border-[#fb5713] focus:ring-2 focus:ring-[#fb5713]/20"
                />
              </label>

              <label className="block">
                <span className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[.16em] text-[#6b7280]">Password</span>
                <div className="relative">
                  <LockKeyhole className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ca3af]" />
                  <input
                    data-testid="input-login-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 w-full rounded-lg border border-[#e5e7eb] bg-[#f9fafb] pl-11 pr-4 text-sm text-[#1a1a1a] outline-none transition focus:border-[#fb5713] focus:ring-2 focus:ring-[#fb5713]/20"
                  />
                </div>
              </label>

              {error && (
                <div role="alert" data-testid="status-login-error" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                  {error?.message || "Sign-in failed. Check your details and try again."}
                </div>
              )}

              <button
                data-testid="button-login-submit"
                type="submit"
                disabled={busy}
                className="flex h-12 w-full items-center justify-between rounded-lg bg-[#fb5713] px-5 text-sm font-bold text-white transition hover:bg-[#e04d0e] disabled:opacity-50"
              >
                {busy ? "Connecting…" : "Sign in to ops"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>

            <a href="/apply" className="mt-5 block rounded-lg border border-[#e5e7eb] px-5 py-3 text-center text-sm text-[#6b7280] transition hover:border-[#fb5713]/40 hover:bg-[#fff7ed]">
              Don't have a login? <span className="font-bold text-[#fb5713]">Check your DMs or apply here</span>
            </a>

            <div className="mt-8 border-t border-[#f3f4f6] pt-5 font-mono text-[9px] uppercase leading-5 tracking-wider text-[#9ca3af]">
              Access restricted to virtual operations accounts.<br />
              Aircraft assignment is managed by operations.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
