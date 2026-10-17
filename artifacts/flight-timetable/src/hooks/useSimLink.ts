import { useEffect, useRef, useState } from "react";

// Live aircraft telemetry pushed from the desktop app (vJetstar Sim Link).
export interface SimPosition {
  connected: boolean;
  onGround: boolean;
  paused: boolean;
  lat: number;
  lon: number;
  altFt: number;
  headingTrue: number;
  groundSpeedKt: number;
  indicatedSpeedKt: number;
  title: string;
}

// The bridge the desktop app injects into the hub page via its preload.
interface SimLinkBridge {
  isApp: boolean;
  version?: string;
  onPosition?: (cb: (p: SimPosition) => void) => void;
  onStatus?: (cb: (connected: boolean) => void) => void;
  onHours?: (cb: (hours: number) => void) => void;
  getStatus?: () => Promise<{ connected: boolean; hours: number; latest: SimPosition | null }>;
}

function bridge(): SimLinkBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { vjetSimLink?: SimLinkBridge }).vjetSimLink;
  return b && b.isApp ? b : null;
}

// True when the hub is running inside the vJetstar Sim Link desktop app.
export function useIsDesktopApp(): boolean {
  const [isApp] = useState(() => !!bridge());
  return isApp;
}

export interface SimLinkState {
  isApp: boolean;
  connected: boolean;
  position: SimPosition | null;
  hours: number | null;
}

// Subscribes to live telemetry from the desktop app. In a normal browser this
// stays inert (isApp = false), so callers can render the hub unchanged.
export function useSimLink(): SimLinkState {
  const [isApp] = useState(() => !!bridge());
  const [connected, setConnected] = useState(false);
  const [position, setPosition] = useState<SimPosition | null>(null);
  const [hours, setHours] = useState<number | null>(null);
  const bound = useRef(false);

  useEffect(() => {
    const b = bridge();
    if (!b || bound.current) return;
    bound.current = true;

    b.onStatus?.((c) => setConnected(c));
    b.onPosition?.((p) => { setPosition(p); setConnected(true); });
    b.onHours?.((h) => setHours(h));
    b.getStatus?.().then((s) => {
      if (!s) return;
      setConnected(!!s.connected);
      if (s.latest) setPosition(s.latest);
      if (typeof s.hours === "number") setHours(s.hours);
    }).catch(() => { /* ignore */ });
  }, []);

  return { isApp, connected, position, hours };
}
