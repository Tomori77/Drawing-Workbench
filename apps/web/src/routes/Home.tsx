import { Link } from "react-router-dom";
import ConsoleShell from "../components/ConsoleShell";
import { useAuth } from "../hooks/useAuth";
import { useAccounts } from "../hooks/useAccounts";
import { useGallery } from "../hooks/useGallery";
import { quickActions } from "../lib/mock";
import {
  IconArrowUpRight,
  IconGallery,
  IconKey,
  IconPlay,
  IconPlus,
  IconSpark
} from "../components/icons";

function actionIcon(icon: string) {
  if (icon === "play") return <IconPlay className="size-4.5" />;
  if (icon === "gallery") return <IconGallery className="size-4.5" />;
  if (icon === "key") return <IconKey className="size-4.5" />;
  return <IconSpark className="size-4.5" />;
}

export default function Home() {
  const { data: auth } = useAuth();
  const isOwner = auth?.role === "owner";
  const accountsQuery = useAccounts(undefined, isOwner);
  const galleryQuery = useGallery(undefined, "mine", 1);
  const total = galleryQuery.data?.pages[0]?.total;
  const poolGems = accountsQuery.data?.total_gems;
  const stats = [
    {
      label: "Gems 余额",
      value: isOwner && poolGems !== undefined ? String(poolGems) : "—",
      unit: "Gems",
      hint:
        isOwner && poolGems !== undefined
          ? "账号池中全部账号的余额合计"
          : "仅所有者可见"
    },
    { label: "图包次数", value: "—", hint: "免费额度与图包权益接口尚未接入" },
    { label: "已消耗 Gems", value: "—", unit: "Gems", hint: "账户池用量接口尚未接入" },
    {
      label: "作品数",
      value: total === undefined ? "—" : String(total),
      hint: "画廊中已保存的作品总数"
    }
  ];

  return (
    <ConsoleShell>
      <div className="mx-auto w-full max-w-[1280px] px-5 py-10 sm:px-8">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">概览</h1>
            <p className="mt-1 text-sm text-(--color-muted)">
              欢迎回来，{auth?.role ?? "朋友"} · 这是你的账户概况。
            </p>
          </div>
          <Link
            to="/console/playground"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-(--color-primary) px-5 text-sm font-medium text-white shadow-(--shadow-card) transition-opacity hover:opacity-90"
          >
            <IconPlus className="size-4" />
            新建图片
          </Link>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) p-5 shadow-(--shadow-card)"
            >
              <p className="text-sm text-(--color-muted)">{stat.label}</p>
              <p className="mt-3 flex items-baseline gap-1.5">
                <span className="text-[30px] font-semibold tracking-tight tabular-nums">
                  {stat.value}
                </span>
                {stat.unit && <span className="text-sm text-(--color-muted-2)">{stat.unit}</span>}
              </p>
              {stat.hint && (
                <p className="mt-2 text-xs leading-relaxed text-(--color-muted-2)">{stat.hint}</p>
              )}
            </div>
          ))}
        </section>

        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">快捷操作</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {quickActions.map((action) => {
              const inner = (
                <>
                  <span className="flex size-10 items-center justify-center rounded-(--radius-input) bg-(--color-surface-2) text-(--color-text)">
                    {actionIcon(action.icon)}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">{action.title}</p>
                    <p className="truncate text-sm text-(--color-muted)">{action.description}</p>
                  </div>
                  <IconArrowUpRight className="ml-auto size-4 text-(--color-muted-2)" />
                </>
              );
              return (
                <Link
                  key={action.title}
                  to={action.to}
                  className="flex items-center gap-4 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) p-5 transition-colors hover:border-(--color-border-strong)"
                >
                  {inner}
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </ConsoleShell>
  );
}
