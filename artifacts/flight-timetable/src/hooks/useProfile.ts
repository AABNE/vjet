import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export interface Profile { username: string | null; avatarUrl: string | null; discordLinked: boolean }

export function useProfile() {
  return useQuery<Profile>({
    queryKey: ["profile"],
    queryFn: () => apiGet("/api/pilot/profile"),
    staleTime: 30_000,
    retry: false,
  });
}
