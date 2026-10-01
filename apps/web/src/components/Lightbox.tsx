import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

interface LightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string | null;
  alt?: string;
  caption?: ReactNode;
}

export default function Lightbox({ open, onOpenChange, src, alt, caption }: LightboxProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 max-h-[92dvh] w-[92vw] max-w-4xl -translate-x-1/2 -translate-y-1/2 outline-none"
        >
          <Dialog.Title className="sr-only">{alt ?? "图片预览"}</Dialog.Title>
          <div className="flex flex-col items-center gap-3">
            {src && (
              <img
                src={src}
                alt={alt ?? ""}
                className="max-h-[82dvh] w-auto rounded-(--radius-secondary) object-contain shadow-(--shadow-float)"
              />
            )}
            <div className="flex items-center gap-4">
              {caption && <p className="text-xs text-white/80">{caption}</p>}
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-full bg-white/15 px-4 py-1.5 text-sm text-white transition-colors hover:bg-white/25"
                >
                  关闭
                </button>
              </Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
