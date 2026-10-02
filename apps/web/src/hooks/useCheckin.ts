import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkinAccount,
  getCheckinSettings,
  runCheckinTest,
  updateCheckinSettings,
  type CheckinSettings,
  type CheckinSettingsPatch,
  type CheckinTestResult
} from "../lib/api";
import { ACCOUNTS_QUERY_KEY } from "./useUpstreams";

export const CHECKIN_QUERY_KEY = ["checkin", "settings"] as const;

export function useCheckinSettings(enabled = true) {
  return useQuery<CheckinSettings>({
    queryKey: CHECKIN_QUERY_KEY,
    queryFn: () => getCheckinSettings(),
    enabled
  });
}

export function useUpdateCheckinSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: CheckinSettingsPatch) => updateCheckinSettings(patch),
    onSuccess: (data) => {
      queryClient.setQueryData(CHECKIN_QUERY_KEY, data);
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
    }
  });
}

export function useRunCheckinTest() {
  const queryClient = useQueryClient();
  return useMutation<CheckinTestResult, Error, void>({
    mutationFn: () => runCheckinTest(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CHECKIN_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
    }
  });
}

export function useCheckinAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => checkinAccount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
    }
  });
}
