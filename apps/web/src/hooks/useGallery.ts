import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData
} from "@tanstack/react-query";
import {
  clearGallery,
  deleteAsset,
  getGalleryMeta,
  getGalleryOverview,
  listGallery,
  setAssetPublic,
  uploadThumb,
  type GalleryMeta,
  type GalleryOverviewResponse,
  type GalleryPage
} from "../lib/api";

export const GALLERY_QUERY_KEY = ["gallery"] as const;
export const GALLERY_PAGE_SIZE = 24;

export function useGallery(
  sid?: string,
  scope: "mine" | "public" = "mine",
  limit = GALLERY_PAGE_SIZE
) {
  return useInfiniteQuery<GalleryPage, Error, InfiniteData<GalleryPage>, readonly unknown[], number>({
    queryKey: [...GALLERY_QUERY_KEY, scope, sid ?? "all", limit],
    staleTime: 30_000,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listGallery({ limit, offset: pageParam, sid, scope }),
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.items.length, 0);
      if (loaded >= lastPage.total || lastPage.items.length === 0) return undefined;
      return loaded;
    }
  });
}

export function useGalleryOverview(enabled = true) {
  return useQuery<GalleryOverviewResponse>({
    queryKey: [...GALLERY_QUERY_KEY, "overview"],
    queryFn: () => getGalleryOverview(),
    staleTime: 30_000,
    enabled
  });
}

export function useGalleryMeta(id: string | null) {
  return useQuery<GalleryMeta>({
    queryKey: [...GALLERY_QUERY_KEY, "meta", id ?? ""],
    queryFn: () => getGalleryMeta(id as string),
    staleTime: 30_000,
    enabled: !!id
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

export function useSetAssetPublic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isPublic }: { id: string; isPublic: boolean }) =>
      setAssetPublic(id, isPublic),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GALLERY_QUERY_KEY });
    }
  });
}

export function useClearGallery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sid?: string) => clearGallery(sid),
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
