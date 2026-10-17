import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAuth } from "@/components/auth-provider";
import { useSimLink, type SimPosition } from "@/hooks/useSimLink";
import { Plane, Gauge, Mountain, Compass, Navigation, Clock, Ruler, Activity } from "lucide-react";

const ORANGE = "#fb5713";
// CARTO Basemaps key (client-side basemap key — restrict it to the hub domain in
// the CARTO dashboard). Overridable at build via VITE_CARTO_KEY.
const CARTO_KEY = (import.meta.env.VITE_CARTO_KEY as string | undefined) || "cb1_4mx5_1_a54999ab7bf2d9b048dc3dd5";

function haversineNm(a: [number, number], b: [number, number]): number {
  const R = 3440.065; // nautical miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function phaseOf(p: SimPosition): string {
  if (p.onGround) return p.groundSpeedKt > 40 ? "Takeoff roll" : p.groundSpeedKt > 2 ? "Taxi" : "Parked";
  if (p.altFt < 10000 && p.groundSpeedKt > 60) return "Climb / Descent";
  return "Cruise";
}

const planeHtml = (deg: number) => `
  <div style="transform: rotate(${deg}deg); filter: drop-shadow(0 0 5px rgba(251,87,19,.9));">
    <svg width="34" height="34" viewBox="0 0 24 24" fill="${ORANGE}" stroke="#fff" stroke-width="0.6">
      <path d="M12 2 L13.2 10 L22 14 L22 15.6 L13.2 13.4 L13 19 L15.4 20.6 L15.4 22 L12 21 L8.6 22 L8.6 20.6 L11 19 L10.8 13.4 L2 15.6 L2 14 L10.8 10 Z"/>
    </svg>
  </div>`;

