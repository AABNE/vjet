import { Download, Activity, Check } from "lucide-react";

const SIMLINK = {
  name: "vJetstar Sim Link",
  version: "1.0.0 Beta",
  platform: "Windows 10 / 11",
  size: "112 MB",
  description:
    "The vJetstar Pilot Hub as a desktop app — opens the hub with a built-in live MSFS flight-tracker map and flight stats, reading your active flight in real time (altitude, speed, heading, route progress). Runs in the system tray and keeps your sim hours in sync.",
  features: [
    "Opens the Pilot Hub with a built-in Live Map",
    "Live MSFS position, altitude, speed & heading",
    "Connects to MSFS via SimConnect",
    "System tray — keeps your sim hours in sync",
    "Works with MSFS 2020 and MSFS 2024",
  ],
  downloadUrl: "https://github.com/AABNE/vjet/releases/download/v1.0.0-beta/vJetstar.Sim.Link.Setup.1.0.0.exe",
};

export default function Software() {
  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="mb-8">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Desktop app</p>
        <h1 className="mt-2 text-5xl font-black uppercase leading-none tracking-tight text-[#1a1a1a] md:text-6xl">Software</h1>
        <p className="mt-3 text-sm text-[#6b7280]">Download the vJetstar Pilot Hub desktop app for Windows.</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
        <div className="flex flex-col gap-5 p-6 md:flex-row md:items-start">
          <div className="flex items-start gap-4 flex-1">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#fb5713] text-white">
              <Activity className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-black uppercase tracking-tight text-[#1a1a1a]">{SIMLINK.name}</h3>
                <span className="rounded-full bg-[#fb5713] px-2 py-0.5 font-mono text-[9px] font-black uppercase tracking-wider text-white">Beta</span>
                <span className="rounded-full border border-[#e5e7eb] px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-[#9ca3af]">v{SIMLINK.version}</span>
                <span className="rounded-full border border-[#e5e7eb] px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-[#9ca3af]">{SIMLINK.platform}</span>
                <span className="rounded-full border border-[#e5e7eb] px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-[#9ca3af]">{SIMLINK.size}</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-[#6b7280]">{SIMLINK.description}</p>
              <ul className="mt-3 space-y-1.5">
                {SIMLINK.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-xs text-[#6b7280]">
                    <Check className="h-3.5 w-3.5 shrink-0 text-[#fb5713]" />{f}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="shrink-0">
            <a href={SIMLINK.downloadUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-xl bg-[#fb5713] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#e04d0e]">
              <Download className="h-4 w-4" />Download Beta (.exe)
            </a>
            <p className="mt-2 text-center font-mono text-[9px] uppercase tracking-wider text-[#9ca3af]">{SIMLINK.platform} · {SIMLINK.size}</p>
          </div>
        </div>

        <div className="border-t border-[#f3f4f6] bg-[#f9fafb] px-6 py-3">
          <p className="font-mono text-[10px] text-[#9ca3af]">
            <span className="font-bold text-[#6b7280]">Install note:</span> Beta build — it isn't code-signed yet, so Windows SmartScreen may warn: click "More info" → "Run anyway". SimConnect is included with MSFS; no extra setup needed.
          </p>
        </div>
      </div>
    </div>
  );
}
