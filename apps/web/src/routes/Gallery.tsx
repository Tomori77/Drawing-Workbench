import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { useAuth } from "../hooks/useAuth";
import {
  useClearGallery,
  useDeleteAsset,
  useGallery,
  useGalleryMeta,
  useGalleryOverview,
  useSetAssetPublic
} from "../hooks/useGallery";
import { useThumbnailBackfill } from "../hooks/useThumbnailBackfill";
import type { GalleryItem, GalleryMeta } from "../lib/api";
import { actionTabs, gallerySorts, modelOptions, noiseScheduleOptions, samplerOptions } from "../lib/mock";
import { IconClose, IconLogo, IconSearch } from "../components/icons";
import Lightbox from "../components/Lightbox";
import ConfirmDialog from "../components/ConfirmDialog";

function formatSize(item: Pick<GalleryItem, "width" | "height">): string {
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

function paramText(params: Record<string, unknown>, key: string): string {
  return paramTextOrNull(params[key]) ?? "—";
}

function paramTextOrNull(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function metaSize(meta: GalleryMeta): string {
  if (meta.width && meta.height) return `${meta.width}×${meta.height}`;
  return "—";
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-(--color-border) py-2 last:border-b-0">
      <span className="shrink-0 text-xs text-(--color-muted)">{label}</span>
      <span className="break-all text-right text-xs text-(--color-text)">{value}</span>
    </div>
  );
}

function PromptBlock({
  label,
  value,
  onCopy
}: {
  label: string;
  value: string;
  onCopy: (value: string) => void;
}) {
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-(--color-muted)">{label}</span>
        <button
          type="button"
          disabled={!value}
          onClick={() => onCopy(value)}
          className="rounded-full border border-(--color-border) px-2 py-0.5 text-[11px] text-(--color-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-40"
        >
          复制
        </button>
      </div>
      <p className="max-h-32 overflow-y-auto rounded-(--radius-input) bg-(--color-surface-2) px-3 py-2 text-xs leading-relaxed break-words whitespace-pre-wrap text-(--color-text)">
        {value || "—"}
      </p>
    </div>
  );
}

function labelFor(options: { value: string; label: string }[], value: string | null): string {
  if (!value) return "—";
  return options.find((option) => option.value === value)?.label ?? value;
}

