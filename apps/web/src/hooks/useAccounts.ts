import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  batchCreateAccounts,
  createAccount,
  deleteAccount,
  listAccounts,
  provisionAccountToken,
  refreshAccountGems,
  refreshAllGems,
  updateAccount,
  type AccountListResponse,
  type BatchCreateAccountBody,
  type BatchCreateResult,
  type CreateAccountBody,
  type RefreshAllResult,
  type UpdateAccountPatch
} from "../lib/api";
import { ACCOUNTS_QUERY_KEY, UPSTREAMS_QUERY_KEY } from "./useUpstreams";

export { ACCOUNTS_QUERY_KEY } from "./useUpstreams";

export function useAccounts(upstreamId?: string, enabled = true) {
  return useQuery<AccountListResponse>({
    queryKey: [...ACCOUNTS_QUERY_KEY, upstreamId ?? "all"],
    queryFn: () => listAccounts(upstreamId),
    enabled
  });
}

function invalidateAccounts(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
  queryClient.invalidateQueries({ queryKey: UPSTREAMS_QUERY_KEY });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAccountBody) => createAccount(body),
    onSuccess: () => invalidateAccounts(queryClient)
  });
}

export function useBatchCreateAccounts() {
  const queryClient = useQueryClient();
  return useMutation<BatchCreateResult, Error, BatchCreateAccountBody>({
    mutationFn: (body: BatchCreateAccountBody) => batchCreateAccounts(body),
    onSuccess: () => invalidateAccounts(queryClient)
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAccountPatch }) =>
      updateAccount(id, patch),
    onSuccess: () => invalidateAccounts(queryClient)
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAccount(id),
    onSuccess: () => invalidateAccounts(queryClient)
  });
}

export function useRefreshAccountGems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => refreshAccountGems(id),
    onSuccess: () => invalidateAccounts(queryClient)
  });
}

export function useRefreshAllGems() {
  const queryClient = useQueryClient();
  return useMutation<RefreshAllResult, Error, void>({
    mutationFn: () => refreshAllGems(),
    onSuccess: () => invalidateAccounts(queryClient)
  });
}

export function useProvisionToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => provisionAccountToken(id),
    onSuccess: () => invalidateAccounts(queryClient)
  });
}
