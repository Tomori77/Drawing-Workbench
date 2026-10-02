import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData
} from "@tanstack/react-query";
import {
  clearGallery,
  deleteAsset,
  listGallery,
  uploadThumb,
  type GalleryPage
} from "../lib/api";

export const GALLERY_QUERY_KEY = ["gallery"] as const;
export const GALLERY_PAGE_SIZE = 24;

export function useGallery(limit = GALLERY_PAGE_SIZE) {
  return useInfiniteQuery<GalleryPage, Error, InfiniteData<GalleryPage>, readonly unknown[], number>({
    queryKey: [...GALLERY_QUERY_KEY, limit],
    staleTime: 30_000,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listGallery({ limit, offset: pageParam }),
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.items.length, 0);
      if (loaded >= lastPage.total || lastPage.items.length === 0) return undefined;
      return loaded;
    }
  });
}

export function useDeleteAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAsset(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GALLERY_QUERY_KEY });
    }
  });
}

export function useClearGallery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => clearGallery(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GALLERY_QUERY_KEY });
    }
  });
}

export function useUploadThumb() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, image, mime }: { id: string; image: string; mime?: string }) =>
      uploadThumb(id, image, mime),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GALLERY_QUERY_KEY });
    }
  });
}