export default function Gallery() {
  const navigate = useNavigate();
  const { data: auth } = useAuth();
  const isOwner = auth?.role === "owner";
  const [sort, setSort] = useState(gallerySorts[0].value);
  const [sidFilter, setSidFilter] = useState("all");
  const [tab, setTab] = useState<"mine" | "public">("mine");
  const overviewQuery = useGalleryOverview(isOwner);
  const mineQuery = useGallery(sidFilter === "all" ? undefined : sidFilter, "mine");
  const publicQuery = useGallery(undefined, "public");
  const activeQuery = tab === "mine" ? mineQuery : publicQuery;
  const deleteMutation = useDeleteAsset();
  const publishMutation = useSetAssetPublic();
  const clearMutation = useClearGallery();
  const [lightbox, setLightbox] = useState<GalleryItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GalleryItem | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [menu, setMenu] = useState<{ item: GalleryItem; x: number; y: number; mine: boolean } | null>(null);
  const [metaId, setMetaId] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const metaQuery = useGalleryMeta(metaId);
  const meta = metaQuery.data;

  useEffect(() => {
    if (!copyNotice) return;
    const timer = setTimeout(() => setCopyNotice(null), 1800);
    return () => clearTimeout(timer);
  }, [copyNotice]);

  const copyText = (value: string) => {
    if (!value) return;
    void navigator.clipboard?.writeText(value).then(
      () => setCopyNotice("已复制"),
      () => setCopyNotice("复制失败")
    );
  };

  const reproduce = () => {
    if (!meta) return;
    navigate("/console/playground", { state: { reproduce: meta } });
  };

  const items = (activeQuery.data?.pages ?? []).flatMap((page) => page.items);
  // 「我的作品」才回填缩略图；公开区含他人图片，上传接口会因归属校验 404。
  useThumbnailBackfill(items, tab === "mine");
  const total = activeQuery.data?.pages[0]?.total ?? 0;
  const overview = overviewQuery.data?.items ?? [];
  const clearingSid = sidFilter === "all" ? undefined : sidFilter;

  const labelForSid = (sid: string): string => {
    if (sid === "owner") return "所有者";
    return overview.find((row) => row.sid === sid)?.label ?? sid;
  };

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
          <div className="mb-5 flex justify-center">
            <Tabs.Root value={tab} onValueChange={(value) => setTab(value as "mine" | "public")}>
              <Tabs.List className="inline-flex items-center gap-1 rounded-full bg-(--color-surface-1) p-1 shadow-(--shadow-card)">
                <Tabs.Trigger
                  value="mine"
                  className="rounded-full px-5 py-1.5 text-sm text-(--color-muted) transition-colors data-[state=active]:bg-(--color-text) data-[state=active]:font-medium data-[state=active]:text-white"
                >
                  我的作品
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="public"
                  className="rounded-full px-5 py-1.5 text-sm text-(--color-muted) transition-colors data-[state=active]:bg-(--color-text) data-[state=active]:font-medium data-[state=active]:text-white"
                >
                  公开作品
                </Tabs.Trigger>
              </Tabs.List>
            </Tabs.Root>
          </div>

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
              {tab === "mine" && isOwner && overview.length > 0 && (
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
              {tab === "mine" && (
                <button
                  type="button"
                  disabled={items.length === 0}
                  onClick={() => setConfirmClear(true)}
                  className="rounded-full border border-(--color-border) px-3.5 py-1.5 text-xs text-(--color-muted) transition-colors hover:border-(--color-warning)/50 hover:text-(--color-warning) disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {clearingSid ? "清空该画廊" : "清空画廊"}
                </button>
              )}
            </div>
          </div>

          {activeQuery.isLoading ? (
            <div className="flex flex-col items-center justify-center rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) py-24 text-center">
              <p className="text-sm text-(--color-muted)">加载中…</p>
            </div>
          ) : activeQuery.isError ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) py-24 text-center">
              <p className="text-sm text-(--color-warning)">加载失败：{activeQuery.error.message}</p>
              <button
                type="button"
                onClick={() => activeQuery.refetch()}
                className="rounded-full border border-(--color-border) px-4 py-1.5 text-sm transition-colors hover:border-(--color-border-strong)"
              >
                重试
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) py-24 text-center">
              {tab === "public" ? (
                <p className="text-sm text-(--color-muted)">还没有公开作品。</p>
              ) : (
                <>
                  <p className="text-sm text-(--color-muted)">画廊还是空的，去创作台生成第一张作品吧。</p>
                  <Link
                    to="/console/playground"
                    className="mt-4 inline-flex h-9 items-center rounded-full bg-(--color-primary) px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
                  >
                    打开创作台
                  </Link>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((item) => (
                  <article
                    key={item.id}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ item, x: e.clientX, y: e.clientY, mine: tab === "mine" });
                    }}
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
                        {item.is_public
                          ? "公开"
                          : auth?.role === "owner"
                            ? "私有"
                            : "仅自己可见"}
                      </span>
                    </button>
                    <div className="flex items-center justify-between gap-2 p-3.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs text-(--color-muted-2)">
                          <span>{formatSize(item)}</span>
                        </div>
                        <p className="mt-1 truncate text-[11px] text-(--color-muted-2)">
                          {tab === "public"
                            ? `${labelForSid(item.owner_sid ?? "owner")} · ${formatTime(item.created_at)}`
                            : formatTime(item.created_at)}
                        </p>
                      </div>
                      {tab === "mine" && (
                        <button
                          type="button"
                          aria-label="删除作品"
                          onClick={() => setPendingDelete(item)}
                          className="shrink-0 rounded-full border border-(--color-border) px-2.5 py-1 text-[11px] text-(--color-muted) opacity-0 transition-opacity group-hover:opacity-100 hover:border-(--color-warning)/50 hover:text-(--color-warning) focus-visible:opacity-100"
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>

              {activeQuery.hasNextPage && (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    disabled={activeQuery.isFetchingNextPage}
                    onClick={() => activeQuery.fetchNextPage()}
                    className="inline-flex h-10 items-center rounded-full border border-(--color-border) bg-(--color-surface-1) px-6 text-sm transition-colors hover:border-(--color-border-strong) disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {activeQuery.isFetchingNextPage ? "加载中…" : "加载更多"}
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

      <DropdownMenu.Root open={menu !== null} onOpenChange={(open) => !open && setMenu(null)}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="pointer-events-none fixed size-0"
            style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            className="z-50 min-w-40 rounded-(--radius-input) border border-(--color-border) bg-(--color-surface-1) p-1 shadow-(--shadow-float)"
          >
            <DropdownMenu.Item
              onSelect={() => {
                if (menu) setMetaId(menu.item.id);
              }}
              className="flex cursor-pointer items-center rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-(--color-surface-2)"
            >
              查看信息
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => {
                if (menu) setLightbox(menu.item);
              }}
              className="flex cursor-pointer items-center rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-(--color-surface-2)"
            >
              放大
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <a
                href={menu?.item.url ?? "#"}
                download
                className="flex cursor-pointer items-center rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-(--color-surface-2)"
              >
                下载
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-(--color-border)" />
            {menu?.mine && (
              <>
                <DropdownMenu.Item
                  onSelect={() => {
                    if (menu) {
                      publishMutation.mutate({ id: menu.item.id, isPublic: !menu.item.is_public });
                    }
                  }}
                  className="flex cursor-pointer items-center rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-(--color-surface-2)"
                >
                  {menu.item.is_public ? "取消公开" : "公开"}
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-(--color-border)" />
                <DropdownMenu.Item
                  onSelect={() => {
                    if (menu) setPendingDelete(menu.item);
                  }}
                  className="flex cursor-pointer items-center rounded-lg px-2.5 py-2 text-sm text-(--color-warning) outline-none data-[highlighted]:bg-(--color-surface-2)"
                >
                  删除
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Dialog.Root
        open={metaId !== null}
        onOpenChange={(open) => {
          if (!open) setMetaId(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[88dvh] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) shadow-(--shadow-float) outline-none">
            <div className="flex shrink-0 items-center justify-between border-b border-(--color-border) px-5 py-3">
              <Dialog.Title className="text-sm font-semibold">图片信息</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="关闭"
                  className="flex size-8 items-center justify-center rounded-(--radius-input) text-(--color-muted) transition-colors hover:bg-(--color-surface-2)"
                >
                  <IconClose className="size-4.5" />
                </button>
              </Dialog.Close>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {metaQuery.isLoading ? (
                <p className="py-8 text-center text-sm text-(--color-muted)">加载中…</p>
              ) : metaQuery.isError ? (
                <p className="py-8 text-center text-sm text-(--color-warning)">
                  加载失败：{metaQuery.error.message}
                </p>
              ) : meta ? (
                <>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-(--color-muted)">
                    <span>{metaSize(meta)}</span>
                    <span>{meta.mime ?? "未知格式"}</span>
                    <span>{formatTime(meta.created_at)}</span>
                  </div>

                  <div className="mt-3">
                    <MetaRow label="模型" value={labelFor(modelOptions, meta.model)} />
                    <MetaRow label="动作" value={labelFor(actionTabs, meta.action)} />
                    <MetaRow label="采样器" value={labelFor(samplerOptions, paramTextOrNull(meta.params.sampler))} />
                    <MetaRow label="噪声调度" value={labelFor(noiseScheduleOptions, paramTextOrNull(meta.params.noise_schedule))} />
                    <MetaRow label="步数" value={paramText(meta.params, "steps")} />
                    <MetaRow label="提示词引导" value={paramText(meta.params, "scale")} />
                    <MetaRow label="种子" value={paramText(meta.params, "seed")} />
                    <MetaRow label="尺寸" value={metaSize(meta)} />
                    <MetaRow label="张数" value={meta.n !== null ? String(meta.n) : "—"} />
                    <MetaRow label="上游" value={meta.upstream_id ?? "—"} />
                    <MetaRow label="成本" value={meta.cost_gems !== null ? `${meta.cost_gems} Gems` : "—"} />
                    <MetaRow label="状态" value={meta.is_public ? "公开" : "私密"} />
                    <MetaRow label="创建时间" value={formatTime(meta.created_at)} />
                  </div>

                  <PromptBlock label="提示词" value={meta.prompt.positive} onCopy={copyText} />
                  <PromptBlock label="负面提示词" value={meta.prompt.negative} onCopy={copyText} />
                </>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-(--color-border) px-5 py-3">
              <span className="text-xs text-(--color-success)">{copyNotice ?? ""}</span>
              <div className="flex items-center gap-2">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center rounded-full border border-(--color-border) px-4 text-sm transition-colors hover:border-(--color-border-strong)"
                  >
                    关闭
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  disabled={!meta}
                  onClick={reproduce}
                  className="inline-flex h-9 items-center rounded-full bg-(--color-primary) px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  复现
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
