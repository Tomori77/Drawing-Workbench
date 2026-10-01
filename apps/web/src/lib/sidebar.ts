import { create } from "zustand";

const STORAGE_KEY = "dw-sidebar-collapsed";

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

interface SidebarState {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (value: boolean) => void;
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  collapsed: readInitial(),
  toggle: () => get().setCollapsed(!get().collapsed),
  setCollapsed: (value) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      /* ignore storage errors */
    }
    set({ collapsed: value });
  }
}));
