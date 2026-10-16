import { Download, ExternalLink, Monitor, Activity } from "lucide-react";

function JetstarStar({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <polygon points="50,5 61,35 95,35 68,57 79,91 50,70 21,91 32,57 5,35 39,35" fill="currentColor" />
    </svg>
  );
}

const SOFTWARE = [
  {
    id: "tracker",
    name: "vJetstar Sim Link",
    version: "1.0.0",
    platform: "Windows",
    description: "System tray app that reads your active MSFS flight and automatically updates your live position on the Pilot Hub map. Shows your current altitude, speed, heading and route progress in real time.",
    features: [
      "Connects to MSFS via SimConnect",
      "Live position feeds to the Pilot Hub",
      "System tray — runs silently in background",
      "Auto-starts with Windows",
      "Works with MSFS 2020 and MSFS 2024",
    ],
    downloadUrl: "/downloads/vJetstarSimLink-Setup.exe",
    downloadLabel: "Download Installer (.exe)",
    size: "12 MB",
    icon: Activity,
    accent: "#fb5713",
  },
];

const EXTERNAL_LINKS = [
  {
    name: "SimBrief",
    description: "Free flight planning — generate full OFPs, weight & balance, and SID/STAR charts for your Jetstar routes.",
    url: "https://dispatch.simbrief.com",
    icon: "✈️",
  },
  {
    name: "Navigraph Charts",
    description: "Worldwide charts and procedures. Pairs with SimBrief for full enroute and approach coverage.",
    url: "https://charts.navigraph.com",
    icon: "🗺️",
  },
  {
    name: "Little Navmap",
    description: "Free open-source flight planner and moving map for MSFS. Great for visual route inspection.",
    url: "https://albar965.github.io/littlenavmap.html",
    icon: "🧭",
  },
  {
    name: "VATSIM",
    description: "Fly with live ATC online. Jetstar virtual pilots are encouraged to fly on the VATPAC division.",
    url: "https://www.vatsim.net",
    icon: "🎙️",
  },
  {
    name: "VATPAC",
    description: "The Australian and Pacific region ATC division of VATSIM. Home airspace for most Jetstar routes.",
    url: "https://vatpac.org",
    icon: "🇦🇺",
  },
  {
    name: "VATNZ",
    description: "New Zealand division of VATSIM — covers AKL, WLG, CHC, ZQN and all NZ domestic routes.",
    url: "https://vatnz.net",
    icon: "🇳🇿",
  },
];

export default function Software() {
  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Downloads · tools · links</p>
        <h1 className="mt-2 text-5xl font-black uppercase leading-none tracking-tight text-[#1a1a1a] md:text-6xl">Software</h1>
        <p className="mt-3 text-sm text-[#6b7280]">Official Pilot Hub tools and recommended third-party software for virtual operations.</p>
      </div>

      {/* Downloads */}
      <section className="mb-10">
        <h2 className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[#9ca3af]">Official downloads</h2>
        <div className="space-y-4">
          {SOFTWARE.map(app => {
            const Icon = app.icon;
            return (
              <div key={app.id} className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
                <div className="flex flex-col gap-5 p-6 md:flex-row md:items-start">
                  {/* Icon + info */}
                  <div className="flex items-start gap-4 flex-1">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#fb5713] text-white">
                      <Icon className="h-7 w-7" />
                    </div>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-black uppercase tracking-tight text-[#1a1a1a]">{app.name}</h3>
                        <span className="rounded-full border border-[#e5e7eb] px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-[#9ca3af]">v{app.version}</span>
                        <span className="rounded-full border border-[#e5e7eb] px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-[#9ca3af]">{app.platform}</span>
                        <span className="rounded-full border border-[#e5e7eb] px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-[#9ca3af]">{app.size}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[#6b7280]">{app.description}</p>
                      <ul className="mt-3 space-y-1.5">
                        {app.features.map(f => (
                          <li key={f} className="flex items-center gap-2 text-xs text-[#6b7280]">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#fb5713]" />{f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Download */}
                  <div className="shrink-0">
                    <a href={app.downloadUrl} download
                      className="flex items-center gap-2 rounded-xl bg-[#fb5713] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#e04d0e]">
                      <Download className="h-4 w-4" />{app.downloadLabel}
                    </a>
                    <p className="mt-2 text-center font-mono text-[9px] uppercase tracking-wider text-[#9ca3af]">Windows 10 / 11 · {app.size}</p>
                  </div>
                </div>

                {/* Install note */}
                <div className="border-t border-[#f3f4f6] bg-[#f9fafb] px-6 py-3">
                  <p className="font-mono text-[10px] text-[#9ca3af]">
                    <span className="font-bold text-[#6b7280]">Install note:</span> Requires Microsoft Flight Simulator to be running. SimConnect is included with MSFS — no extra setup needed. Run installer as administrator.
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* External links */}
      <section>
        <h2 className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[#9ca3af]">Recommended tools & links</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {EXTERNAL_LINKS.map(link => (
            <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer"
              className="group flex flex-col gap-3 rounded-2xl border border-[#e5e7eb] bg-white p-5 transition hover:border-[#fb5713]/40 hover:shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{link.icon}</span>
                  <span className="font-black uppercase tracking-tight text-[#1a1a1a]">{link.name}</span>
                </div>
                <ExternalLink className="h-4 w-4 text-[#d1d5db] transition group-hover:text-[#fb5713]" />
              </div>
              <p className="text-xs leading-5 text-[#6b7280]">{link.description}</p>
            </a>
          ))}
        </div>
      </section>

      {/* Live tracker note */}
      <div className="mt-8 rounded-2xl border border-[#fb5713]/20 bg-[#fff7f5] p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fb5713] text-white">
            <Monitor className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold uppercase tracking-tight text-[#1a1a1a]">Live tracker on the login page</h3>
            <p className="mt-1 text-xs text-[#6b7280]">
              Once you install Sim Link Tracker and log a flight, your position appears on the live map on the Pilot Hub login page — visible to anyone visiting the site. No login required to view.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
