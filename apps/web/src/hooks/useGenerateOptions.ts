import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGenerateOptions,
  updateGenerateOptions,
  type GenerateOptionsResponse,
  type UpdateGenerateOptionsPatch
} from "../lib/api";

export const GENERATE_OPTIONS_QUERY_KEY = ["generate-options"] as const;

export function useGenerateOptions(upstreamId?: string) {
  return useQuery<GenerateOptionsResponse>({
    queryKey: [...GENERATE_OPTIONS_QUERY_KEY, upstreamId ?? "default"],
    queryFn: () => getGenerateOptions(upstreamId),
    staleTime: 5 * 60_000
  });
}

export function useUpdateGenerateOptions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateGenerateOptionsPatch) => updateGenerateOptions(patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GENERATE_OPTIONS_QUERY_KEY });
    }
  });
}
