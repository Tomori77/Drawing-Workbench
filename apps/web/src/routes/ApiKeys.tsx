import { useEffect, useMemo, useState } from "react";
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
  useApiKeys,
  useCreateApiKey,
  useDeleteApiKey,
  useUpdateApiKey
} from "../hooks/useApiKeys";
import { useModels, useUpstreams } from "../hooks/useUpstreams";
import type { ApiKeyInput, ApiKeyPolicy, ApiKeyPublic } from "../lib/api";

const ROLE_OPTIONS = [
  { value: "owner", label: "owner" },
  { value: "friend", label: "friend" }
];

const MODE_OPTIONS = [
  { value: "restricted", label: "restricted（策略校验）" },
  { value: "passthrough", label: "passthrough（原样透传）" }
];

const PARAMETER_MODE_OPTIONS = [
  { value: "merge", label: "merge（不改写）" },
  { value: "fixed", label: "fixed（合并固定参数）" }
];

function parseList(text: string): string[] {
  return text
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function toIsoOrNull(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function policyOf(key: ApiKeyPublic): ApiKeyPolicy {
  return key.policy ?? {};
}

export default function ApiKeys() {
  const keysQuery = useApiKeys();
  const modelsQuery = useModels();
  const upstreamsQuery = useUpstreams();

  const items = keysQuery.data?.items ?? [];
  const availableModels = useMemo(
    () => Array.from(new Set((modelsQuery.data?.items ?? []).map((m) => m.logical_name))),
    [modelsQuery.data]
  );
  const upstreams = upstreamsQuery.data?.items ?? [];

  const updateMutation = useUpdateApiKey();
  const deleteMutation = useDeleteApiKey();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiKeyPublic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKeyPublic | null>(null);

  const openCreate = () => {
    setEditTarget(null);
    setDialogOpen(true);
  };

  const openEdit = (key: ApiKeyPublic) => {
    setEditTarget(key);
    setDialogOpen(true);
  };

  return (
    <ConsoleShell>
      <div className="mx-auto w-full max-w-[1280px] px-5 py-10 sm:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">API 密钥</h1>
            <p className="mt-1 text-sm text-(--color-muted)">
              为开放 API 创建访问密钥，配置角色、模式与策略。
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-(--color-primary) px-5 text-sm font-medium text-white shadow-(--shadow-card) transition-opacity hover:opacity-90"
          >
            <IconPlus className="size-4" />
            创建密钥
          </button>
        </header>

        <section className="mt-6">
          {keysQuery.isLoading ? (
            <EmptyState title="加载中…" />
          ) : keysQuery.isError ? (
            <div className="flex flex-col items-center gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) py-24 text-center">
              <p className="text-sm text-(--color-warning)">加载失败：{keysQuery.error.message}</p>
              <button
                type="button"
                onClick={() => keysQuery.refetch()}
                className="rounded-full border border-(--color-border) px-4 py-1.5 text-sm transition-colors hover:border-(--color-border-strong)"
              >
                重试
              </button>
            </div>
          ) : items.length === 0 ? (
            <EmptyState title="还没有密钥" description="点击「创建密钥」为开放 API 生成访问凭据。" />
          ) : (
            <div className="overflow-hidden rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) shadow-(--shadow-card)">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-(--color-border) text-left text-xs text-(--color-muted-2)">
                      <th className="px-4 py-3 font-medium">名称</th>
                      <th className="px-4 py-3 font-medium">角色</th>
                      <th className="px-4 py-3 font-medium">模式</th>
                      <th className="px-4 py-3 font-medium text-right">已用 / 额度</th>
                      <th className="px-4 py-3 font-medium text-right">模型数</th>
                      <th className="px-4 py-3 font-medium">过期</th>
                      <th className="px-4 py-3 font-medium">启用</th>
                      <th className="px-4 py-3 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((key) => {
                      const toggling =
                        updateMutation.isPending && updateMutation.variables?.id === key.id;
                      return (
                        <tr key={key.id} className="border-b border-(--color-border) last:border-b-0">
                          <td className="px-4 py-3">
                            <div className="font-medium">{key.name || "未命名"}</div>
                            <div className="font-mono text-xs text-(--color-muted-2)">
                              {key.id.slice(0, 8)}…
                            </div>
                          </td>
                          <td className="px-4 py-3 text-(--color-muted)">{key.role}</td>
                          <td className="px-4 py-3">
                            <span className="rounded-full border border-(--color-border) px-2 py-0.5 text-xs text-(--color-muted)">
                              {key.mode}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {key.used_count} / {key.quota ?? "∞"}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {key.allowed_models.length || "不限"}
                          </td>
                          <td className="px-4 py-3 text-xs text-(--color-muted-2)">
                            {key.expires_at ? formatTime(key.expires_at) : "永久"}
                          </td>
                          <td className="px-4 py-3">
                            <EnableToggle
                              enabled={key.enabled}
                              pending={toggling}
                              onToggle={() =>
                                updateMutation.mutate({
                                  id: key.id,
                                  patch: { enabled: !key.enabled }
                                })
                              }
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => openEdit(key)}
                                className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text)"
                              >
                                编辑
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(key)}
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

      <ApiKeyDialog
        open={dialogOpen}
        editing={editTarget}
        availableModels={availableModels}
        upstreams={upstreams.map((u) => ({ id: u.id, name: u.name || u.id }))}
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
        title="删除这个密钥？"
        description={
          deleteTarget
            ? `将删除密钥「${deleteTarget.name || deleteTarget.id}」，使用它的客户端会立即失效，此操作无法恢复。`
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

function ApiKeyDialog({
  open,
  editing,
  availableModels,
  upstreams,
  onOpenChange
}: {
  open: boolean;
  editing: ApiKeyPublic | null;
  availableModels: string[];
  upstreams: Array<{ id: string; name: string }>;
  onOpenChange: (open: boolean) => void;
}) {
  const createMutation = useCreateApiKey();
  const updateMutation = useUpdateApiKey();
  const mutation = editing ? updateMutation : createMutation;

  const [name, setName] = useState("");
  const [role, setRole] = useState("friend");
  const [mode, setMode] = useState("restricted");
  const [enabled, setEnabled] = useState(true);
  const [modelsText, setModelsText] = useState("");
  const [upstreamsSelected, setUpstreamsSelected] = useState<string[]>([]);
  const [dailyRequests, setDailyRequests] = useState("");
  const [dailyGems, setDailyGems] = useState("");
  const [maxConcurrency, setMaxConcurrency] = useState("");
  const [parameterMode, setParameterMode] = useState("merge");
  const [allowImg2img, setAllowImg2img] = useState(true);
  const [allowInpaint, setAllowInpaint] = useState(true);
  const [allowExtraParameters, setAllowExtraParameters] = useState(true);
  const [quota, setQuota] = useState("");
  const [rateLimit, setRateLimit] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCreatedKey(null);
    mutation.reset();
    if (editing) {
      const policy = policyOf(editing);
      setName(editing.name ?? "");
      setRole(editing.role);
      setMode(editing.mode);
      setEnabled(editing.enabled);
      setModelsText((editing.allowed_models ?? policy.allowed_models ?? []).join(", "));
      setUpstreamsSelected(editing.allowed_upstreams ?? []);
      setDailyRequests(policy.daily_requests ? String(policy.daily_requests) : "");
      setDailyGems(policy.daily_gems ? String(policy.daily_gems) : "");
      setMaxConcurrency(policy.max_concurrency ? String(policy.max_concurrency) : "");
      setParameterMode(policy.parameter_mode === "fixed" ? "fixed" : "merge");
      setAllowImg2img(policy.allow_img2img !== false);
      setAllowInpaint(policy.allow_inpaint !== false);
      setAllowExtraParameters(policy.allow_extra_parameters !== false);
      setQuota(editing.quota !== null ? String(editing.quota) : "");
      setRateLimit(editing.rate_limit !== null ? String(editing.rate_limit) : "");
      setExpiresAt(toLocalInput(editing.expires_at));
    } else {
      setName("");
      setRole("friend");
      setMode("restricted");
      setEnabled(true);
      setModelsText("");
      setUpstreamsSelected([]);
      setDailyRequests("");
      setDailyGems("");
      setMaxConcurrency("");
      setParameterMode("merge");
      setAllowImg2img(true);
      setAllowInpaint(true);
      setAllowExtraParameters(true);
      setQuota("");
      setRateLimit("");
      setExpiresAt("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const selectedModels = useMemo(() => parseList(modelsText), [modelsText]);
  const modelChoices = useMemo(
    () => Array.from(new Set([...availableModels, ...selectedModels])),
    [availableModels, selectedModels]
  );

  const toggleModel = (model: string) => {
    setModelsText(
      selectedModels.includes(model)
        ? selectedModels.filter((m) => m !== model).join(", ")
        : [...selectedModels, model].join(", ")
    );
  };

  const toggleUpstream = (id: string) => {
    setUpstreamsSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const submit = () => {
    const policy: ApiKeyPolicy = {
      allowed_models: selectedModels,
      parameter_mode: parameterMode === "fixed" ? "fixed" : "merge",
      allow_img2img: allowImg2img,
      allow_inpaint: allowInpaint,
      allow_extra_parameters: allowExtraParameters
    };
    const dailyRequestsNum = toNumberOrNull(dailyRequests);
    const dailyGemsNum = toNumberOrNull(dailyGems);
    const maxConcurrencyNum = toNumberOrNull(maxConcurrency);
    if (dailyRequestsNum !== null) policy.daily_requests = dailyRequestsNum;
    if (dailyGemsNum !== null) policy.daily_gems = dailyGemsNum;
    if (maxConcurrencyNum !== null) policy.max_concurrency = maxConcurrencyNum;

    const body: ApiKeyInput = {
      name: name.trim() || null,
      role,
      mode,
      policy,
      allowed_models: selectedModels,
      allowed_upstreams: upstreamsSelected,
      quota: toNumberOrNull(quota),
      rate_limit: toNumberOrNull(rateLimit),
      expires_at: toIsoOrNull(expiresAt),
      enabled
    };

    if (editing) {
      updateMutation.mutate(
        { id: editing.id, patch: body },
        { onSuccess: () => onOpenChange(false) }
      );
    } else {
      createMutation.mutate(body, {
        onSuccess: (data) => setCreatedKey(data.key)
      });
    }
  };

  const close = (next: boolean) => {
    if (!next) {
      setCreatedKey(null);
      mutation.reset();
    }
    onOpenChange(next);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={close}
      title={editing ? "编辑密钥" : createdKey ? "密钥已创建" : "创建密钥"}
      description={editing ? undefined : "密钥明文仅在创建成功后显示一次，请及时保存。"}
    >
      {createdKey ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-(--radius-input) border border-(--color-success)/40 bg-(--color-success)/10 p-4">
            <p className="text-xs font-medium text-(--color-success)">
              仅显示一次，请立即复制保存
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-(--radius-input) bg-(--color-surface-2) px-3 py-2 font-mono text-xs">
                {createdKey}
              </code>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(createdKey)}
                className="shrink-0 rounded-full border border-(--color-border) px-3 py-1.5 text-xs transition-colors hover:border-(--color-border-strong)"
              >
                复制
              </button>
            </div>
          </div>
          <p className="text-xs text-(--color-muted-2)">
            关闭后将无法再次查看该密钥，如需重置请删除后重新创建。
          </p>
          <DialogActions
            pending={false}
            confirmLabel="完成"
            onCancel={() => close(false)}
            onConfirm={() => close(false)}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3.5">
            <Field label="名称" hint="可选">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="便于识别的备注"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="角色">
                <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="模式">
                <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value)}>
                  {MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="启用">
              <div className="flex h-9 items-center">
                <EnableToggle enabled={enabled} pending={false} onToggle={() => setEnabled((p) => !p)} />
                <span className="ml-3 text-sm text-(--color-muted)">{enabled ? "已启用" : "已停用"}</span>
              </div>
            </Field>

            <div className="rounded-(--radius-input) border border-(--color-border) p-3">
              <p className="text-xs font-medium text-(--color-muted)">策略（restricted 模式生效）</p>
              <div className="mt-3 flex flex-col gap-3.5">
                <Field label="允许模型" hint="逗号分隔，留空不限制">
                  <input
                    className={inputClass}
                    value={modelsText}
                    onChange={(e) => setModelsText(e.target.value)}
                    placeholder="留空表示不限制模型"
                  />
                </Field>
                {modelChoices.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {modelChoices.map((model) => {
                      const active = selectedModels.includes(model);
                      return (
                        <button
                          key={model}
                          type="button"
                          onClick={() => toggleModel(model)}
                          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                            active
                              ? "border-(--color-primary) bg-(--color-primary)/10 text-(--color-primary)"
                              : "border-(--color-border) text-(--color-muted) hover:border-(--color-border-strong)"
                          }`}
                        >
                          {model}
                        </button>
                      );
                    })}
                  </div>
                )}

                {upstreams.length > 0 && (
                  <Field label="允许上游" hint="留空不限制">
                    <div className="flex flex-wrap gap-1.5">
                      {upstreams.map((upstream) => {
                        const active = upstreamsSelected.includes(upstream.id);
                        return (
                          <button
                            key={upstream.id}
                            type="button"
                            onClick={() => toggleUpstream(upstream.id)}
                            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                              active
                                ? "border-(--color-primary) bg-(--color-primary)/10 text-(--color-primary)"
                                : "border-(--color-border) text-(--color-muted) hover:border-(--color-border-strong)"
                            }`}
                          >
                            {upstream.name}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                )}

                <div className="grid grid-cols-3 gap-3">
                  <Field label="每日请求" hint="空=不限">
                    <input
                      type="number"
                      min={0}
                      className={inputClass}
                      value={dailyRequests}
                      onChange={(e) => setDailyRequests(e.target.value)}
                      placeholder="0"
                    />
                  </Field>
                  <Field label="每日 Gems" hint="空=不限">
                    <input
                      type="number"
                      min={0}
                      className={inputClass}
                      value={dailyGems}
                      onChange={(e) => setDailyGems(e.target.value)}
                      placeholder="0"
                    />
                  </Field>
                  <Field label="最大并发" hint="空=不限">
                    <input
                      type="number"
                      min={0}
                      className={inputClass}
                      value={maxConcurrency}
                      onChange={(e) => setMaxConcurrency(e.target.value)}
                      placeholder="0"
                    />
                  </Field>
                </div>

                <Field label="参数模式">
                  <select
                    className={inputClass}
                    value={parameterMode}
                    onChange={(e) => setParameterMode(e.target.value)}
                  >
                    {PARAMETER_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="flex flex-wrap gap-4">
                  <CheckBox label="允许图生图" checked={allowImg2img} onChange={setAllowImg2img} />
                  <CheckBox label="允许局部重绘" checked={allowInpaint} onChange={setAllowInpaint} />
                  <CheckBox
                    label="允许额外参数"
                    checked={allowExtraParameters}
                    onChange={setAllowExtraParameters}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="总额度" hint="空=不限">
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={quota}
                  onChange={(e) => setQuota(e.target.value)}
                  placeholder="0"
                />
              </Field>
              <Field label="速率限制" hint="每分钟，空=不限">
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={rateLimit}
                  onChange={(e) => setRateLimit(e.target.value)}
                  placeholder="0"
                />
              </Field>
            </div>

            <Field label="过期时间" hint="留空=永久">
              <input
                type="datetime-local"
                className={inputClass}
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </Field>
          </div>

          {mutation.isError && (
            <p className="mt-3 text-sm text-(--color-warning)">
              {editing ? "保存失败" : "创建失败"}：{mutation.error.message}
            </p>
          )}
          <DialogActions
            pending={mutation.isPending}
            confirmLabel={editing ? "保存" : "创建"}
            onCancel={() => close(false)}
            onConfirm={submit}
          />
        </>
      )}
    </DialogShell>
  );
}

function CheckBox({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-(--color-muted)">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-(--color-primary)"
      />
      {label}
    </label>
  );
}
