import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
}

export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  pending = false,
  onConfirm
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-1) p-6 shadow-(--shadow-float) outline-none">
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          {description && (
            <Dialog.Description className="mt-2 text-sm leading-relaxed text-(--color-muted)">
              {description}
            </Dialog.Description>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-9 items-center rounded-full border border-(--color-border) bg-(--color-surface-1) px-4 text-sm transition-colors hover:border-(--color-border-strong)"
              >
                {cancelLabel}
              </button>
            </Dialog.Close>
            <button
              type="button"
              disabled={pending}
              onClick={onConfirm}
              className="inline-flex h-9 items-center rounded-full bg-(--color-primary) px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "处理中…" : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
