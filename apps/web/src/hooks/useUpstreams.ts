import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createUpstream,
  deleteUpstream,
  listModels,
  listUpstreams,
  updateUpstream,
  type ModelListResponse,
  type UpstreamInput,
  type UpstreamListResponse
} from "../lib/api";

export const UPSTREAMS_QUERY_KEY = ["upstreams"] as const;
export const ACCOUNTS_QUERY_KEY = ["accounts"] as const;
export const MODELS_QUERY_KEY = ["models"] as const;

export function useUpstreams(enabled = true) {
  return useQuery<UpstreamListResponse>({
    queryKey: UPSTREAMS_QUERY_KEY,
    queryFn: () => listUpstreams(),
    staleTime: 5 * 60_000,
    enabled
  });
}

export function useModels(enabled = true) {
  return useQuery<ModelListResponse>({
    queryKey: MODELS_QUERY_KEY,
    queryFn: () => listModels(),
    staleTime: 5 * 60_000,
    enabled
  });
}

function invalidateRelated(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: UPSTREAMS_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: MODELS_QUERY_KEY });
}

export function useCreateUpstream() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpstreamInput) => createUpstream(body),
    onSuccess: () => invalidateRelated(queryClient)
  });
}

export function useUpdateUpstream() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpstreamInput }) =>
      updateUpstream(id, patch),
    onSuccess: () => invalidateRelated(queryClient)
  });
}

export function useDeleteUpstream() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteUpstream(id),
    onSuccess: () => invalidateRelated(queryClient)
  });
}
