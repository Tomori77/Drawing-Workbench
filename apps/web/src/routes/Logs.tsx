import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import ConsoleShell from "../components/ConsoleShell";
import { EmptyState, formatTime } from "../components/console-ui";
import { useLogAttempts, useLogs } from "../hooks/useLogs";
import type { LogItem } from "../lib/api";

const PAGE_SIZE = 50;

const SOURCE_TABS = [
  { value: "all", label: "全部" },
  { value: "workbench", label: "工作台生成" },
  { value: "gateway", label: "对外网关调用" }
] as const;

const STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "ok", label: "成功" },
  { value: "fail", label: "失败" }
] as const;

type SourceValue = (typeof SOURCE_TABS)[number]["value"];
type StatusValue = (typeof STATUS_OPTIONS)[number]["value"];

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function SourceBadge({ source }: { source: LogItem["source"] }) {
  const isGateway = source === "gateway";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] ${
        isGateway
          ? "border-(--color-primary)/40 bg-(--color-primary)/10 text-(--color-primary)"
          : "border-(--color-border) text-(--color-muted)"
      }`}
    >
      {isGateway ? "网关" : "工作台"}
    </span>
  );
}

export default function Logs() {
  const [source, setSource] = useState<SourceValue>("all");
  const [status, setStatus] = useState<StatusValue>("all");
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const logsQuery = useLogs({ source, status, limit: PAGE_SIZE, offset });
  const items = logsQuery.data?.items ?? [];
  const total = logsQuery.data?.total ?? 0;
  const counts = logsQuery.data?.counts ?? { workbench: 0, gateway: 0 };

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const changeSource = (value: string) => {
    setSource(value as SourceValue);
    setOffset(0);
    setExpanded(null);
  };

  const changeStatus = (value: StatusValue) => {
    setStatus(value);
    setOffset(0);
    setExpanded(null);
  };

  return (
    <ConsoleShell>
      <div className="mx-auto w-full max-w-[1280px] px-5 py-10 sm:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">生成日志</h1>
            <p className="mt-1 text-sm text-(--color-muted)">
              查看工作台与对外 API 的全部请求记录，可按分类与状态过滤。
            </p>
          </div>
          <button
            type="button"
            disabled={logsQuery.isFetching}
            onClick={() => logsQuery.refetch()}
            className="inline-flex h-10 items-center rounded-full border border-(--color-border) bg-(--color-surface-1) px-4 text-sm transition-colors hover:border-(--color-border-strong) disabled:cursor-not-allowed disabled:opacity-50"
          >
            {logsQuery.isFetching ? "刷新中…" : "刷新"}
          </button>
        </header>

        <section className="mt-6 flex flex-wrap items-center gap-4">
          <Tabs.Root value={source} onValueChange={changeSource}>
            <Tabs.List className="flex gap-1 rounded-(--radius-input) bg-(--color-surface-2) p-1">
              {SOURCE_TABS.map((tab) => {
                const count =
                  tab.value === "all"
                    ? counts.workbench + counts.gateway
                    : tab.value === "workbench"
                      ? counts.workbench
                      : counts.gateway;
                return (
                  <Tabs.Trigger
                    key={tab.value}
                    value={tab.value}
                    className="rounded-[9px] px-3.5 py-1.5 text-sm text-(--color-muted) transition-colors data-[state=active]:bg-(--color-surface-1) data-[state=active]:font-medium data-[state=active]:text-(--color-text) data-[state=active]:shadow-(--shadow-glass)"
                  >
                    {tab.label}
                    <span className="ml-1.5 text-xs text-(--color-muted-2)">{count}</span>
                  </Tabs.Trigger>
                );
              })}
            </Tabs.List>
          </Tabs.Root>

          <div className="flex items-center gap-1 rounded-(--radius-input) border border-(--color-border) p-1">
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => changeStatus(option.value)}
                className={`rounded-[9px] px-3 py-1.5 text-xs transition-colors ${
                  status === option.value
                    ? "bg-(--color-text) font-medium text-white"
                    : "text-(--color-muted) hover:bg-(--color-surface-2)"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-6">
          {logsQuery.isLoading ? (
            <EmptyState title="加载中…" />
          ) : logsQuery.isError ? (
            <div className="flex flex-col items-center gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) py-24 text-center">
              <p className="text-sm text-(--color-warning)">加载失败：{logsQuery.error.message}</p>
              <button
                type="button"
                onClick={() => logsQuery.refetch()}
                className="rounded-full border border-(--color-border) px-4 py-1.5 text-sm transition-colors hover:border-(--color-border-strong)"
              >
                重试
              </button>
            </div>
          ) : items.length === 0 ? (
            <EmptyState title="没有匹配的日志" description="调整分类或状态过滤后再试。" />
          ) : (
            <div className="overflow-hidden rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) shadow-(--shadow-card)">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-(--color-border) text-left text-xs text-(--color-muted-2)">
                      <th className="px-4 py-3 font-medium">时间</th>
                      <th className="px-4 py-3 font-medium">分类</th>
                      <th className="px-4 py-3 font-medium">路径</th>
                      <th className="px-4 py-3 font-medium">模式</th>
                      <th className="px-4 py-3 font-medium">状态</th>
                      <th className="px-4 py-3 font-medium text-right">耗时</th>
                      <th className="px-4 py-3 font-medium text-right">字节</th>
                      <th className="px-4 py-3 font-medium text-right">成本</th>
                      <th className="px-4 py-3 font-medium">密钥</th>
                      <th className="px-4 py-3 font-medium">账号</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const isOpen = expanded === item.request_id;
                      return (
                        <RowGroup
                          key={item.id}
                          item={item}
                          open={isOpen}
                          onToggle={() => setExpanded(isOpen ? null : item.request_id)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {!logsQuery.isLoading && !logsQuery.isError && total > 0 && (
          <div className="mt-5 flex items-center justify-between text-sm text-(--color-muted)">
            <span>
              共 {total} 条 · 第 {page} / {pageCount} 页
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={offset <= 0 || logsQuery.isFetching}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="rounded-full border border-(--color-border) px-4 py-1.5 text-sm transition-colors hover:border-(--color-border-strong) disabled:cursor-not-allowed disabled:opacity-50"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= total || logsQuery.isFetching}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="rounded-full border border-(--color-border) px-4 py-1.5 text-sm transition-colors hover:border-(--color-border-strong) disabled:cursor-not-allowed disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </ConsoleShell>
  );
}

function RowGroup({
  item,
  open,
  onToggle
}: {
  item: LogItem;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-(--color-border) last:border-b-0 hover:bg-(--color-surface-2)"
      >
        <td className="whitespace-nowrap px-4 py-3 text-xs text-(--color-muted-2)">
          {formatTime(item.created_at)}
        </td>
        <td className="px-4 py-3">
          <SourceBadge source={item.source} />
        </td>
        <td className="max-w-[240px] truncate px-4 py-3 text-(--color-muted)" title={item.path}>
          {item.path}
        </td>
        <td className="px-4 py-3 text-(--color-muted)">{item.mode}</td>
        <td className="px-4 py-3">
          <span className={item.ok ? "text-(--color-success)" : "text-(--color-warning)"}>
            {item.ok ? "成功" : "失败"}
            {item.status_code !== null ? ` · ${item.status_code}` : ""}
          </span>
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-(--color-muted)">
          {formatDuration(item.duration_ms)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-(--color-muted)">
          {formatBytes(item.bytes_out)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-(--color-muted)">
          {item.cost_gems}
        </td>
        <td className="px-4 py-3 text-(--color-muted)">{item.key_name || "—"}</td>
        <td className="px-4 py-3 text-(--color-muted)">{item.account_label || "—"}</td>
      </tr>
      {open && (
        <tr className="border-b border-(--color-border) last:border-b-0 bg-(--color-surface-2)">
          <td colSpan={10} className="px-4 py-3">
            <p className="text-xs font-medium text-(--color-muted)">尝试明细</p>
            <Attempts requestId={item.request_id} />
          </td>
        </tr>
      )}
    </>
  );
}

function Attempts({ requestId }: { requestId: string }) {
  const attemptsQuery = useLogAttempts(requestId);
  if (attemptsQuery.isLoading) {
    return <p className="mt-2 text-xs text-(--color-muted-2)">加载中…</p>;
  }
  if (attemptsQuery.isError) {
    return <p className="mt-2 text-xs text-(--color-warning)">加载失败：{attemptsQuery.error.message}</p>;
  }
  const items = attemptsQuery.data?.items ?? [];
  if (items.length === 0) {
    return <p className="mt-2 text-xs text-(--color-muted-2)">无尝试明细。</p>;
  }
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {items.map((attempt) => (
        <li
          key={attempt.id}
          className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-(--radius-input) border border-(--color-border) bg-(--color-surface-1) px-3 py-2 text-xs"
        >
          <span className="text-(--color-muted-2)">#{attempt.attempt_no}</span>
          <span className={attempt.status_code && attempt.status_code < 400 ? "text-(--color-success)" : "text-(--color-warning)"}>
            {attempt.status_code ?? "无响应"}
          </span>
          <span className="text-(--color-muted)">{attempt.account_label || attempt.account_id || "—"}</span>
          <span className="min-w-0 flex-1 truncate text-(--color-muted-2)" title={attempt.error ?? ""}>
            {attempt.error || "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}
