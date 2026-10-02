import { useEffect, useState } from "react";
import ConsoleShell from "../components/ConsoleShell";
import ConfirmDialog from "../components/ConfirmDialog";
import {
  DialogActions,
  DialogShell,
  EmptyState,
  EnableToggle,
  Field,
  formatTime,
  inputClass
} from "../components/console-ui";
import { IconPlus } from "../components/icons";
import {
  useCreateSharePassword,
  useDeleteSharePassword,
  useSharePasswords,
  useUpdateSharePassword
} from "../hooks/useSharePasswords";
import { useGalleryOverview } from "../hooks/useGallery";
import type { SharePassword, SharePasswordInput } from "../lib/api";

const MB = 1024 * 1024;

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "不限";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
}

export default function SharePasswords() {
  const listQuery = useSharePasswords();
  const overviewQuery = useGalleryOverview();
  const updateMutation = useUpdateSharePassword();
  const deleteMutation = useDeleteSharePassword();

  const items = listQuery.data?.items ?? [];
  const overview = overviewQuery.data?.items ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SharePassword | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SharePassword | null>(null);

  const openCreate = () => {
    setEditTarget(null);
    setDialogOpen(true);
  };
  const openEdit = (item: SharePassword) => {
    setEditTarget(item);
    setDialogOpen(true);
  };

  return (
    <ConsoleShell>
      <div className="mx-auto w-full max-w-[1280px] px-5 py-10 sm:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">分享密码</h1>
            <p className="mt-1 text-sm text-(--color-muted)">
              每位朋友一组独立密码与独立画廊，互不可见；可分别设置存储配额。
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-(--color-primary) px-5 text-sm font-medium text-white shadow-(--shadow-card) transition-opacity hover:opacity-90"
          >
            <IconPlus className="size-4" />
            新建分享密码
          </button>
        </header>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-(--color-muted)">画廊总览</h2>
          {overviewQuery.isLoading ? (
            <p className="mt-3 text-sm text-(--color-muted-2)">加载中…</p>
          ) : overview.length === 0 ? (
            <p className="mt-3 text-sm text-(--color-muted-2)">暂无数据。</p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) shadow-(--shadow-card)">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-(--color-border) text-left text-xs text-(--color-muted-2)">
                      <th className="px-4 py-3 font-medium">画廊</th>
                      <th className="px-4 py-3 font-medium">角色</th>
                      <th className="px-4 py-3 font-medium text-right">已用</th>
                      <th className="px-4 py-3 font-medium text-right">配额</th>
                      <th className="px-4 py-3 font-medium text-right">图片数</th>
                      <th className="px-4 py-3 font-medium text-right">配方</th>
                      <th className="px-4 py-3 font-medium text-right">画师串</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.map((row) => {
                      const pct =
                        row.quota_bytes && row.quota_bytes > 0
                          ? Math.min(100, Math.round((row.used_bytes / row.quota_bytes) * 100))
                          : null;
                      return (
                        <tr key={row.sid} className="border-b border-(--color-border) last:border-b-0">
                          <td className="px-4 py-3">
                            <div className="font-medium">{row.label}</div>
                            <div className="font-mono text-xs text-(--color-muted-2)">
                              {row.sid === "owner" ? "owner" : `${row.sid.slice(0, 8)}…`}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-(--color-muted)">{row.role}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <div>{formatBytes(row.used_bytes)}</div>
                            {pct !== null && (
                              <div className="mt-1 ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-(--color-surface-2)">
                                <div
                                  className={`h-full rounded-full ${
                                    pct >= 100 ? "bg-(--color-warning)" : "bg-(--color-primary)"
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-(--color-muted)">
                            {formatBytes(row.quota_bytes)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{row.count}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{row.recipe_count}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{row.artist_count}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <section className="mt-8">
          {listQuery.isLoading ? (
            <EmptyState title="加载中…" />
          ) : listQuery.isError ? (
            <div className="flex flex-col items-center gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) py-24 text-center">
              <p className="text-sm text-(--color-warning)">加载失败：{listQuery.error.message}</p>
              <button
                type="button"
                onClick={() => listQuery.refetch()}
                className="rounded-full border border-(--color-border) px-4 py-1.5 text-sm transition-colors hover:border-(--color-border-strong)"
              >
                重试
              </button>
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              title="还没有分享密码"
              description="点击「新建分享密码」，为朋友分配独立画廊与配额。"
            />
          ) : (
            <div className="overflow-hidden rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) shadow-(--shadow-card)">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-(--color-border) text-left text-xs text-(--color-muted-2)">
                      <th className="px-4 py-3 font-medium">备注</th>
                      <th className="px-4 py-3 font-medium">角色</th>
                      <th className="px-4 py-3 font-medium">状态</th>
                      <th className="px-4 py-3 font-medium text-right">已用 / 配额</th>
                      <th className="px-4 py-3 font-medium">创建时间</th>
                      <th className="px-4 py-3 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const toggling =
                        updateMutation.isPending && updateMutation.variables?.id === item.id;
                      return (
                        <tr key={item.id} className="border-b border-(--color-border) last:border-b-0">
                          <td className="px-4 py-3">
                            <div className="font-medium">{item.label || "未命名"}</div>
                            <div className="font-mono text-xs text-(--color-muted-2)">
                              {item.id.slice(0, 8)}…
                            </div>
                          </td>
                          <td className="px-4 py-3 text-(--color-muted)">{item.role}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-xs ${
                                item.enabled
                                  ? "border-(--color-success)/40 text-(--color-success)"
                                  : "border-(--color-border) text-(--color-muted-2)"
                              }`}
                            >
                              {item.enabled ? "启用" : "停用"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatBytes(item.used_bytes ?? 0)} / {formatBytes(item.quota_bytes)}
                          </td>
                          <td className="px-4 py-3 text-xs text-(--color-muted-2)">
                            {formatTime(item.created_at)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <EnableToggle
                                enabled={item.enabled}
                                pending={toggling}
                                onToggle={() =>
                                  updateMutation.mutate({
                                    id: item.id,
                                    patch: { enabled: !item.enabled }
                                  })
                                }
                              />
                              <button
                                type="button"
                                onClick={() => openEdit(item)}
                                className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text)"
                              >
                                编辑
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(item)}
                                className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) transition-colors hover:border-(--color-warning)/50 hover:text-(--color-warning)"
                              >
                                删除
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>

      <SharePasswordDialog
        open={dialogOpen}
        editing={editTarget}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditTarget(null);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除这个分享密码？"
        description={
          deleteTarget
            ? `将删除「${deleteTarget.label || deleteTarget.id}」，该密码立即失效。其画廊图片仍会保留，可在画廊总览中查看并手动清理。`
            : ""
        }
        confirmLabel="删除"
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMutation.mutate(deleteTarget.id, {
            onSuccess: () => setDeleteTarget(null)
          });
        }}
      />
    </ConsoleShell>
  );
}

function SharePasswordDialog({
  open,
  editing,
  onOpenChange
}: {
  open: boolean;
  editing: SharePassword | null;
  onOpenChange: (open: boolean) => void;
}) {
  const createMutation = useCreateSharePassword();
  const updateMutation = useUpdateSharePassword();
  const mutation = editing ? updateMutation : createMutation;

  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [quotaMb, setQuotaMb] = useState("500");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!open) return;
    mutation.reset();
    if (editing) {
      setLabel(editing.label);
      setPassword("");
      setQuotaMb(String(Math.round(editing.quota_bytes / MB)));
      setEnabled(editing.enabled);
    } else {
      setLabel("");
      setPassword("");
      setQuotaMb("500");
      setEnabled(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const submit = () => {
    const quotaBytes = Math.max(0, Math.round((Number(quotaMb) || 0) * MB));
    if (editing) {
      const patch: { label?: string; password?: string; quota_bytes?: number; enabled?: boolean } = {
        label: label.trim(),
        quota_bytes: quotaBytes,
        enabled
      };
      if (password) patch.password = password;
      updateMutation.mutate(
        { id: editing.id, patch },
        { onSuccess: () => onOpenChange(false) }
      );
    } else {
      const body: SharePasswordInput = {
        label: label.trim(),
        password,
        quota_bytes: quotaBytes
      };
      createMutation.mutate(body, { onSuccess: () => onOpenChange(false) });
    }
  };

  const passwordInvalid = !editing && password.length < 4;
  const passwordEditInvalid = Boolean(editing) && password.length > 0 && password.length < 4;

  return (
    <DialogShell
      open={open}
      onOpenChange={(next) => {
        if (!next) mutation.reset();
        onOpenChange(next);
      }}
      title={editing ? "编辑分享密码" : "新建分享密码"}
      description={editing ? "密码留空表示不修改。" : "密码至少 4 位，仅在创建时设置。"}
    >
      <div className="flex flex-col gap-3.5">
        <Field label="备注" hint="可选">
          <input
            className={inputClass}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="给朋友的标识，如「小明」"
          />
        </Field>
        <Field label="密码" hint={editing ? "留空=不改" : "至少 4 位"}>
          <input
            type="password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </Field>
        <Field label="存储配额" hint="MB">
          <input
            type="number"
            min={0}
            className={inputClass}
            value={quotaMb}
            onChange={(e) => setQuotaMb(e.target.value)}
            placeholder="500"
          />
        </Field>
        <Field label="启用">
          <div className="flex h-9 items-center">
            <EnableToggle enabled={enabled} pending={false} onToggle={() => setEnabled((p) => !p)} />
            <span className="ml-3 text-sm text-(--color-muted)">
              {enabled ? "已启用" : "已停用"}
            </span>
          </div>
        </Field>
        <p className="text-xs text-(--color-muted-2)">
          配额统计该画廊「原图 + 缩略图」的 R2 实际字节之和。填 0 表示禁止上传。
        </p>
      </div>

      {mutation.isError && (
        <p className="mt-3 text-sm text-(--color-warning)">
          {editing ? "保存失败" : "创建失败"}：{mutation.error.message}
        </p>
      )}
      <DialogActions
        pending={mutation.isPending}
        disabled={passwordInvalid || passwordEditInvalid}
        confirmLabel={editing ? "保存" : "创建"}
        onCancel={() => {
          mutation.reset();
          onOpenChange(false);
        }}
        onConfirm={submit}
      />
    </DialogShell>
  );
}