function Stat({ icon: Icon, label, value, unit }: { icon: any; label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
      <div className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[.16em] text-[#9ca3af]">
        <Icon className="h-3.5 w-3.5 text-[#fb5713]" />{label}
      </div>
      <div className="mt-2 text-2xl font-black tabular-nums text-[#1a1a1a]">
        {value}{unit && <span className="ml-1 text-xs font-semibold text-[#9ca3af]">{unit}</span>}
      </div>
    </div>
  );
}

export default function LiveMap() {
  const { user } = useAuth();
  const { connected, position, session, initialTrail } = useSimLink();

  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const trailRef = useRef<L.Polyline | null>(null);
  const trailPts = useRef<[number, number][]>([]);
  const firstFix = useRef(true);
  const seeded = useRef(false);

  // Session stats come from the desktop app (persist across navigation).
  const distanceNm = session.distanceNm;
  const airborneSec = session.airborneSec;

  // Init Leaflet once.
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { zoomControl: true, attributionControl: true, worldCopyJump: true })
      .setView([-25.3, 133.8], 4);
    L.tileLayer(`https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`, {
      maxZoom: 20, attribution: "&copy; OpenStreetMap &copy; CARTO",
    }).addTo(map);
    mapRef.current = map;
    trailRef.current = L.polyline([], { color: ORANGE, weight: 2.5, opacity: 0.75 }).addTo(map);
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; seeded.current = false; };
  }, []);

  // Seed the trail from the app's full flight path (restores it on re-entry).
  useEffect(() => {
    if (seeded.current || !mapRef.current || !trailRef.current || initialTrail.length === 0) return;
    seeded.current = true;
    trailPts.current = initialTrail.slice();
    trailRef.current.setLatLngs(trailPts.current);
    const last = trailPts.current[trailPts.current.length - 1];
    if (last && firstFix.current) { mapRef.current.setView(last, 8); firstFix.current = false; }
  }, [initialTrail]);

  // Update map on each fix.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !position) return;
    const pt: [number, number] = [position.lat, position.lon];

    if (!markerRef.current) {
      markerRef.current = L.marker(pt, {
        icon: L.divIcon({ className: "", html: planeHtml(position.headingTrue), iconSize: [34, 34], iconAnchor: [17, 17] }),
      }).addTo(map);
    } else {
      markerRef.current.setLatLng(pt);
      markerRef.current.setIcon(L.divIcon({ className: "", html: planeHtml(position.headingTrue), iconSize: [34, 34], iconAnchor: [17, 17] }));
    }

    const prev = trailPts.current[trailPts.current.length - 1];
    if (!prev || haversineNm(prev, pt) > 0.05) {
      trailPts.current.push(pt);
      if (trailPts.current.length > 8000) trailPts.current.shift();
      trailRef.current?.setLatLngs(trailPts.current);
    }

    if (firstFix.current) { map.setView(pt, 8); firstFix.current = false; }
    else map.panTo(pt, { animate: true, duration: 0.4 });
  }, [position]);

  const p = position;
  const fmt = (n: number | undefined, d = 0) =>
    n == null || isNaN(n) ? "—" : n.toLocaleString("en-AU", { maximumFractionDigits: d, minimumFractionDigits: d });
  const hhmm = (sec: number) => `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[.2em] text-[#fb5713]">Sim Link · live</p>
          <h1 className="mt-2 text-4xl font-black uppercase leading-none tracking-tight text-[#1a1a1a] md:text-5xl">Live map</h1>
          <p className="mt-2 text-sm text-[#6b7280]">Your live position and flight stats, straight from Microsoft Flight Simulator.</p>
        </div>
        <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest ${
          connected ? "border-green-200 bg-green-50 text-green-700" : "border-[#e5e7eb] bg-[#f9fafb] text-[#9ca3af]"
        }`}>
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-[#d8a33a]"}`} />
          {connected ? "MSFS connected" : "Waiting for MSFS…"}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-[#e5e7eb]" style={{ height: 460 }}>
        <div ref={mapEl} style={{ position: "absolute", inset: 0, background: "#0b0e12" }} />
        {!p && (
          <div className="absolute inset-0 z-[500] flex flex-col items-center justify-center bg-[#0b0e12]/80 text-center text-white">
            <Plane className="h-10 w-10 text-[#fb5713]" />
            <div className="mt-3 text-lg font-bold">Waiting for your flight…</div>
            <div className="mt-1 text-sm text-white/60">Start a flight in MSFS and your aircraft will appear here.</div>
          </div>
        )}
      </div>

      <div className="mt-3 text-sm font-bold text-[#1a1a1a]">
        {p ? (p.title || "Aircraft").replace(/_/g, " ") : "—"}
        {p && <span className="ml-3 rounded-full bg-[#fff7f5] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[#fb5713]">{phaseOf(p)}</span>}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={Mountain} label="Altitude" value={fmt(p?.altFt)} unit="ft" />
        <Stat icon={Gauge} label="Ground speed" value={fmt(p?.groundSpeedKt)} unit="kt" />
        <Stat icon={Activity} label="Airspeed" value={fmt(p?.indicatedSpeedKt)} unit="kt" />
        <Stat icon={Compass} label="Heading" value={p ? fmt(p.headingTrue).padStart(3, "0") : "—"} unit="°T" />
      </div>

      <h2 className="mb-3 mt-8 font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[#9ca3af]">This session</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={Ruler} label="Distance flown" value={fmt(distanceNm)} unit="nm" />
        <Stat icon={Clock} label="Time airborne" value={hhmm(airborneSec)} />
        <Stat icon={Navigation} label="Position" value={p ? `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}` : "—"} />
        <Stat icon={Plane} label="Status" value={p ? (p.onGround ? "On ground" : "Airborne") : "—"} />
      </div>

      <h2 className="mb-3 mt-8 font-mono text-[10px] font-bold uppercase tracking-[.2em] text-[#9ca3af]">Your career</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={Clock} label="Total sim hours" value={fmt(user?.simHours as number | undefined, 1)} unit="h" />
        <Stat icon={Plane} label="Fleet" value={(user?.aircraft || []).join(", ") || "—"} />
        <Stat icon={Gauge} label="Simulator" value={(user as any)?.simulatorVersion || "—"} />
        <Stat icon={Navigation} label="Callsign" value={user?.username || "—"} />
      </div>
    </div>
  );
}
