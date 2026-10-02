import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createApiKey,
  deleteApiKey,
  getApiKey,
  listApiKeys,
  updateApiKey,
  type ApiKeyInput,
  type ApiKeyListResponse,
  type ApiKeyPublic
} from "../lib/api";

export const API_KEYS_QUERY_KEY = ["api-keys"] as const;

export function useApiKeys(enabled = true) {
  return useQuery<ApiKeyListResponse>({
    queryKey: API_KEYS_QUERY_KEY,
    queryFn: () => listApiKeys(),
    staleTime: 5 * 60_000,
    enabled
  });
}

export function useApiKey(id: string | null) {
  return useQuery<ApiKeyPublic>({
    queryKey: [...API_KEYS_QUERY_KEY, id],
    queryFn: () => getApiKey(id as string),
    staleTime: 5 * 60_000,
    enabled: id !== null
  });
}

function invalidateApiKeys(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ApiKeyInput) => createApiKey(body),
    onSuccess: () => invalidateApiKeys(queryClient)
  });
}

export function useUpdateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ApiKeyInput }) =>
      updateApiKey(id, patch),
    onSuccess: () => invalidateApiKeys(queryClient)
  });
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteApiKey(id),
    onSuccess: () => invalidateApiKeys(queryClient)
  });
}
