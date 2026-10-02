import { useEffect, useState } from "react";
import ConsoleShell from "../components/ConsoleShell";
import ConfirmDialog from "../components/ConfirmDialog";
import {
  DialogActions,
  DialogShell,
  EmptyState,
  EnableToggle,
  Field,
  inputClass
} from "../components/console-ui";
import { IconPlus } from "../components/icons";
import {
  useCreateUpstream,
  useDeleteUpstream,
  useModels,
  useUpdateUpstream,
  useUpstreams
} from "../hooks/useUpstreams";
import type { UpstreamInput, UpstreamPublic } from "../lib/api";

const TYPE_OPTIONS = [
  { value: "nai-compatible", label: "nai-compatible" },
  { value: "openai-compatible", label: "openai-compatible" }
];

const STRATEGY_OPTIONS = [
  { value: "round_robin", label: "round_robin（轮询）" },
  { value: "balance_first", label: "balance_first（余额优先）" },
  { value: "fixed", label: "fixed（固定账号）" }
];

function parseList(text: string): string[] {
  return text
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function strategyOf(upstream: UpstreamPublic): string {
  const raw = upstream.capabilities?.account_strategy;
  return typeof raw === "string" ? raw : "round_robin";
}

export default function Upstreams() {
  const upstreamsQuery = useUpstreams();
  const deleteMutation = useDeleteUpstream();
  const modelsQuery = useModels(false);

  const items = upstreamsQuery.data?.items ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UpstreamPublic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UpstreamPublic | null>(null);
  const [showModels, setShowModels] = useState(false);

  const openCreate = () => {
    setEditTarget(null);
    setDialogOpen(true);
  };

  const openEdit = (upstream: UpstreamPublic) => {
    setEditTarget(upstream);
    setDialogOpen(true);
  };

  const refreshModels = () => {
    setShowModels(true);
    void modelsQuery.refetch();
  };

  return (
    <ConsoleShell>
      <div className="mx-auto w-full max-w-[1280px] px-5 py-10 sm:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">上游管理</h1>
            <p className="mt-1 text-sm text-(--color-muted)">
              配置后端上游服务、路由权重与账号选择策略。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={modelsQuery.isFetching}
              onClick={refreshModels}
              className="inline-flex h-10 items-center rounded-full border border-(--color-border) bg-(--color-surface-1) px-4 text-sm transition-colors hover:border-(--color-border-strong) disabled:cursor-not-allowed disabled:opacity-50"
            >
              {modelsQuery.isFetching ? "加载中…" : "刷新模型"}
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-(--color-primary) px-5 text-sm font-medium text-white shadow-(--shadow-card) transition-opacity hover:opacity-90"
            >
              <IconPlus className="size-4" />
              新增上游
            </button>
          </div>
        </header>

        <section className="mt-6">
          {upstreamsQuery.isLoading ? (
            <EmptyState title="加载中…" />
          ) : upstreamsQuery.isError ? (
            <div className="flex flex-col items-center gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) py-24 text-center">
              <p className="text-sm text-(--color-warning)">加载失败：{upstreamsQuery.error.message}</p>
              <button
                type="button"
                onClick={() => upstreamsQuery.refetch()}
                className="rounded-full border border-(--color-border) px-4 py-1.5 text-sm transition-colors hover:border-(--color-border-strong)"
              >
                重试
              </button>
            </div>
          ) : items.length === 0 ? (
            <EmptyState title="还没有上游" description="点击「新增上游」添加第一个后端服务。" />
          ) : (
            <div className="overflow-hidden rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) shadow-(--shadow-card)">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1020px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-(--color-border) text-left text-xs text-(--color-muted-2)">
                      <th className="px-4 py-3 font-medium">名称</th>
                      <th className="px-4 py-3 font-medium">类型</th>
                      <th className="px-4 py-3 font-medium">Base URL</th>
                      <th className="px-4 py-3 font-medium text-right">优先级</th>
                      <th className="px-4 py-3 font-medium text-right">权重</th>
                      <th className="px-4 py-3 font-medium">凭据</th>
                      <th className="px-4 py-3 font-medium text-right">模型数</th>
                      <th className="px-4 py-3 font-medium">启用</th>
                      <th className="px-4 py-3 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((upstream) => (
                      <tr key={upstream.id} className="border-b border-(--color-border) last:border-b-0">
                        <td className="px-4 py-3">
                          <div className="font-medium">{upstream.name || "未命名"}</div>
                          <div className="font-mono text-xs text-(--color-muted-2)">
                            {upstream.id.slice(0, 8)}…
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-full border border-(--color-border) px-2 py-0.5 text-xs text-(--color-muted)">
                            {upstream.type}
                          </span>
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-(--color-muted)" title={upstream.base_url}>
                          {upstream.base_url || "—"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{upstream.priority}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{upstream.weight}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] ${
                              upstream.has_auth
                                ? "border-(--color-border) text-(--color-muted)"
                                : "border-dashed border-(--color-border-strong) text-(--color-muted-2)"
                            }`}
                          >
                            {upstream.has_auth ? "已配置" : "无"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {upstream.models.length}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 ${
                              upstream.enabled ? "text-(--color-success)" : "text-(--color-muted)"
                            }`}
                          >
                            <span
                              className={`size-1.5 rounded-full ${
                                upstream.enabled ? "bg-(--color-success)" : "bg-(--color-muted-2)"
                              }`}
                            />
                            {upstream.enabled ? "启用" : "停用"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEdit(upstream)}
                              className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text)"
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(upstream)}
                              className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) transition-colors hover:border-(--color-warning)/50 hover:text-(--color-warning)"
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {showModels && (
          <section className="mt-6 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) p-6 shadow-(--shadow-card)">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">模型映射</h2>
              <button
                type="button"
                onClick={() => setShowModels(false)}
                className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text)"
              >
                收起
              </button>
            </div>
            {modelsQuery.isLoading ? (
              <p className="mt-3 text-sm text-(--color-muted-2)">加载中…</p>
            ) : modelsQuery.isError ? (
              <p className="mt-3 text-sm text-(--color-warning)">加载失败：{modelsQuery.error.message}</p>
            ) : (modelsQuery.data?.items ?? []).length === 0 ? (
              <p className="mt-3 text-sm text-(--color-muted-2)">暂无模型映射。</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-(--color-border) text-left text-xs text-(--color-muted-2)">
                      <th className="px-4 py-2 font-medium">逻辑名</th>
                      <th className="px-4 py-2 font-medium">上游</th>
                      <th className="px-4 py-2 font-medium">上游模型</th>
                      <th className="px-4 py-2 font-medium">启用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(modelsQuery.data?.items ?? []).map((model) => (
                      <tr
                        key={`${model.logical_name}-${model.upstream_id}`}
                        className="border-b border-(--color-border) last:border-b-0"
                      >
                        <td className="px-4 py-2">{model.logical_name}</td>
                        <td className="px-4 py-2 text-(--color-muted)">{model.upstream_id}</td>
                        <td className="px-4 py-2 text-(--color-muted)">{model.upstream_model}</td>
                        <td className="px-4 py-2">
                          {model.enabled ? (
                            <span className="text-(--color-success)">启用</span>
                          ) : (
                            <span className="text-(--color-muted)">停用</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>

      <UpstreamDialog
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
        title="删除这个上游？"
        description={
          deleteTarget
            ? `将删除上游「${deleteTarget.name || deleteTarget.id}」，关联账号可能无法工作，此操作无法恢复。`
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

function UpstreamDialog({
  open,
  editing,
  onOpenChange
}: {
  open: boolean;
  editing: UpstreamPublic | null;
  onOpenChange: (open: boolean) => void;
}) {
  const createMutation = useCreateUpstream();
  const updateMutation = useUpdateUpstream();
  const mutation = editing ? updateMutation : createMutation;

  const [name, setName] = useState("");
  const [type, setType] = useState("nai-compatible");
  const [baseUrl, setBaseUrl] = useState("");
  const [auth, setAuth] = useState("");
  const [modelsText, setModelsText] = useState("");
  const [strategy, setStrategy] = useState("round_robin");
  const [priority, setPriority] = useState("0");
  const [weight, setWeight] = useState("1");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!open) return;
    mutation.reset();
    if (editing) {
      setName(editing.name);
      setType(editing.type);
      setBaseUrl(editing.base_url);
      setAuth("");
      setModelsText(editing.models.join(", "));
      setStrategy(strategyOf(editing));
      setPriority(String(editing.priority));
      setWeight(String(editing.weight));
      setEnabled(editing.enabled);
    } else {
      setName("");
      setType("nai-compatible");
      setBaseUrl("");
      setAuth("");
      setModelsText("");
      setStrategy("round_robin");
      setPriority("0");
      setWeight("1");
      setEnabled(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const close = (next: boolean) => {
    if (!next) mutation.reset();
    onOpenChange(next);
  };

  const submit = () => {
    const priorityNum = Number(priority);
    const weightNum = Number(weight);
    const capabilities: Record<string, unknown> = {
      ...(editing?.capabilities ?? {}),
      account_strategy: strategy
    };
    const body: UpstreamInput = {
      name: name.trim(),
      type,
      base_url: baseUrl.trim(),
      models: parseList(modelsText),
      capabilities,
      priority: Number.isFinite(priorityNum) ? priorityNum : 0,
      weight: Number.isFinite(weightNum) ? weightNum : 1,
      enabled
    };
    if (auth) body.auth = auth;
    if (editing) {
      updateMutation.mutate(
        { id: editing.id, patch: body },
        { onSuccess: () => close(false) }
      );
    } else {
      createMutation.mutate(body, { onSuccess: () => close(false) });
    }
  };

  const disabled = !name.trim() || !baseUrl.trim();

  return (
    <DialogShell
      open={open}
      onOpenChange={close}
      title={editing ? "编辑上游" : "新增上游"}
    >
      <div className="flex flex-col gap-3.5">
        <Field label="名称">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="上游名称" />
        </Field>
        <Field label="类型">
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Base URL">
          <input
            className={inputClass}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </Field>
        <Field
          label="凭据"
          hint={editing ? (editing.has_auth ? "已配置，留空保持不变" : "当前无凭据，可补填") : "仅写入，不会回显"}
        >
          <input
            className={inputClass}
            value={auth}
            onChange={(e) => setAuth(e.target.value)}
            placeholder={editing?.has_auth ? "留空保持不变" : "API Token / 密钥"}
            autoComplete="off"
          />
        </Field>
        <Field label="模型" hint="逗号分隔">
          <input
            className={inputClass}
            value={modelsText}
            onChange={(e) => setModelsText(e.target.value)}
            placeholder="nai-diffusion-4-5-full, ..."
          />
        </Field>
        <Field label="账号选择策略">
          <select className={inputClass} value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            {STRATEGY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="优先级" hint="越大越优先">
            <input
              type="number"
              className={inputClass}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            />
          </Field>
          <Field label="权重">
            <input
              type="number"
              min={0}
              className={inputClass}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </Field>
        </div>
        <Field label="启用">
          <div className="flex h-9 items-center">
            <EnableToggle enabled={enabled} pending={false} onToggle={() => setEnabled((p) => !p)} />
            <span className="ml-3 text-sm text-(--color-muted)">{enabled ? "已启用" : "已停用"}</span>
          </div>
        </Field>
      </div>

      {mutation.isError && (
        <p className="mt-3 text-sm text-(--color-warning)">
          {editing ? "保存失败" : "创建失败"}：{mutation.error.message}
        </p>
      )}
      <DialogActions
        pending={mutation.isPending}
        disabled={disabled}
        confirmLabel={editing ? "保存" : "创建"}
        onCancel={() => close(false)}
        onConfirm={submit}
      />
    </DialogShell>
  );
}
