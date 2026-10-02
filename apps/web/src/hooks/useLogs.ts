import { useQuery } from "@tanstack/react-query";
import { getLogAttempts, listLogs, type ListLogsArgs, type LogsPage, type LogAttemptsResponse } from "../lib/api";

export const LOGS_QUERY_KEY = ["logs"] as const;

export function useLogs(filters: ListLogsArgs) {
  const source = filters.source ?? "all";
  const status = filters.status ?? "all";
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  return useQuery<LogsPage>({
    queryKey: [...LOGS_QUERY_KEY, source, status, limit, offset],
    queryFn: () => listLogs(filters),
    placeholderData: (prev) => prev
  });
}

export function useLogAttempts(requestId: string | null) {
  return useQuery<LogAttemptsResponse>({
    queryKey: [...LOGS_QUERY_KEY, "attempts", requestId],
    queryFn: () => getLogAttempts(requestId as string),
    enabled: requestId !== null
  });
}
