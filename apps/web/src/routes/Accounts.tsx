import { useMemo, useState } from "react";
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
  useAccounts,
  useBatchCreateAccounts,
  useBatchDeleteAccounts,
  useCreateAccount,
  useDeleteAccount,
  useProvisionAll,
  useProvisionToken,
  useRefreshAccountGems,
  useRefreshAllGems,
  useUpdateAccount
} from "../hooks/useAccounts";
import { useUpstreams } from "../hooks/useUpstreams";
import type {
  AccountPublic,
  AccountStatus,
  BatchCreateResult,
  ProvisionAllResult,
  UpstreamPublic
} from "../lib/api";

const STATUS_META: Record<string, { label: string; className: string; dot: string }> = {
  pending: { label: "等待", className: "text-(--color-muted)", dot: "bg-(--color-muted-2)" },
  success: { label: "正常", className: "text-(--color-success)", dot: "bg-(--color-success)" },
  retry: { label: "重试中", className: "text-(--color-warning)", dot: "bg-(--color-warning)" },
  jwt_expired: { label: "JWT 过期", className: "text-(--color-warning)", dot: "bg-(--color-warning)" },
  manual_required: { label: "需人工", className: "text-(--color-warning)", dot: "bg-(--color-warning)" }
};

function statusMeta(status: AccountStatus) {
  return STATUS_META[status] ?? { label: status, className: "text-(--color-muted)", dot: "bg-(--color-muted-2)" };
}

function parseBulk(text: string): Array<{ username: string; password: string }> {
  const out: Array<{ username: string; password: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separators = ["----", "::", ":", ",", "，", "\t", " "];
    for (const sep of separators) {
      const index = trimmed.indexOf(sep);
      if (index > 0 && index < trimmed.length - sep.length) {
        const username = trimmed.slice(0, index).trim();
        const password = trimmed.slice(index + sep.length).trim();
        if (username && password) out.push({ username, password });
        break;
      }
    }
  }
  return out;
}

