import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export const inputClass =
  "h-9 w-full rounded-(--radius-input) border border-(--color-border) bg-(--color-surface-1) px-3 text-sm outline-none placeholder:text-(--color-muted-2) focus:border-(--color-primary)";

export function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-xs font-medium text-(--color-muted)">
        <span>{label}</span>
        {hint && <span className="font-normal text-(--color-muted-2)">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-(--radius-card) border border-dashed border-(--color-border-strong) bg-(--color-surface-1) py-24 text-center">
      <p className="text-sm font-medium text-(--color-muted)">{title}</p>
      {description && <p className="text-xs text-(--color-muted-2)">{description}</p>}
    </div>
  );
}

export function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  children
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) p-6 shadow-(--shadow-float) outline-none">
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          {description && (
            <Dialog.Description className="mt-1.5 text-sm text-(--color-muted)">
              {description}
            </Dialog.Description>
          )}
          <div className="mt-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function DialogActions({
  pending,
  disabled,
  confirmLabel,
  onCancel,
  onConfirm
}: {
  pending: boolean;
  disabled?: boolean;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-6 flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-9 items-center rounded-full border border-(--color-border) bg-(--color-surface-1) px-4 text-sm transition-colors hover:border-(--color-border-strong)"
      >
        取消
      </button>
      <button
        type="button"
        disabled={pending || disabled}
        onClick={onConfirm}
        className="inline-flex h-9 items-center rounded-full bg-(--color-primary) px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "处理中…" : confirmLabel}
      </button>
    </div>
  );
}

export function EnableToggle({
  enabled,
  pending,
  onToggle
}: {
  enabled: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={pending}
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        enabled ? "bg-(--color-success)" : "bg-(--color-border-strong)"
      }`}
      title={enabled ? "已启用" : "已停用"}
    >
      <span
        className={`inline-block size-4 transform rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
