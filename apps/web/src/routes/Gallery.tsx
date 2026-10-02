import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import {
  useClearGallery,
  useDeleteAsset,
  useGallery,
  useGalleryOverview
} from "../hooks/useGallery";
import type { GalleryItem } from "../lib/api";
import { gallerySorts } from "../lib/mock";
import { IconLogo, IconSearch } from "../components/icons";
import Lightbox from "../components/Lightbox";
import ConfirmDialog from "../components/ConfirmDialog";

function formatSize(item: GalleryItem): string {
  if (item.width && item.height) return `${item.width}×${item.height}`;
  return "尺寸未知";
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export default function Gallery() {
  const { data: auth } = useAuth();
  const isOwner = auth?.role === "owner";
  const [sort, setSort] = useState(gallerySorts[0].value);
  const [sidFilter, setSidFilter] = useState("all");
  const overviewQuery = useGalleryOverview(isOwner);
  const galleryQuery = useGallery(sidFilter === "all" ? undefined : sidFilter);
  const deleteMutation = useDeleteAsset();
  const clearMutation = useClearGallery();
  const [lightbox, setLightbox] = useState<GalleryItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GalleryItem | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const items = (galleryQuery.data?.pages ?? []).flatMap((page) => page.items);
  const total = galleryQuery.data?.pages[0]?.total ?? 0;
  const overview = overviewQuery.data?.items ?? [];
  const clearingSid = sidFilter === "all" ? undefined : sidFilter;

  return (
    <div className="flex min-h-dvh flex-col bg-(--color-bg)">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-6 border-b border-(--color-border) bg-white/70 px-4 backdrop-blur-xl sm:px-8">
        <Link to="/console" className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-(--color-text) text-white">
            <IconLogo className="size-4.5" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Drawing Workbench</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-(--color-muted) md:flex">
          <Link to="/console" className="transition-colors hover:text-(--color-text)">
            主页
          </Link>
          <Link to="/gallery" className="font-medium text-(--color-text)">
            画廊
          </Link>
        </nav>
        <Link
          to="/console"
          className="ml-auto inline-flex h-9 items-center rounded-full border border-(--color-border) bg-(--color-surface-1) px-4 text-sm transition-colors hover:border-(--color-border-strong)"
        >
          返回控制台
        </Link>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-5 pt-16 pb-8 text-center sm:pt-20">
          <h1 className="text-[40px] font-semibold tracking-tight">画廊</h1>
          <p className="mt-3 text-[17px] text-(--color-muted)">个人作品集。</p>
          <div className="relative mx-auto mt-8 max-w-xl">
            <IconSearch className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-(--color-muted-2)" />
            <input
              disabled
              placeholder="搜索暂未开放"
              className="h-12 w-full cursor-not-allowed rounded-full border border-(--color-border) bg-(--color-surface-1) pr-4 pl-11 text-sm outline-none placeholder:text-(--color-muted-2)"
            />
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1180px] px-5 pb-24 sm:px-8">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="inline-flex items-center gap-1 rounded-full bg-(--color-surface-1) p-1 shadow-(--shadow-card)">
              {gallerySorts.map((option) => {
                const disabled = option.value !== "latest";
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={disabled}
                    title={disabled ? "后端暂不支持该排序" : undefined}
                    onClick={() => !disabled && setSort(option.value)}
                    className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                      sort === option.value
                        ? "bg-(--color-text) font-medium text-white"
                        : disabled
                          ? "cursor-not-allowed text-(--color-muted-2)/60"
                          : "text-(--color-muted) hover:text-(--color-text)"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {isOwner && overview.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-(--color-muted)">
                  <span>画廊</span>
                  <select
                    value={sidFilter}
                    onChange={(e) => setSidFilter(e.target.value)}
                    className="h-9 rounded-full border border-(--color-border) bg-(--color-surface-1) px-3 text-sm outline-none focus:border-(--color-primary)"
                  >
                    <option value="all">全部</option>
                    {overview.map((row) => (
                      <option key={row.sid} value={row.sid}>
                        {row.sid === "owner" ? "所有者" : row.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="text-sm text-(--color-muted-2)">{total} 件作品</p>
              <button
                type="button"
                disabled={items.length === 0}
                onClick={() => setConfirmClear(true)}
                className="rounded-full border border-(--color-border) px-3.5 py-1.5 text-xs text-(--color-muted) transition-colors hover:border-(--color-warning)/50 hover:text-(--color-warning) disabled:cursor-not-allowed disabled:opacity-40"
              >
                {clearingSid ? "清空该画廊" : "清空画廊"}
              </button>
            </div>
          </div>

          {galleryQuery.isLoading ? (
            <div className="flex flex-col items-center justify-center rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) py-24 text-center">
              <p className="text-sm text-(--color-muted)">加载中…</p>
            </div>
          ) : galleryQuery.isError ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) py-24 text-center">
              <p className="text-sm text-(--color-warning)">加载失败：{galleryQuery.error.message}</p>
              <button
                type="button"
                onClick={() => galleryQuery.refetch()}
                className="rounded-full border border-(--color-border) px-4 py-1.5 text-sm transition-colors hover:border-(--color-border-strong)"
              >
                重试
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) py-24 text-center">
              <p className="text-sm text-(--color-muted)">画廊还是空的，去创作台生成第一张作品吧。</p>
              <Link
                to="/console/playground"
                className="mt-4 inline-flex h-9 items-center rounded-full bg-(--color-primary) px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                打开创作台
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((item) => (
                  <article
                    key={item.id}
                    className="group overflow-hidden rounded-(--radius-secondary) border border-(--color-border) bg-(--color-surface-1) shadow-(--shadow-card) transition-transform hover:-translate-y-0.5"
                  >
                    <button
                      type="button"
                      onClick={() => setLightbox(item)}
                      className="relative block aspect-[4/5] w-full bg-(--color-surface-2)"
                    >
                      <img
                        src={item.thumb_url ?? item.url}
                        alt="作品"
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute top-2 left-2 rounded-full bg-black/30 px-2 py-0.5 text-[11px] text-white backdrop-blur">
                        {auth?.role === "owner" ? "私有" : "仅自己可见"}
                      </span>
                    </button>
                    <div className="flex items-center justify-between gap-2 p-3.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs text-(--color-muted-2)">
                          <span>{formatSize(item)}</span>
                        </div>
                        <p className="mt-1 truncate text-[11px] text-(--color-muted-2)">
                          {formatTime(item.created_at)}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label="删除作品"
                        onClick={() => setPendingDelete(item)}
                        className="shrink-0 rounded-full border border-(--color-border) px-2.5 py-1 text-[11px] text-(--color-muted) opacity-0 transition-opacity group-hover:opacity-100 hover:border-(--color-warning)/50 hover:text-(--color-warning) focus-visible:opacity-100"
                      >
                        删除
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              {galleryQuery.hasNextPage && (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    disabled={galleryQuery.isFetchingNextPage}
                    onClick={() => galleryQuery.fetchNextPage()}
                    className="inline-flex h-10 items-center rounded-full border border-(--color-border) bg-(--color-surface-1) px-6 text-sm transition-colors hover:border-(--color-border-strong) disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {galleryQuery.isFetchingNextPage ? "加载中…" : "加载更多"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <Lightbox
        open={lightbox !== null}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
        src={lightbox?.url ?? null}
        alt="作品预览"
        caption={lightbox ? `${formatSize(lightbox)} · ${formatTime(lightbox.created_at)}` : undefined}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="删除这张作品？"
        description="删除后无法恢复。"
        confirmLabel="删除"
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteMutation.mutate(pendingDelete.id, {
            onSuccess: () => setPendingDelete(null)
          });
        }}
      />

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={clearingSid ? "清空该画廊？" : "清空整个画廊？"}
        description={
          clearingSid
            ? "将删除该画廊全部作品与缩略图，且无法恢复。"
            : "将删除全部作品与缩略图，且无法恢复。"
        }
        confirmLabel="清空"
        pending={clearMutation.isPending}
        onConfirm={() => {
          clearMutation.mutate(clearingSid, {
            onSuccess: () => setConfirmClear(false)
          });
        }}
      />
    </div>
  );
}
