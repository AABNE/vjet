import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";

export interface HubNotification {
  id: number;
  kind: "dispatch" | "ops" | "strike" | "info";
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}
export interface NotificationsFeed {
  unread: number;
  notifications: HubNotification[];
}

const KEY = ["notifications"];

export function useNotifications() {
  return useQuery<NotificationsFeed>({
    queryKey: KEY,
    queryFn: () => apiGet<NotificationsFeed>("/api/notifications"),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost("/api/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
