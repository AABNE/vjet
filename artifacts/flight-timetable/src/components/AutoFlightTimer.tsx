import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetTimetableQueryKey, useGetTimetable, useStartFlight, useFinishFlight } from "@workspace/api-client-react";
import { useSimLink } from "@/hooks/useSimLink";
import { useToast } from "@/hooks/use-toast";

// Auto flight timer — active only inside the desktop app while connected to MSFS.
// Releases parking brake on the ground → starts the earliest pending flight.
// Sets parking brake on the ground after having flown → finishes the active one.
// Manual Start/Finish on the timetable still works everywhere (website included).
export function AutoFlightTimer() {
  const { isApp, connected, position } = useSimLink();
  const qc = useQueryClient();
  const { toast } = useToast();

  const inv = () => qc.invalidateQueries({ queryKey: getGetTimetableQueryKey() });
  const tt = useGetTimetable({ query: { queryKey: getGetTimetableQueryKey(), enabled: isApp } });
  const start = useStartFlight({ mutation: { onSuccess: inv } });
  const finish = useFinishFlight({ mutation: { onSuccess: inv } });

  const prevBrake = useRef<boolean | null>(null);
  const airborne = useRef(false);
  const busy = useRef(false);

  useEffect(() => {
    if (!isApp || !connected || !position) return;

    const entries = (tt.data || []) as any[];
    const active = entries.find((e) => e.status === "active");
    const pending = entries.filter((e) => e.status === "pending");

    // Track whether the active flight has actually been airborne.
    if (active && !position.onGround) airborne.current = true;
    if (!active) airborne.current = false;

    const brake = position.parkingBrake;
    const prev = prevBrake.current;
    prevBrake.current = brake;
    if (prev === null || busy.current) return; // need a transition; don't double-fire

    // Parking brake released on the ground → start the next flight.
    if (prev === true && brake === false && position.onGround && !active && pending.length) {
      const next = [...pending].sort((a, b) =>
        `${a.flight.flightDate} ${a.flight.departureTime}`.localeCompare(`${b.flight.flightDate} ${b.flight.departureTime}`),
      )[0];
      busy.current = true;
      airborne.current = false;
      start.mutate({ id: next.id }, {
        onSettled: () => { busy.current = false; },
        onSuccess: () => toast({
          title: "Flight started",
          description: `${next.flight.flightNumber} ${next.flight.departure}→${next.flight.arrival} — parking brake released.`,
        }),
      });
      return;
    }

    // Parking brake set on the ground after flying → finish the active flight.
    if (prev === false && brake === true && position.onGround && active && airborne.current) {
      busy.current = true;
      finish.mutate({ id: active.id }, {
        onSettled: () => { busy.current = false; },
        onSuccess: () => toast({
          title: "Flight finished",
          description: `${active.flight.flightNumber} logged — parking brake set.`,
        }),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, isApp, connected, tt.data]);

  return null;
}
