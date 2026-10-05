import { useEffect, useRef } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { generateThumbnail } from "../lib/thumbnail";
import { uploadThumb, type GalleryPage } from "../lib/api";
import { GALLERY_QUERY_KEY } from "./useGallery";

export interface ThumbnailBackfillItem {
  id: string;
  url: string;
  thumb_url: string | null;
}

const CONCURRENCY = 2;

// 会话级去重：已尝试过的 id 不再重复生成/上传（含失败），避免死循环重试。
const processed = new Set<string>();
// 当前正在处理的 id，避免并发 worker 重复领取同一项。
const inFlight = new Set<string>();

// useGallery 是 useInfiniteQuery：遍历 pages[].items，把对应项的 thumb_url 补上。
function patchGalleryThumb(data: unknown, id: string, thumbUrl: string): unknown {
  if (!data || typeof data !== "object") return data;
  const infinite = data as InfiniteData<GalleryPage>;
  if (!Array.isArray(infinite.pages)) return data;

  let changed = false;
  const pages = infinite.pages.map((page) => {
    if (!page || !Array.isArray(page.items)) return page;
    let pageChanged = false;
    const items = page.items.map((item) => {
      if (item.id !== id || item.thumb_url === thumbUrl) return item;
      pageChanged = true;
      return { ...item, thumb_url: thumbUrl };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, items };
  });

  return changed ? { ...infinite, pages } : data;
}

/**
 * 为「自己可管理」的图片在浏览器生成缩略图并上传。
 * 仅应在 scope=mine 时 enabled=true；朋友的公开图不上传（后端归属校验会 404）。
 * 成功后局部更新 react-query 缓存中的 thumb_url，不整表 invalidate，避免抖动。
 */
export function useThumbnailBackfill(items: ThumbnailBackfillItem[], enabled: boolean): void {
  const queryClient = useQueryClient();
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const cancelledRef = useRef(false);

  // 卸载或禁用时置位，worker 循环据此停止。
  useEffect(() => {
    cancelledRef.current = !enabled;
    return () => {
      cancelledRef.current = true;
    };
  }, [enabled]);

  const pendingKey = items
    .filter((item) => item.thumb_url == null && !processed.has(item.id) && !inFlight.has(item.id))
    .map((item) => item.id)
    .join("|");

  useEffect(() => {
    if (!enabled || !pendingKey) return;

    const pending = itemsRef.current.filter(
      (item) => item.thumb_url == null && !processed.has(item.id) && !inFlight.has(item.id)
    );
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (!cancelledRef.current) {
        const index = cursor++;
        if (index >= pending.length) return;
        const item = pending[index];
        if (item.thumb_url != null || processed.has(item.id) || inFlight.has(item.id)) continue;

        inFlight.add(item.id);
        try {
          const thumb = await generateThumbnail(item.url);
          if (thumb && !cancelledRef.current) {
            try {
              const res = await uploadThumb(item.id, thumb.dataUrl, thumb.mime);
              if (res?.thumb_url && !cancelledRef.current) {
                queryClient.setQueriesData({ queryKey: GALLERY_QUERY_KEY }, (old) =>
                  patchGalleryThumb(old, item.id, res.thumb_url)
                );
              }
            } catch {
              // 上传失败静默忽略（无归属 / 网络问题等）。
            }
          }
        } finally {
          inFlight.delete(item.id);
          if (!cancelledRef.current) processed.add(item.id);
        }
      }
    };

    void Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker())
    );
  }, [enabled, pendingKey, queryClient]);
}
