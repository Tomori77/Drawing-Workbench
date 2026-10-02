import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPreset,
  deletePreset,
  getPresetsOverview,
  listPresets,
  updatePreset,
  type CreatePresetInput,
  type PresetKind,
  type PresetListResponse,
  type PresetOverviewResponse,
  type UpdatePresetPatch
} from "../lib/api";

export const PRESETS_QUERY_KEY = ["presets"] as const;

export function usePresets(kind: PresetKind, sid?: string, enabled = true) {
  return useQuery<PresetListResponse>({
    queryKey: [...PRESETS_QUERY_KEY, kind, sid ?? "own"],
    queryFn: () => listPresets({ kind, sid }),
    staleTime: 30_000,
    enabled
  });
}

export function usePresetsOverview(enabled = true) {
  return useQuery<PresetOverviewResponse>({
    queryKey: [...PRESETS_QUERY_KEY, "overview"],
    queryFn: () => getPresetsOverview(),
    staleTime: 30_000,
    enabled
  });
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>, kind: PresetKind) {
  queryClient.invalidateQueries({ queryKey: [...PRESETS_QUERY_KEY, kind] });
}

export function useCreatePreset(kind: PresetKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePresetInput) => createPreset(body),
    onSuccess: () => invalidate(queryClient, kind)
  });
}

export function useUpdatePreset(kind: PresetKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdatePresetPatch }) => updatePreset(id, patch),
    onSuccess: () => invalidate(queryClient, kind)
  });
}

export function useDeletePreset(kind: PresetKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePreset(id),
    onSuccess: () => invalidate(queryClient, kind)
  });
}
