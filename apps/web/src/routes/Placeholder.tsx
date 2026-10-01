import ConsoleShell from "../components/ConsoleShell";

export default function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <ConsoleShell>
      <div className="mx-auto w-full max-w-[1280px] px-5 py-10 sm:px-8">
        <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-(--color-muted)">{description}</p>

        <div className="mt-8 flex flex-col items-center justify-center rounded-(--radius-card) border border-dashed border-(--color-border-strong) bg-(--color-surface-1) py-24 text-center">
          <p className="text-sm text-(--color-muted)">此页面尚未接入后端</p>
          <p className="mt-1 text-xs text-(--color-muted-2)">功能将在后续版本中实现。</p>
        </div>
      </div>
    </ConsoleShell>
  );
}
