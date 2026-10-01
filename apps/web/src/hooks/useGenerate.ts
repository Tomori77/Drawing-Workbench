import { useMutation, useQueryClient } from "@tanstack/react-query";
import { generate, type GenerateParams, type GenerateResult } from "../lib/api";
import { GALLERY_QUERY_KEY } from "./useGallery";

export function useGenerate() {
  const queryClient = useQueryClient();
  return useMutation<GenerateResult, Error, GenerateParams>({
    mutationFn: (body: GenerateParams) => generate(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GALLERY_QUERY_KEY });
    }
  });
}
