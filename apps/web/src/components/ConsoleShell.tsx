import { Link, NavLink, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { useSidebarStore } from "../lib/sidebar";
import {
  IconBrush,
  IconChevronLeft,
  IconDashboard,
  IconGallery,
  IconHistory,
  IconKey,
  IconLock,
  IconLog,
  IconLogo,
  IconSearch,
  IconUser
} from "./icons";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  ownerOnly?: boolean;
}

interface NavGroup {
  title: string;
  ownerOnly?: boolean;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "创作",
    items: [
      { to: "/console", label: "概览", icon: <IconDashboard className="size-4.5" /> },
      { to: "/console/playground", label: "创作台", icon: <IconBrush className="size-4.5" /> },
      { to: "/console/history", label: "本地历史", icon: <IconHistory className="size-4.5" /> },
      { to: "/gallery", label: "画廊", icon: <IconGallery className="size-4.5" /> }
    ]
  },
  {
    title: "账户",
    ownerOnly: true,
    items: [
      { to: "/console/api-keys", label: "API 密钥", icon: <IconKey className="size-4.5" /> },
      { to: "/console/logs", label: "生成日志", icon: <IconLog className="size-4.5" /> },
      { to: "/console/profile", label: "个人资料", icon: <IconUser className="size-4.5" /> }
    ]
  }
];

const CRUMB_LABELS: Record<string, string> = {
  "/console": "概览",
  "/console/playground": "创作台",
  "/console/history": "本地历史",
  "/console/api-keys": "API 密钥",
  "/console/logs": "生成日志",
  "/console/profile": "个人资料",
  "/gallery": "画廊"
};

function crumbFor(pathname: string) {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((entry) => entry.to === pathname);
    if (item) return { section: group.title, label: item.label };
  }
  return { section: "创作", label: CRUMB_LABELS[pathname] ?? "概览" };
}

export default function ConsoleShell({ children }: { children: ReactNode }) {
  const { data: auth } = useAuth();
  const collapsed = useSidebarStore((state) => state.collapsed);
  const toggle = useSidebarStore((state) => state.toggle);
  const location = useLocation();
  const isOwner = auth?.role === "owner";
  const crumb = crumbFor(location.pathname);
  const roleInitial = (auth?.role ?? "?").charAt(0).toUpperCase();

  return (
    <div className="flex min-h-dvh bg-(--color-bg)">
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-(--color-border) bg-(--color-surface-1) transition-[width] duration-200 lg:flex ${
          collapsed ? "w-(--sidebar-w-collapsed)" : "w-(--sidebar-w)"
        }`}
      >
        <div className={`flex h-14 items-center ${collapsed ? "justify-center px-3" : "px-6"}`}>
          <Link to="/console" className="group flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-(--color-text) text-white">
              <IconLogo className="size-4.5" />
            </span>
            {!collapsed && (
              <span className="truncate text-[15px] font-semibold tracking-tight">
                Drawing Workbench
              </span>
            )}
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-7 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => {
            const ownerOnly = group.ownerOnly === true;
            const locked = ownerOnly && !isOwner;
            return (
              <div key={group.title}>
                {!collapsed && (
                  <div className="flex items-center gap-1.5 px-3 pb-2 text-[11px] font-medium tracking-wide text-(--color-muted-2)">
                    <span>{group.title}</span>
                    {locked && <IconLock className="size-3" />}
                  </div>
                )}
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const itemLocked = locked || (item.ownerOnly === true && !isOwner);
                    if (itemLocked) {
                      return (
                        <div
                          key={item.to}
                          title="仅所有者可用"
                          className={`flex items-center gap-3 rounded-(--radius-input) px-3 py-2 text-sm text-(--color-muted-2) ${
                            collapsed ? "justify-center" : ""
                          }`}
                        >
                          {item.icon}
                          {!collapsed && (
                            <>
                              <span className="truncate">{item.label}</span>
                              <IconLock className="ml-auto size-3.5" />
                            </>
                          )}
                        </div>
                      );
                    }
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === "/console"}
                        className={({ isActive }) =>
                          `flex items-center gap-3 rounded-(--radius-input) px-3 py-2 text-sm transition-colors ${
                            isActive
                              ? "bg-(--color-text) font-medium text-white"
                              : "text-(--color-text) hover:bg-(--color-surface-2)"
                          } ${collapsed ? "justify-center" : ""}`
                        }
                      >
                        {item.icon}
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="p-3">
          <button
            type="button"
            onClick={toggle}
            className={`flex w-full items-center gap-3 rounded-(--radius-input) px-3 py-2 text-sm text-(--color-muted) transition-colors hover:bg-(--color-surface-2) ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <IconChevronLeft
              className={`size-4.5 transition-transform ${collapsed ? "rotate-180" : ""}`}
            />
            {!collapsed && <span>收起</span>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-(--topbar-h) shrink-0 items-center gap-4 border-b border-(--color-border) bg-white/70 px-4 backdrop-blur-xl sm:px-6">
          <nav className="flex min-w-0 items-center gap-2 text-sm text-(--color-muted)" aria-label="面包屑">
            <span className="shrink-0">{crumb.section}</span>
            <span className="text-(--color-muted-2)">/</span>
            <span className="truncate font-medium text-(--color-text)">{crumb.label}</span>
          </nav>

          <div className="mx-auto hidden w-full max-w-sm md:block">
            <button
              type="button"
              className="flex h-9 w-full items-center gap-2 rounded-full border border-(--color-border) bg-(--color-surface-2) px-4 text-sm text-(--color-muted-2) transition-colors hover:border-(--color-border-strong)"
            >
              <IconSearch className="size-4" />
              <span className="truncate">搜索或跳转…</span>
              <kbd className="ml-auto rounded border border-(--color-border) bg-(--color-surface-1) px-1.5 py-0.5 font-mono text-[10px] font-medium">
                ⌘K
              </kbd>
            </button>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <span className="hidden h-8 items-center gap-1.5 rounded-full border border-(--color-border) bg-(--color-surface-1)/80 px-3 text-xs text-(--color-muted) sm:inline-flex">
              <span className="font-medium text-(--color-text)">537</span>
              <span>Gems</span>
            </span>
            <span className="hidden items-center gap-2 sm:flex">
              <span className="text-xs text-(--color-muted-2)">{auth?.role ?? "未知"}</span>
              <span className="flex size-8 items-center justify-center rounded-full bg-(--color-primary) text-xs font-semibold text-white">
                {roleInitial}
              </span>
            </span>
          </div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
