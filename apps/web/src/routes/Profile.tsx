import { useEffect, useMemo, useState } from "react";
import ConsoleShell from "../components/ConsoleShell";
import { EmptyState, Field, inputClass } from "../components/console-ui";
import { useProfile, useUpdateProfile } from "../hooks/useProfile";

const ROLE_LABELS: Record<string, string> = {
  owner: "拥有者",
  friend: "访客"
};

const AVATAR_PRESETS = ["#0071e3", "#248a3d", "#b25000", "#7d3cff", "#d70015", "#1d1d1f"];

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

function preferenceNote(preferences: Record<string, unknown>): string {
  return typeof preferences.note === "string" ? preferences.note : "";
}

export default function Profile() {
  const profileQuery = useProfile();
  const updateMutation = useUpdateProfile();

  const profile = profileQuery.data;

  const [nickname, setNickname] = useState("");
  const [avatarColor, setAvatarColor] = useState("#0071e3");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!profile) return;
    setNickname(profile.nickname);
    setAvatarColor(profile.avatar_color);
    setNote(preferenceNote(profile.preferences));
  }, [profile]);

  const dirty = useMemo(() => {
    if (!profile) return false;
    return (
      nickname.trim() !== profile.nickname ||
      avatarColor.toLowerCase() !== profile.avatar_color.toLowerCase() ||
      note.trim() !== preferenceNote(profile.preferences)
    );
  }, [profile, nickname, avatarColor, note]);

  const initial = (nickname.trim() || roleLabel(profile?.identity.role ?? "") || "?").charAt(0).toUpperCase();

  const save = () => {
    if (!profile) return;
    updateMutation.mutate({
      nickname: nickname.trim(),
      avatar_color: avatarColor,
      preferences: { ...profile.preferences, note: note.trim() }
    });
  };

  return (
    <ConsoleShell>
      <div className="mx-auto w-full max-w-[960px] px-5 py-10 sm:px-8">
        <header>
          <h1 className="text-[28px] font-semibold tracking-tight">个人资料</h1>
          <p className="mt-1 text-sm text-(--color-muted)">
            查看当前身份与站点信息，并维护昵称、头像颜色与偏好备注。
          </p>
        </header>

        {profileQuery.isLoading ? (
          <div className="mt-6">
            <EmptyState title="加载中…" />
          </div>
        ) : profileQuery.isError ? (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) py-24 text-center">
            <p className="text-sm text-(--color-warning)">加载失败：{profileQuery.error.message}</p>
            <button
              type="button"
              onClick={() => profileQuery.refetch()}
              className="rounded-full border border-(--color-border) px-4 py-1.5 text-sm transition-colors hover:border-(--color-border-strong)"
            >
              重试
            </button>
          </div>
        ) : profile ? (
          <div className="mt-6 flex flex-col gap-6">
            <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) p-6 shadow-(--shadow-card)">
              <div className="flex items-center gap-4">
                <span
                  className="flex size-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white"
                  style={{ backgroundColor: profile.avatar_color }}
                >
                  {initial}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-base font-medium">
                    {profile.nickname || "未设置昵称"}
                  </p>
                  <p className="mt-0.5 text-xs text-(--color-muted-2)">
                    身份：{roleLabel(profile.identity.role)}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) p-6 shadow-(--shadow-card)">
              <h2 className="text-sm font-medium">站点信息</h2>
              <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                <InfoRow label="域名" value={profile.site.domain || "—"} />
                <InfoRow label="版本" value={profile.site.version} />
                <InfoRow label="环境" value={profile.site.environment} />
                <InfoRow label="身份" value={roleLabel(profile.identity.role)} />
                <InfoRow label="账号数" value={String(profile.site.counts.accounts)} />
                <InfoRow label="上游数" value={String(profile.site.counts.upstreams)} />
                <InfoRow label="密钥数" value={String(profile.site.counts.api_keys)} />
                <InfoRow label="生成数" value={String(profile.site.counts.generations)} />
                <InfoRow label="日志数" value={String(profile.site.counts.logs)} />
              </dl>
            </section>

            <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) p-6 shadow-(--shadow-card)">
              <h2 className="text-sm font-medium">编辑资料</h2>
              <div className="mt-4 flex flex-col gap-5">
                <Field label="昵称" hint="最多 40 字">
                  <input
                    className={inputClass}
                    value={nickname}
                    maxLength={40}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="用于界面展示的称呼"
                  />
                </Field>

                <Field label="头像颜色">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="color"
                      value={avatarColor}
                      onChange={(e) => setAvatarColor(e.target.value)}
                      className="h-9 w-14 cursor-pointer rounded-(--radius-input) border border-(--color-border) bg-(--color-surface-1) p-1"
                      aria-label="选择头像颜色"
                    />
                    {AVATAR_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        aria-label={`使用颜色 ${preset}`}
                        onClick={() => setAvatarColor(preset)}
                        className={`size-7 rounded-full border-2 transition-transform hover:scale-105 ${
                          avatarColor.toLowerCase() === preset
                            ? "border-(--color-text)"
                            : "border-transparent"
                        }`}
                        style={{ backgroundColor: preset }}
                      />
                    ))}
                    <span className="font-mono text-xs text-(--color-muted-2)">{avatarColor}</span>
                  </div>
                </Field>

                <Field label="偏好备注" hint="仅你可见">
                  <textarea
                    className="min-h-24 w-full rounded-(--radius-input) border border-(--color-border) bg-(--color-surface-1) px-3 py-2 text-sm outline-none placeholder:text-(--color-muted-2) focus:border-(--color-primary)"
                    value={note}
                    maxLength={500}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="记录个人偏好或备忘，例如常用尺寸、默认模型等。"
                  />
                </Field>
              </div>

              {updateMutation.isError && (
                <p className="mt-3 text-sm text-(--color-warning)">
                  保存失败：{updateMutation.error.message}
                </p>
              )}
              {updateMutation.isSuccess && !dirty && (
                <p className="mt-3 text-sm text-(--color-success)">资料已保存。</p>
              )}

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  disabled={updateMutation.isPending || !dirty}
                  onClick={save}
                  className="inline-flex h-9 items-center rounded-full bg-(--color-primary) px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updateMutation.isPending ? "保存中…" : "保存"}
                </button>
              </div>
            </section>

            <p className="text-xs text-(--color-muted-2)">
              上次更新：{profile.updated_at || "—"}
            </p>
          </div>
        ) : null}
      </div>
    </ConsoleShell>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-(--color-muted-2)">{label}</dt>
      <dd className="mt-0.5 break-words text-(--color-text)">{value}</dd>
    </div>
  );
}
