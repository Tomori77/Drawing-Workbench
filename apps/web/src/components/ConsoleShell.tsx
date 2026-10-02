import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "../hooks/useAuth";
import { useSidebarStore } from "../lib/sidebar";
import {
  IconBrush,
  IconCalendar,
  IconChevronLeft,
  IconClose,
  IconDashboard,
  IconGallery,
  IconHistory,
  IconKey,
  IconLog,
  IconLogo,
  IconMenu,
  IconSearch,
  IconServer,
  IconUser,
  IconWallet
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
      { to: "/console/accounts", label: "账号池", icon: <IconWallet className="size-4.5" /> },
      { to: "/console/api-keys", label: "API 密钥", icon: <IconKey className="size-4.5" /> },
      { to: "/console/checkin", label: "签到设置", icon: <IconCalendar className="size-4.5" /> },
      { to: "/console/upstreams", label: "上游", icon: <IconServer className="size-4.5" /> },
      { to: "/console/logs", label: "生成日志", icon: <IconLog className="size-4.5" /> },
      { to: "/console/profile", label: "个人资料", icon: <IconUser className="size-4.5" /> }
    ]
  }
];

const CRUMB_LABELS: Record<string, string> = {
  "/console": "概览",
  "/console/playground": "创作台",
  "/console/history": "本地历史",
  "/console/accounts": "账号池",
  "/console/api-keys": "API 密钥",
  "/console/checkin": "签到设置",
  "/console/upstreams": "上游",
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

function navGroupsFor(isOwner: boolean): NavGroup[] {
  return NAV_GROUPS.filter((group) => !(group.ownerOnly === true && !isOwner));
}

function NavItems({
  isOwner,
  collapsed,
  onNavigate
}: {
  isOwner: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-1 flex-col gap-7 overflow-y-auto px-3 py-4">
      {navGroupsFor(isOwner).map((group) => (
        <div key={group.title}>
          {!collapsed && (
            <div className="px-3 pb-2 text-[11px] font-medium tracking-wide text-(--color-muted-2)">
              {group.title}
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {group.items
              .filter((item) => !(item.ownerOnly === true && !isOwner))
              .map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/console"}
                  onClick={onNavigate}
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
              ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Brand({ className }: { className?: string }) {
  return (
    <Link to="/console" className={`group flex min-w-0 items-center gap-2.5 ${className ?? ""}`}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-(--color-text) text-white">
        <IconLogo className="size-4.5" />
      </span>
      <span className="truncate text-[15px] font-semibold tracking-tight">
        Drawing Workbench
      </span>
    </Link>
  );
}

export default function ConsoleShell({ children }: { children: ReactNode }) {
  const { data: auth } = useAuth();
  const collapsed = useSidebarStore((state) => state.collapsed);
  const toggle = useSidebarStore((state) => state.toggle);
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isOwner = auth?.role === "owner";
  const crumb = crumbFor(location.pathname);
  const roleInitial = (auth?.role ?? "?").charAt(0).toUpperCase();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex min-h-dvh bg-(--color-bg)">
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-(--color-border) bg-(--color-surface-1) transition-[width] duration-200 lg:flex ${
          collapsed ? "w-(--sidebar-w-collapsed)" : "w-(--sidebar-w)"
        }`}
      >
        <div className={`flex h-14 items-center ${collapsed ? "justify-center px-3" : "px-6"}`}>
          {collapsed ? (
            <Link
              to="/console"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-(--color-text) text-white"
            >
              <IconLogo className="size-4.5" />
            </Link>
          ) : (
            <Brand />
          )}
        </div>

        <NavItems isOwner={isOwner} collapsed={collapsed} />

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

      <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[82vw] max-w-xs flex-col border-r border-(--color-border) bg-(--color-surface-1) shadow-(--shadow-float) outline-none lg:hidden">
            <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-(--color-border) px-4">
              <Dialog.Title asChild>
                <Brand />
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="关闭导航"
                  className="flex size-8 shrink-0 items-center justify-center rounded-(--radius-input) text-(--color-muted) transition-colors hover:bg-(--color-surface-2)"
                >
                  <IconClose className="size-4.5" />
                </button>
              </Dialog.Close>
            </div>
            <NavItems isOwner={isOwner} collapsed={false} onNavigate={() => setDrawerOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-(--topbar-h) shrink-0 items-center gap-3 border-b border-(--color-border) bg-white/70 px-4 backdrop-blur-xl sm:gap-4 sm:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="打开导航"
            className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-(--radius-input) text-(--color-text) transition-colors hover:bg-(--color-surface-2) lg:hidden"
          >
            <IconMenu className="size-5" />
          </button>

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
              <span className="font-medium text-(--color-text)">—</span>
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
