import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetTimetableQueryKey, useGetTimetable, useStartFlight, useFinishFlight } from "@workspace/api-client-react";
import { useSimLink } from "@/hooks/useSimLink";
import { useToast } from "@/hooks/use-toast";

// Movement threshold (kt) — below this the aircraft counts as stopped. This is
// far more reliable than the parking-brake SimVar, which many study-level
// add-ons (Fenix, FSLabs, etc.) don't drive.
const MOVING_KT = 1;
// How long the aircraft must sit still on the ground after flying before we
// close the sector (ms). Long enough that a hold-short on taxi-in won't finish
// a flight; a gate park easily clears it.
const PARK_DWELL_MS = 120_000;

// Auto flight timer — active only inside the desktop app while connected to MSFS.
// Starts the earliest pending sector when the aircraft first rolls from the gate,
// and finishes the active sector once it's flown and parked again.
// Manual Start/Finish on the timetable still works everywhere (website included).
export function AutoFlightTimer() {
  const { isApp, connected, position } = useSimLink();
  const qc = useQueryClient();
  const { toast } = useToast();

  const inv = () => qc.invalidateQueries({ queryKey: getGetTimetableQueryKey() });
  const tt = useGetTimetable({ query: { queryKey: getGetTimetableQueryKey(), enabled: isApp } });
  const start = useStartFlight({ mutation: { onSuccess: inv } });
  const finish = useFinishFlight({ mutation: { onSuccess: inv } });

  const airborne = useRef(false);
  const busy = useRef(false);
  const stoppedSince = useRef<number | null>(null);

  useEffect(() => {
    if (!isApp || !connected || !position) return;

    const entries = (tt.data || []) as any[];
    const active = entries.find((e) => e.status.toLowerCase() === "active");
    const pending = entries.filter((e) => e.status.toLowerCase() === "pending");

    const moving = (position.groundSpeedKt ?? 0) > MOVING_KT;

    // Track whether the active flight has actually left the ground.
    if (active && !position.onGround) airborne.current = true;
    if (!active) { airborne.current = false; stoppedSince.current = null; }

    if (busy.current) return;

    // Aircraft starts moving on the ground → begin the next sector.
    if (!active && pending.length && position.onGround && moving) {
      const next = [...pending].sort((a, b) =>
        `${a.flight.flightDate} ${a.flight.departureTime}`.localeCompare(`${b.flight.flightDate} ${b.flight.departureTime}`),
      )[0];
      busy.current = true;
      airborne.current = false;
      stoppedSince.current = null;
      start.mutate({ id: next.id }, {
        onSettled: () => { busy.current = false; },
        onSuccess: () => toast({
          title: "Flight started",
          description: `${next.flight.flightNumber} ${next.flight.departure}→${next.flight.arrival} — rolling from the gate.`,
        }),
      });
      return;
    }

    // Active flight that has flown, now parked (stopped on the ground for a
    // sustained moment) → finish it.
    if (active && airborne.current && position.onGround) {
      if (!moving) {
        if (stoppedSince.current == null) {
          stoppedSince.current = Date.now();
        } else if (Date.now() - stoppedSince.current >= PARK_DWELL_MS) {
          busy.current = true;
          finish.mutate({ id: active.id }, {
            onSettled: () => { busy.current = false; },
            onSuccess: () => toast({
              title: "Flight finished",
              description: `${active.flight.flightNumber} logged — parked at the gate.`,
            }),
          });
        }
      } else {
        stoppedSince.current = null; // moving again — reset the park timer
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, isApp, connected, tt.data]);

  return null;
}
