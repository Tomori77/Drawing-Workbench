import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getProfile, updateProfile, type Profile, type ProfilePatch } from "../lib/api";

export const PROFILE_QUERY_KEY = ["profile"] as const;

export function useProfile(enabled = true) {
  return useQuery<Profile>({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: () => getProfile(),
    enabled
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfilePatch) => updateProfile(patch),
    onSuccess: (data) => {
      queryClient.setQueryData(PROFILE_QUERY_KEY, data);
    }
  });
}
