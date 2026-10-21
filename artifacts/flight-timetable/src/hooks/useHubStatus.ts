import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export interface HubStatus { connected: boolean; required: boolean; msfsRunning: boolean; lastSeenAt: string | null }

// Whether the pilot hub (vJetstar Sim Link desktop app) is connected. Flights
// can only be started / cleared while it is.
export function useHubStatus() {
  return useQuery<HubStatus>({
    queryKey: ["hub-status"],
    queryFn: () => apiGet("/api/pilot/hub-status"),
    refetchInterval: 20_000,
    retry: false,
  });
}
