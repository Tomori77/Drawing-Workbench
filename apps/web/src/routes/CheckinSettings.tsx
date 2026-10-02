import { useEffect, useMemo, useState } from "react";
import ConsoleShell from "../components/ConsoleShell";
import {
  EmptyState,
  EnableToggle,
  Field,
  formatTime,
  inputClass
} from "../components/console-ui";
import { useAccounts } from "../hooks/useAccounts";
import {
  useCheckinAccount,
  useCheckinSettings,
  useRunCheckinTest,
  useUpdateCheckinSettings
} from "../hooks/useCheckin";
import { useUpstreams } from "../hooks/useUpstreams";
import type { AccountPublic, CheckinResult } from "../lib/api";

const STATUS_LABELS: Record<string, string> = {
  success: "成功",
  retry: "重试",
  jwt_expired: "JWT 过期",
  manual_required: "需人工",
  skipped: "跳过"
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  pending: "等待",
  active: "正常",
  success: "正常",
  retry: "重试中",
  jwt_expired: "JWT 过期",
  manual_required: "需人工",
  cooling: "冷却中"
};

function accountStatusLabel(status: string): string {
  return ACCOUNT_STATUS_LABELS[status] ?? status;
}

export default function CheckinSettings() {
  const settingsQuery = useCheckinSettings();
  const accountsQuery = useAccounts();
  const upstreamsQuery = useUpstreams();
  const updateMutation = useUpdateCheckinSettings();
  const testMutation = useRunCheckinTest();
  const checkinOneMutation = useCheckinAccount();

  const accountNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of accountsQuery.data?.items ?? []) {
      map.set(account.id, account.label || account.username);
    }
    return map;
  }, [accountsQuery.data]);

  const accounts = accountsQuery.data?.items ?? [];
  const upstreams = upstreamsQuery.data?.items ?? [];

  const groups = useMemo(() => {
    const order: string[] = [];
    const byId = new Map<string, AccountPublic[]>();
    for (const upstream of upstreams) {
      if (!byId.has(upstream.id)) {
        byId.set(upstream.id, []);
        order.push(upstream.id);
      }
    }
    for (const account of accounts) {
      if (!byId.has(account.upstream_id)) {
        byId.set(account.upstream_id, []);
        order.push(account.upstream_id);
      }
      byId.get(account.upstream_id)!.push(account);
    }
    return order.map((id) => ({
      id,
      name: upstreams.find((upstream) => upstream.id === id)?.name || id,
      accounts: byId.get(id) ?? []
    }));
  }, [accounts, upstreams]);

  const settings = settingsQuery.data;

  const [enabled, setEnabled] = useState(true);
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [weekdayTimes, setWeekdayTimes] = useState<string[]>(["09:05"]);
  const [weekendTimes, setWeekendTimes] = useState<string[]>(["10:00"]);

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setTimezone(settings.timezone);
    setWeekdayTimes(settings.weekday_times);
    setWeekendTimes(settings.weekend_times);
  }, [settings]);

  const dirty = useMemo(() => {
    if (!settings) return false;
    return (
      enabled !== settings.enabled ||
      timezone !== settings.timezone ||
      weekdayTimes.join(",") !== settings.weekday_times.join(",") ||
      weekendTimes.join(",") !== settings.weekend_times.join(",")
    );
  }, [settings, enabled, timezone, weekdayTimes, weekendTimes]);

  const save = () => {
    updateMutation.mutate({
      enabled,
      timezone: timezone.trim(),
      weekday_times: weekdayTimes,
      weekend_times: weekendTimes
    });
  };

  return (
    <ConsoleShell>
      <div className="mx-auto w-full max-w-[960px] px-5 py-10 sm:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">签到设置</h1>
            <p className="mt-1 text-sm text-(--color-muted)">
              配置自动签到计划，或手动测试全部账号的签到状态。
            </p>
          </div>
          <button
            type="button"
            disabled={testMutation.isPending}
            onClick={() => testMutation.mutate()}
            className="inline-flex h-10 items-center rounded-full border border-(--color-border) bg-(--color-surface-1) px-4 text-sm transition-colors hover:border-(--color-border-strong) disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testMutation.isPending ? "测试中…" : "立即测试全部账号"}
          </button>
        </header>

        {settingsQuery.isLoading ? (
          <div className="mt-6">
            <EmptyState title="加载中…" />
          </div>
        ) : settingsQuery.isError ? (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) py-24 text-center">
            <p className="text-sm text-(--color-warning)">加载失败：{settingsQuery.error.message}</p>
            <button
              type="button"
              onClick={() => settingsQuery.refetch()}
              className="rounded-full border border-(--color-border) px-4 py-1.5 text-sm transition-colors hover:border-(--color-border-strong)"
            >
              重试
            </button>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-6">
            <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) p-6 shadow-(--shadow-card)">
              <div className="flex flex-col gap-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">启用自动签到</p>
                    <p className="mt-0.5 text-xs text-(--color-muted-2)">
                      关闭后定时任务将跳过签到。
                    </p>
                  </div>
                  <EnableToggle
                    enabled={enabled}
                    pending={false}
                    onToggle={() => setEnabled((prev) => !prev)}
                  />
                </div>

                <Field label="时区" hint="IANA 名称，后端校验">
                  <input
                    className={inputClass}
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    placeholder="Asia/Shanghai"
                  />
                </Field>

                <TimeSlots
                  label="工作日签到时间"
                  times={weekdayTimes}
                  onChange={setWeekdayTimes}
                />
                <TimeSlots label="周末签到时间" times={weekendTimes} onChange={setWeekendTimes} />
              </div>

              {updateMutation.isError && (
                <p className="mt-3 text-sm text-(--color-warning)">
                  保存失败：{updateMutation.error.message}
                </p>
              )}
              {updateMutation.isSuccess && !dirty && (
                <p className="mt-3 text-sm text-(--color-success)">设置已保存。</p>
              )}
              {settings && !weekdayTimes.length && !weekendTimes.length && (
                <p className="mt-3 text-sm text-(--color-warning)">工作日与周末至少各保留一个时间。</p>
              )}

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  disabled={
                    updateMutation.isPending ||
                    !dirty ||
                    (!weekdayTimes.length && !weekendTimes.length)
                  }
                  onClick={save}
                  className="inline-flex h-9 items-center rounded-full bg-(--color-primary) px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updateMutation.isPending ? "保存中…" : "保存设置"}
                </button>
              </div>
            </section>

            <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) p-6 shadow-(--shadow-card)">
              <h2 className="text-sm font-medium">运行状态</h2>
              {settings ? (
                <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                  <InfoRow label="状态" value={statusLabel(settings.status)} />
                  <InfoRow label="下次运行" value={formatTime(settings.next_run_at)} />
                  <InfoRow label="租约到期" value={formatTime(settings.lease_until)} />
                  <InfoRow label="更新时间" value={formatTime(settings.updated_at)} />
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-(--color-muted-2)">最近消息</dt>
                    <dd className="mt-0.5 break-words text-(--color-muted)">
                      {settings.last_message || "—"}
                    </dd>
                  </div>
                </dl>
              ) : null}
            </section>

            <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) p-6 shadow-(--shadow-card)">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-medium">账号池（按上游分组）</h2>
                <span className="text-xs text-(--color-muted-2)">共 {accounts.length} 个账号</span>
              </div>

              {accountsQuery.isLoading || upstreamsQuery.isLoading ? (
                <p className="mt-3 text-sm text-(--color-muted-2)">加载中…</p>
              ) : accountsQuery.isError ? (
                <p className="mt-3 text-sm text-(--color-warning)">
                  加载账号失败：{accountsQuery.error.message}
                </p>
              ) : accounts.length === 0 ? (
                <p className="mt-3 text-sm text-(--color-muted-2)">还没有账号。</p>
              ) : (
                <div className="mt-4 flex flex-col gap-5">
                  {groups.map((group) => (
                    <div key={group.id}>
                      <div className="flex items-center justify-between border-b border-(--color-border) pb-2">
                        <h3 className="text-sm font-medium text-(--color-text)">{group.name}</h3>
                        <span className="text-xs text-(--color-muted-2)">
                          {group.accounts.length} 个账号
                        </span>
                      </div>
                      {group.accounts.length === 0 ? (
                        <p className="mt-2 text-xs text-(--color-muted-2)">该上游暂无账号。</p>
                      ) : (
                        <ul className="mt-2 flex flex-col divide-y divide-(--color-border)">
                          {group.accounts.map((account) => {
                            const pending =
                              checkinOneMutation.isPending &&
                              checkinOneMutation.variables === account.id;
                            const result =
                              checkinOneMutation.data?.account_id === account.id
                                ? checkinOneMutation.data
                                : null;
                            const error =
                              checkinOneMutation.isError &&
                              checkinOneMutation.variables === account.id
                                ? checkinOneMutation.error.message
                                : null;
                            return (
                              <li
                                key={account.id}
                                className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm"
                              >
                                <span className="min-w-0 flex-1 truncate font-medium">
                                  {account.label || account.username}
                                </span>
                                <span className="text-xs text-(--color-muted)">
                                  {accountStatusLabel(account.status)}
                                </span>
                                <span className="text-xs tabular-nums text-(--color-muted)">
                                  Gems {account.gems_last ?? "—"}
                                </span>
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[11px] ${
                                    account.has_api_token
                                      ? "border-(--color-border) text-(--color-muted)"
                                      : "border-(--color-warning)/50 bg-(--color-warning)/10 font-medium text-(--color-warning)"
                                  }`}
                                >
                                  {account.has_api_token ? "Token" : "缺 Token"}
                                </span>
                                {result && (
                                  <span
                                    className={`max-w-52 truncate text-xs ${
                                      result.ok ? "text-(--color-success)" : "text-(--color-warning)"
                                    }`}
                                    title={result.message}
                                  >
                                    {result.ok ? "成功" : "失败"} · {statusLabel(result.status)} ·{" "}
                                    {result.message}
                                  </span>
                                )}
                                {error && (
                                  <span className="max-w-52 truncate text-xs text-(--color-warning)" title={error}>
                                    {error}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => checkinOneMutation.mutate(account.id)}
                                  className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {pending ? "签到中…" : "单独签到"}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) p-6 shadow-(--shadow-card)">
              <h2 className="text-sm font-medium">账号签到测试结果</h2>
              {testMutation.data ? (
                <>
                  <p className="mt-2 text-sm text-(--color-muted)">
                    共 {testMutation.data.total} 个账号 · 成功{" "}
                    <span className="font-semibold text-(--color-success)">
                      {testMutation.data.success}
                    </span>
                  </p>
                  <TestResultList
                    items={testMutation.data.items}
                    accountNames={accountNames}
                  />
                </>
              ) : testMutation.isError ? (
                <p className="mt-3 text-sm text-(--color-warning)">
                  测试失败：{testMutation.error.message}
                </p>
              ) : (
                <p className="mt-2 text-sm text-(--color-muted-2)">
                  点击右上角「立即测试全部账号」查看结果。
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </ConsoleShell>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-(--color-muted-2)">{label}</dt>
      <dd className="mt-0.5 text-(--color-text)">{value}</dd>
    </div>
  );
}

function TimeSlots({
  label,
  times,
  onChange
}: {
  label: string;
  times: string[];
  onChange: (times: string[]) => void;
}) {
  const update = (index: number, value: string) => {
    onChange(times.map((time, i) => (i === index ? value : time)));
  };
  const remove = (index: number) => {
    onChange(times.filter((_, i) => i !== index));
  };
  const add = () => {
    onChange([...times, "09:00"]);
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-(--color-muted)">{label}</span>
      <div className="flex flex-col gap-2">
        {times.map((time, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="time"
              value={time}
              onChange={(e) => update(index, e.target.value)}
              className={`${inputClass} max-w-40`}
            />
            <button
              type="button"
              onClick={() => remove(index)}
              className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) transition-colors hover:border-(--color-warning)/50 hover:text-(--color-warning)"
            >
              删除
            </button>
          </div>
        ))}
        {times.length === 0 && <p className="text-xs text-(--color-muted-2)">暂无时间，请至少添加一个。</p>}
      </div>
      <button
        type="button"
        onClick={add}
        className="mt-1 inline-flex w-fit items-center rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text)"
      >
        添加时间
      </button>
    </div>
  );
}

function TestResultList({
  items,
  accountNames
}: {
  items: CheckinResult[];
  accountNames: Map<string, string>;
}) {
  if (items.length === 0) {
    return <p className="mt-3 text-sm text-(--color-muted-2)">没有启用的账号可供测试。</p>;
  }
  return (
    <ul className="mt-4 flex flex-col divide-y divide-(--color-border) overflow-hidden rounded-(--radius-input) border border-(--color-border)">
      {items.map((item) => (
        <li key={item.account_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
          <span className="min-w-0 flex-1 truncate">
            {accountNames.get(item.account_id) ?? item.account_id}
          </span>
          <span className={item.ok ? "text-(--color-success)" : "text-(--color-warning)"}>
            {item.ok ? "成功" : "失败"}
          </span>
          <span className="text-(--color-muted)">{statusLabel(item.status)}</span>
          <span className="min-w-0 flex-[2] truncate text-xs text-(--color-muted-2)" title={item.message}>
            {item.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