function UpstreamSelect({
  value,
  onChange,
  upstreams,
  allowAll
}: {
  value: string;
  onChange: (value: string) => void;
  upstreams: UpstreamPublic[];
  allowAll?: boolean;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} pr-8`}>
      {allowAll && <option value="">全部上游</option>}
      {!allowAll && <option value="" disabled>请选择上游</option>}
      {upstreams.map((upstream) => (
        <option key={upstream.id} value={upstream.id}>
          {upstream.name || upstream.id}
        </option>
      ))}
    </select>
  );
}

function CredentialBadges({ account }: { account: AccountPublic }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${account.has_jwt ? "border-(--color-border) text-(--color-muted)" : "border-dashed border-(--color-border-strong) text-(--color-muted-2)"}`}>
        JWT
      </span>
      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${account.has_password ? "border-(--color-border) text-(--color-muted)" : "border-dashed border-(--color-border-strong) text-(--color-muted-2)"}`}>
        密码
      </span>
      <span
        className={`rounded-full border px-2 py-0.5 text-[11px] ${
          account.has_api_token
            ? "border-(--color-border) text-(--color-muted)"
            : "border-(--color-warning)/50 bg-(--color-warning)/10 font-medium text-(--color-warning)"
        }`}
        title={account.has_api_token ? "已配置 API Token" : "缺少 API Token，网关调用可能失败"}
      >
        {account.has_api_token ? "Token" : "缺 Token"}
      </span>
    </div>
  );
}

export default function Accounts() {
  const [upstreamFilter, setUpstreamFilter] = useState("");
  const accountsQuery = useAccounts(upstreamFilter || undefined);
  const upstreamsQuery = useUpstreams();

  const upstreams = upstreamsQuery.data?.items ?? [];
  const upstreamNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const upstream of upstreams) map.set(upstream.id, upstream.name || upstream.id);
    return map;
  }, [upstreams]);

  const items = accountsQuery.data?.items ?? [];
  const totalGems = accountsQuery.data?.total_gems ?? 0;

  const refreshAllMutation = useRefreshAllGems();
  const refreshOneMutation = useRefreshAccountGems();
  const provisionMutation = useProvisionToken();
  const provisionAllMutation = useProvisionAll();
  const updateMutation = useUpdateAccount();
  const deleteMutation = useDeleteAccount();
  const batchDeleteMutation = useBatchDeleteAccounts();

  const [addOpen, setAddOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AccountPublic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountPublic | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [provisionResult, setProvisionResult] = useState<ProvisionAllResult | null>(null);
  const [provisionDetailOpen, setProvisionDetailOpen] = useState(false);

  const selectableIds = useMemo(() => items.map((account) => account.id), [items]);
  const selectedIds = useMemo(
    () => selectableIds.filter((id) => selected.has(id)),
    [selectableIds, selected]
  );
  const allSelected = selectableIds.length > 0 && selectedIds.length === selectableIds.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (selectableIds.length > 0 && selectableIds.every((id) => next.has(id))) {
        for (const id of selectableIds) next.delete(id);
      } else {
        for (const id of selectableIds) next.add(id);
      }
      return next;
    });
  };

  const runProvisionAll = () => {
    if (selectedIds.length === 0) return;
    setProvisionResult(null);
    provisionAllMutation.mutate(
      { ids: selectedIds },
      { onSuccess: (data) => setProvisionResult(data) }
    );
  };

  const noUpstreams = !upstreamsQuery.isLoading && upstreams.length === 0;

  return (
    <ConsoleShell>
      <div className="mx-auto w-full max-w-[1280px] px-5 py-10 sm:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">账号池</h1>
            <p className="mt-1 text-sm text-(--color-muted)">
              管理上游账号，查看余额与凭据状态。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-10 items-center gap-2 rounded-full border border-(--color-border) bg-(--color-surface-1) px-4">
              <span className="text-xs text-(--color-muted)">合计 Gems</span>
              <span className="text-sm font-semibold tabular-nums">{totalGems}</span>
            </div>
            <button
              type="button"
              disabled={refreshAllMutation.isPending || items.length === 0}
              onClick={() => refreshAllMutation.mutate()}
              className="inline-flex h-10 items-center rounded-full border border-(--color-border) bg-(--color-surface-1) px-4 text-sm transition-colors hover:border-(--color-border-strong) disabled:cursor-not-allowed disabled:opacity-50"
            >
              {refreshAllMutation.isPending ? "刷新中…" : "刷新全部余额"}
            </button>
            <button
              type="button"
              disabled={noUpstreams}
              onClick={() => setAddOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-(--color-primary) px-5 text-sm font-medium text-white shadow-(--shadow-card) transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconPlus className="size-4" />
              添加账号
            </button>
          </div>
        </header>

        {refreshAllMutation.data && (
          <p className="mt-4 text-sm text-(--color-muted)">
            刷新完成：成功 {refreshAllMutation.data.refreshed} · 失败 {refreshAllMutation.data.failed} · 合计{" "}
            {refreshAllMutation.data.total_gems} Gems
          </p>
        )}
        {refreshAllMutation.isError && (
          <p className="mt-4 text-sm text-(--color-warning)">
            刷新失败：{refreshAllMutation.error.message}
          </p>
        )}
        {provisionMutation.isSuccess && (
          <p className="mt-4 text-sm text-(--color-success)">生图 Token 已获取并保存。</p>
        )}
        {provisionMutation.isError && (
          <p className="mt-4 text-sm text-(--color-warning)">
            获取生图 Token 失败：{provisionMutation.error.message}
          </p>
        )}
        {provisionAllMutation.isError && (
          <p className="mt-4 text-sm text-(--color-warning)">
            批量获取 Token 失败：{provisionAllMutation.error.message}
          </p>
        )}
        {provisionResult && (
          <div className="mt-4 rounded-(--radius-input) border border-(--color-border) bg-(--color-surface-2) p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="text-(--color-muted)">
                共 {provisionResult.total} 个 · 新建{" "}
                <span className="font-semibold text-(--color-success)">{provisionResult.success}</span> ·
                复用 <span className="font-semibold">{provisionResult.skipped ?? 0}</span> ·
                失败 <span className="font-semibold text-(--color-warning)">{provisionResult.failed}</span>
              </span>
              {provisionResult.failed > 0 && (
                <button
                  type="button"
                  onClick={() => setProvisionDetailOpen((prev) => !prev)}
                  className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text)"
                >
                  {provisionDetailOpen ? "收起失败原因" : "展开失败原因"}
                </button>
              )}
            </div>
            {provisionDetailOpen && (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
                {provisionResult.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-2">
                    <span className={item.ok ? "text-(--color-success)" : "text-(--color-warning)"}>
                      {item.skipped ? "复用" : item.ok ? "新建" : "失败"}
                    </span>
                    <span className="truncate text-(--color-muted)">{item.username}</span>
                    {!item.ok && item.error && (
                      <span className="truncate text-(--color-muted-2)" title={item.error}>
                        {item.error}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="w-56">
            <UpstreamSelect
              value={upstreamFilter}
              onChange={setUpstreamFilter}
              upstreams={upstreams}
              allowAll
            />
          </div>
          <button
            type="button"
            disabled={noUpstreams}
            onClick={() => setBatchOpen(true)}
            className="inline-flex h-9 items-center rounded-full border border-(--color-border) bg-(--color-surface-1) px-4 text-sm transition-colors hover:border-(--color-border-strong) disabled:cursor-not-allowed disabled:opacity-50"
          >
            批量导入
          </button>
          <button
            type="button"
            disabled={selectedIds.length === 0 || provisionAllMutation.isPending}
            onClick={runProvisionAll}
            className="inline-flex h-9 items-center rounded-full border border-(--color-border) bg-(--color-surface-1) px-4 text-sm transition-colors hover:border-(--color-border-strong) disabled:cursor-not-allowed disabled:opacity-50"
          >
            {provisionAllMutation.isPending ? "获取中…" : `批量获取 Token（${selectedIds.length}）`}
          </button>
          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => setBatchDeleteOpen(true)}
            className="inline-flex h-9 items-center rounded-full border border-(--color-border) bg-(--color-surface-1) px-4 text-sm text-(--color-muted) transition-colors hover:border-(--color-warning)/50 hover:text-(--color-warning) disabled:cursor-not-allowed disabled:opacity-50"
          >
            {`批量删除（${selectedIds.length}）`}
          </button>
        </div>

        <section className="mt-6">
          {noUpstreams ? (
            <EmptyState title="还没有上游" description="请先在（未来的）上游管理中创建上游，再添加账号。" />
          ) : accountsQuery.isLoading ? (
            <EmptyState title="加载中…" />
          ) : accountsQuery.isError ? (
            <div className="flex flex-col items-center gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) py-24 text-center">
              <p className="text-sm text-(--color-warning)">加载失败：{accountsQuery.error.message}</p>
              <button
                type="button"
                onClick={() => accountsQuery.refetch()}
                className="rounded-full border border-(--color-border) px-4 py-1.5 text-sm transition-colors hover:border-(--color-border-strong)"
              >
                重试
              </button>
            </div>
          ) : items.length === 0 ? (
            <EmptyState title="还没有账号" description="点击「添加账号」或「批量导入」开始。" />
          ) : (
            <div className="overflow-hidden rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) shadow-(--shadow-card)">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-(--color-border) text-left text-xs text-(--color-muted-2)">
                      <th className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label="全选账号"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected;
                          }}
                          onChange={toggleAll}
                          className="size-4 cursor-pointer accent-(--color-primary)"
                        />
                      </th>
                      <th className="px-4 py-3 font-medium">账号</th>
                      <th className="px-4 py-3 font-medium">上游</th>
                      <th className="px-4 py-3 font-medium">状态</th>
                      <th className="px-4 py-3 font-medium text-right">Gems</th>
                      <th className="px-4 py-3 font-medium text-right">失败</th>
                      <th className="px-4 py-3 font-medium">冷却到期</th>
                      <th className="px-4 py-3 font-medium">凭据</th>
                      <th className="px-4 py-3 font-medium">启用</th>
                      <th className="px-4 py-3 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((account) => {
                      const meta = statusMeta(account.status);
                      const refreshing =
                        refreshOneMutation.isPending && refreshOneMutation.variables === account.id;
                      const toggling =
                        updateMutation.isPending && updateMutation.variables?.id === account.id;
                      const provisioning =
                        provisionMutation.isPending && provisionMutation.variables === account.id;
                      return (
                        <tr key={account.id} className="border-b border-(--color-border) last:border-b-0">
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              aria-label={`选择账号 ${account.label || account.username}`}
                              checked={selected.has(account.id)}
                              onChange={() => toggleOne(account.id)}
                              className="size-4 cursor-pointer accent-(--color-primary)"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium">{account.label || account.username}</div>
                            <div className="text-xs text-(--color-muted-2)">{account.username}</div>
                          </td>
                          <td className="px-4 py-3 text-(--color-muted)">
                            {upstreamNames.get(account.upstream_id) ?? account.upstream_id}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 ${meta.className}`}>
                              <span className={`size-1.5 rounded-full ${meta.dot}`} />
                              {meta.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {account.gems_last ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{account.failure_count}</td>
                          <td className="px-4 py-3 text-xs text-(--color-muted-2)">
                            {formatTime(account.cooldown_until)}
                          </td>
                          <td className="px-4 py-3">
                            <CredentialBadges account={account} />
                          </td>
                          <td className="px-4 py-3">
                            <EnableToggle
                              enabled={account.enabled}
                              pending={toggling}
                              onToggle={() =>
                                updateMutation.mutate({
                                  id: account.id,
                                  patch: { enabled: !account.enabled }
                                })
                              }
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                disabled={provisioning}
                                onClick={() => provisionMutation.mutate(account.id)}
                                className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                  account.has_api_token
                                    ? "border-(--color-border) text-(--color-muted) hover:border-(--color-border-strong) hover:text-(--color-text)"
                                    : "border-(--color-warning)/50 bg-(--color-warning)/10 font-medium text-(--color-warning) hover:border-(--color-warning)"
                                }`}
                              >
                                {provisioning ? "获取中…" : "获取生图 Token"}
                              </button>
                              <button
                                type="button"
                                disabled={refreshing}
                                onClick={() => refreshOneMutation.mutate(account.id)}
                                className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {refreshing ? "刷新中…" : "刷新余额"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditTarget(account)}
                                className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text)"
                              >
                                编辑
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(account)}
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

      <AddAccountDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        upstreams={upstreams}
        defaultUpstream={upstreamFilter}
      />
      <BatchImportDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        upstreams={upstreams}
        defaultUpstream={upstreamFilter}
      />
      <EditAccountDialog
        account={editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除这个账号？"
        description={deleteTarget ? `将删除账号「${deleteTarget.label || deleteTarget.username}」，此操作无法恢复。` : ""}
        confirmLabel="删除"
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMutation.mutate(deleteTarget.id, {
            onSuccess: () => setDeleteTarget(null)
          });
        }}
      />

      <ConfirmDialog
        open={batchDeleteOpen}
        onOpenChange={setBatchDeleteOpen}
        title="批量删除账号？"
        description={`将删除选中的 ${selectedIds.length} 个账号，此操作无法恢复。`}
        confirmLabel="删除"
        pending={batchDeleteMutation.isPending}
        onConfirm={() => {
          batchDeleteMutation.mutate(selectedIds, {
            onSuccess: () => {
              setSelected(new Set());
              setBatchDeleteOpen(false);
            }
          });
        }}
      />
    </ConsoleShell>
  );
}

function AddAccountDialog({
  open,
  onOpenChange,
  upstreams,
  defaultUpstream
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  upstreams: UpstreamPublic[];
  defaultUpstream: string;
}) {
  const [upstreamId, setUpstreamId] = useState(defaultUpstream);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [label, setLabel] = useState("");
  const mutation = useCreateAccount();

  const reset = () => {
    setUpstreamId(defaultUpstream);
    setUsername("");
    setPassword("");
    setApiToken("");
    setLabel("");
  };

  const close = (next: boolean) => {
    if (!next) {
      reset();
      mutation.reset();
    }
    onOpenChange(next);
  };

  const submit = () => {
    if (!upstreamId || !username || !password) return;
    mutation.mutate(
      {
        upstream_id: upstreamId,
        username,
        password,
        api_token: apiToken || undefined,
        label: label || undefined
      },
      {
        onSuccess: (data) => {
          if (!data.provision_error) close(false);
        }
      }
    );
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={close}
      title="添加账号"
      description="将使用用户名与密码登录上游并保存凭据。"
    >
      <div className="flex flex-col gap-3.5">
        <Field label="上游">
          <UpstreamSelect
            value={upstreamId}
            onChange={setUpstreamId}
            upstreams={upstreams}
          />
        </Field>
        <Field label="用户名">
          <input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="用户名 / 邮箱" />
        </Field>
        <Field label="密码">
          <input type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="登录密码" autoComplete="off" />
        </Field>
        <Field label="API Token" hint="可选">
          <input className={inputClass} value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder="留空可稍后补填" autoComplete="off" />
        </Field>
        <Field label="标签" hint="可选">
          <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="便于识别的备注" />
        </Field>
      </div>
      {mutation.isError && (
        <p className="mt-3 text-sm text-(--color-warning)">添加失败：{mutation.error.message}</p>
      )}
      {mutation.data?.provision_error && (
        <div className="mt-3 rounded-(--radius-input) border border-(--color-warning)/40 bg-(--color-warning)/10 p-3 text-xs text-(--color-warning)">
          已创建，但自动获取 Token 失败：{mutation.data.provision_error}，可稍后点「获取生图 Token」重试。
        </div>
      )}
      <DialogActions
        pending={mutation.isPending}
        disabled={!upstreamId || !username || !password}
        confirmLabel={mutation.data?.provision_error ? "关闭" : "添加"}
        onCancel={() => close(false)}
        onConfirm={mutation.data?.provision_error ? () => close(false) : submit}
      />
    </DialogShell>
  );
}

function BatchImportDialog({
  open,
  onOpenChange,
  upstreams,
  defaultUpstream
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  upstreams: UpstreamPublic[];
  defaultUpstream: string;
}) {
  const [upstreamId, setUpstreamId] = useState(defaultUpstream);
  const [text, setText] = useState("");
  const [result, setResult] = useState<BatchCreateResult | null>(null);
  const mutation = useBatchCreateAccounts();

  const parsed = useMemo(() => parseBulk(text), [text]);

  const close = (next: boolean) => {
    if (!next) {
      setUpstreamId(defaultUpstream);
      setText("");
      setResult(null);
      mutation.reset();
    }
    onOpenChange(next);
  };

  const submit = () => {
    if (!upstreamId || parsed.length === 0) return;
    mutation.mutate(
      { upstream_id: upstreamId, items: parsed.slice(0, 30) },
      {
        onSuccess: (data) => {
          setResult(data);
        }
      }
    );
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={close}
      title="批量导入"
      description="每行一个账号，支持「账号----密码」，兼容 : , 空格 分隔，最多 30 条。"
    >
      <div className="flex flex-col gap-3.5">
        <Field label="上游">
          <UpstreamSelect
            value={upstreamId}
            onChange={setUpstreamId}
            upstreams={upstreams}
          />
        </Field>
        <Field label="账号列表" hint={`已解析 ${parsed.length} 条`}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={"账号----密码\n账号:密码\n账号,密码\n账号 密码"}
            className="w-full resize-none rounded-(--radius-input) border border-(--color-border) bg-(--color-surface-1) px-3 py-2 text-sm outline-none placeholder:text-(--color-muted-2) focus:border-(--color-primary)"
          />
        </Field>
      </div>

      {mutation.isError && (
        <p className="mt-3 text-sm text-(--color-warning)">导入失败：{mutation.error.message}</p>
      )}

      {result && (
        <div className="mt-4 rounded-(--radius-input) border border-(--color-border) bg-(--color-surface-2) p-3">
          <p className="text-sm">
            成功 <span className="font-semibold text-(--color-success)">{result.created}</span> · 失败{" "}
            <span className="font-semibold text-(--color-warning)">{result.failed}</span>
          </p>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
            {result.items.map((item, index) => (
              <li key={`${item.username}-${index}`} className="flex items-center gap-2">
                <span className={item.ok ? "text-(--color-success)" : "text-(--color-warning)"}>
                  {item.ok ? "成功" : "失败"}
                </span>
                <span className="truncate text-(--color-muted)">{item.username}</span>
                {!item.ok && item.error && (
                  <span className="truncate text-(--color-muted-2)">{item.error}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <DialogActions
        pending={mutation.isPending}
        disabled={!upstreamId || parsed.length === 0}
        confirmLabel={result ? "关闭" : "导入"}
        onCancel={() => close(false)}
        onConfirm={() => {
          if (result) {
            close(false);
          } else {
            submit();
          }
        }}
      />
    </DialogShell>
  );
}

function EditAccountDialog({
  account,
  onOpenChange
}: {
  account: AccountPublic | null;
  onOpenChange: (open: boolean) => void;
}) {
  const mutation = useUpdateAccount();
  const [label, setLabel] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [apiToken, setApiToken] = useState("");
  const [password, setPassword] = useState("");

  const open = account !== null;
  const [lastId, setLastId] = useState<string | null>(null);
  if (account && account.id !== lastId) {
    setLastId(account.id);
    setLabel(account.label ?? "");
    setEnabled(account.enabled);
    setApiToken("");
    setPassword("");
  }

  const close = (next: boolean) => {
    if (!next) {
      setLastId(null);
      mutation.reset();
    }
    onOpenChange(next);
  };

  const submit = () => {
    if (!account) return;
    const patch: Parameters<typeof mutation.mutate>[0]["patch"] = {
      label: label || null,
      enabled
    };
    if (apiToken) patch.api_token = apiToken;
    if (password) patch.password = password;
    mutation.mutate({ id: account.id, patch }, { onSuccess: () => close(false) });
  };

  return (
    <DialogShell open={open} onOpenChange={close} title="编辑账号">
      {account && (
        <div className="flex flex-col gap-3.5">
          <Field label="用户名">
            <input className={`${inputClass} cursor-not-allowed text-(--color-muted)`} value={account.username} disabled />
          </Field>
          <Field label="标签" hint="可选">
            <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="便于识别的备注" />
          </Field>
          <Field label="启用">
            <div className="flex h-9 items-center">
              <EnableToggle enabled={enabled} pending={false} onToggle={() => setEnabled((prev) => !prev)} />
              <span className="ml-3 text-sm text-(--color-muted)">{enabled ? "已启用" : "已停用"}</span>
            </div>
          </Field>
          <Field
            label="API Token"
            hint={account.has_api_token ? "留空保持不变" : "当前缺失，建议补填"}
          >
            <input className={inputClass} value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder={account.has_api_token ? "留空保持不变" : "补填 API Token"} autoComplete="off" />
          </Field>
          <Field label="密码" hint="留空保持不变">
            <input type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="修改密码将触发后端重新登录" autoComplete="off" />
          </Field>
          <p className="text-xs text-(--color-muted-2)">修改密码会触发后端重新登录并刷新 JWT。</p>
        </div>
      )}
      {mutation.isError && (
        <p className="mt-3 text-sm text-(--color-warning)">保存失败：{mutation.error.message}</p>
      )}
      <DialogActions
        pending={mutation.isPending}
        confirmLabel="保存"
        onCancel={() => close(false)}
        onConfirm={submit}
      />
    </DialogShell>
  );
}


