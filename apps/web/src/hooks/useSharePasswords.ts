import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSharePassword,
  deleteSharePassword,
  listSharePasswords,
  updateSharePassword,
  type SharePasswordInput,
  type SharePasswordListResponse,
  type SharePasswordPatch
} from "../lib/api";

export const SHARE_PASSWORDS_QUERY_KEY = ["share-passwords"] as const;

export function useSharePasswords(enabled = true) {
  return useQuery<SharePasswordListResponse>({
    queryKey: SHARE_PASSWORDS_QUERY_KEY,
    queryFn: () => listSharePasswords(),
    staleTime: 60_000,
    enabled
  });
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: SHARE_PASSWORDS_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: ["gallery", "overview"] });
}

export function useCreateSharePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SharePasswordInput) => createSharePassword(body),
    onSuccess: () => invalidate(queryClient)
  });
}

export function useUpdateSharePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SharePasswordPatch }) =>
      updateSharePassword(id, patch),
    onSuccess: () => invalidate(queryClient)
  });
}

export function useDeleteSharePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSharePassword(id),
    onSuccess: () => invalidate(queryClient)
  });
}
