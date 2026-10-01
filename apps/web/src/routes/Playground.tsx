import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import * as Slider from "@radix-ui/react-slider";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import ConsoleShell from "../components/ConsoleShell";
import { IconPlus, IconSpark } from "../components/icons";
import {
  actionTabs,
  canvasSizes,
  modelOptions,
  noiseScheduleOptions,
  samplerOptions
} from "../lib/mock";

interface SelectMenuProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
}

function SelectMenu({ value, options, onChange, ariaLabel }: SelectMenuProps) {
  const current = options.find((option) => option.value === value);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="flex h-9 w-full items-center justify-between gap-2 rounded-(--radius-input) border border-(--color-border) bg-(--color-surface-1) px-3 text-sm text-(--color-text) outline-none transition-colors hover:border-(--color-border-strong) focus-visible:ring-4 focus-visible:ring-(--color-primary)/15"
        >
          <span className="truncate">{current?.label ?? value}</span>
          <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-(--color-muted-2)" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className="z-50 max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto rounded-(--radius-input) border border-(--color-border) bg-(--color-surface-1) p-1 shadow-(--shadow-float)"
        >
          {options.map((option) => (
            <DropdownMenu.Item
              key={option.value}
              onSelect={() => onChange(option.value)}
              className={`flex cursor-pointer items-center rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-(--color-surface-2) ${
                option.value === value ? "font-medium" : "text-(--color-muted)"
              }`}
            >
              {option.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-(--color-muted)">{label}</span>
      </div>
      {children}
    </div>
  );
}

function PanelSection({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <section className="border-b border-(--color-border) px-4 py-4 last:border-b-0">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
        <span>{title}</span>
        {meta && <span className="text-xs font-normal text-(--color-muted-2)">{meta}</span>}
      </div>
      <div className="flex flex-col gap-3.5">{children}</div>
    </section>
  );
}

type PromptTab = "positive" | "negative";

export default function Playground() {
  const [model, setModel] = useState(modelOptions[0].value);
  const [action, setAction] = useState(actionTabs[0].value);
  const [size, setSize] = useState(canvasSizes[0].ratio);
  const [sampler, setSampler] = useState(samplerOptions[0]);
  const [schedule, setSchedule] = useState(noiseScheduleOptions[0]);
  const [steps, setSteps] = useState(28);
  const [guidance, setGuidance] = useState(5);
  const [seed, setSeed] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [promptTab, setPromptTab] = useState<PromptTab>("positive");

  const positiveTokens = Math.ceil(prompt.length / 4);
  const negativeTokens = Math.ceil(negative.length / 4);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        /* 生图后端尚未接入，占位不发起请求 */
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <ConsoleShell>
      <div className="flex min-h-[calc(100dvh-var(--topbar-h))]">
        <aside className="hidden w-80 shrink-0 flex-col border-r border-(--color-border) bg-(--color-surface-1) lg:flex">
          <div className="flex h-12 items-center justify-between border-b border-(--color-border) px-4">
            <span className="text-sm font-semibold">参数</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-(--color-border) px-2.5 py-1 text-xs text-(--color-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text)"
            >
              <IconPlus className="size-3" />
              从 PNG 导入
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <PanelSection title="模型">
              <Field label="模型">
                <SelectMenu ariaLabel="模型" value={model} options={modelOptions} onChange={setModel} />
              </Field>
              <Tabs.Root value={action} onValueChange={setAction}>
                <Tabs.List className="grid grid-cols-2 gap-1 rounded-(--radius-input) bg-(--color-surface-2) p-1">
                  {actionTabs.map((tab) => (
                    <Tabs.Trigger
                      key={tab.value}
                      value={tab.value}
                      className="rounded-lg px-2 py-1.5 text-xs text-(--color-muted) outline-none transition-colors data-[state=active]:bg-(--color-surface-1) data-[state=active]:font-medium data-[state=active]:text-(--color-text) data-[state=active]:shadow-(--shadow-glass)"
                    >
                      {tab.label}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>
              </Tabs.Root>
            </PanelSection>

            <PanelSection title="画布" meta={size}>
              <div className="grid grid-cols-2 gap-2">
                {canvasSizes.map((option) => {
                  const active = option.ratio === size;
                  return (
                    <button
                      key={option.ratio}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSize(option.ratio)}
                      className={`flex h-12 flex-col items-center justify-center rounded-(--radius-input) border text-xs transition-colors ${
                        active
                          ? "border-(--color-text) bg-(--color-surface-2) font-medium"
                          : "border-(--color-border) bg-(--color-surface-2)/40 text-(--color-muted) hover:border-(--color-border-strong)"
                      }`}
                    >
                      <span>{option.label}</span>
                      <span className="text-[11px] text-(--color-muted-2)">{option.ratio}</span>
                    </button>
                  );
                })}
              </div>
            </PanelSection>

            <PanelSection title="采样">
              <Field label="采样器">
                <SelectMenu
                  ariaLabel="采样器"
                  value={sampler}
                  options={samplerOptions.map((s) => ({ value: s, label: s }))}
                  onChange={setSampler}
                />
              </Field>
              <Field label="噪声调度">
                <SelectMenu
                  ariaLabel="噪声调度"
                  value={schedule}
                  options={noiseScheduleOptions.map((s) => ({ value: s, label: s }))}
                  onChange={setSchedule}
                />
              </Field>
              <Field label="步数">
                <div className="flex items-center gap-3">
                  <Slider.Root
                    value={[steps]}
                    min={1}
                    max={50}
                    step={1}
                    onValueChange={([v]) => setSteps(v)}
                    className="relative flex h-5 w-full touch-none items-center select-none"
                  >
                    <Slider.Track className="relative h-1 grow rounded-full bg-(--color-surface-2)">
                      <Slider.Range className="absolute h-full rounded-full bg-(--color-primary)" />
                    </Slider.Track>
                    <Slider.Thumb className="block size-4 rounded-full border border-black/5 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.25)] outline-none transition-transform hover:scale-110 focus-visible:ring-4 focus-visible:ring-(--color-primary)/30" />
                  </Slider.Root>
                  <span className="w-8 shrink-0 text-right text-sm tabular-nums">{steps}</span>
                </div>
              </Field>
              <Field label="提示词引导">
                <div className="flex items-center gap-3">
                  <Slider.Root
                    value={[guidance]}
                    min={0}
                    max={10}
                    step={0.1}
                    onValueChange={([v]) => setGuidance(Math.round(v * 10) / 10)}
                    className="relative flex h-5 w-full touch-none items-center select-none"
                  >
                    <Slider.Track className="relative h-1 grow rounded-full bg-(--color-surface-2)">
                      <Slider.Range className="absolute h-full rounded-full bg-(--color-primary)" />
                    </Slider.Track>
                    <Slider.Thumb className="block size-4 rounded-full border border-black/5 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.25)] outline-none transition-transform hover:scale-110 focus-visible:ring-4 focus-visible:ring-(--color-primary)/30" />
                  </Slider.Root>
                  <span className="w-8 shrink-0 text-right text-sm tabular-nums">
                    {guidance.toFixed(1)}
                  </span>
                </div>
              </Field>
              <Field label="种子">
                <input
                  type="text"
                  inputMode="numeric"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder="随机"
                  className="h-9 w-full rounded-(--radius-input) border border-(--color-border) bg-(--color-surface-1) px-3 text-sm outline-none placeholder:text-(--color-muted-2) focus:border-(--color-primary)"
                />
              </Field>
            </PanelSection>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <section className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
            <div className="flex flex-col items-center text-center">
              <span className="mb-4 flex size-16 items-center justify-center rounded-full border border-(--color-border) bg-(--color-surface-1) text-(--color-muted-2) shadow-(--shadow-card)">
                <IconSpark className="size-7" />
              </span>
              <p className="text-base font-medium">你的作品将显示在这里</p>
              <p className="mt-1 text-sm text-(--color-muted)">描述画面，选择模型，然后点击生成。</p>
            </div>
          </section>

          <section className="mx-2 mb-2 flex flex-col rounded-2xl border border-(--color-border) bg-(--color-surface-1) shadow-(--shadow-float)">
            <Tabs.Root value={promptTab} onValueChange={(v) => setPromptTab(v as PromptTab)}>
              <div className="flex items-center justify-between border-b border-(--color-border) px-4 pt-3">
                <Tabs.List className="flex gap-4">
                  <Tabs.Trigger
                    value="positive"
                    className="border-b-2 border-transparent pb-2.5 text-sm text-(--color-muted) outline-none data-[state=active]:border-(--color-text) data-[state=active]:font-medium data-[state=active]:text-(--color-text)"
                  >
                    提示
                    <span className="ml-1.5 text-xs text-(--color-muted-2)">{positiveTokens}</span>
                  </Tabs.Trigger>
                  <Tabs.Trigger
                    value="negative"
                    className="border-b-2 border-transparent pb-2.5 text-sm text-(--color-muted) outline-none data-[state=active]:border-(--color-text) data-[state=active]:font-medium data-[state=active]:text-(--color-text)"
                  >
                    负面提示词
                    <span className="ml-1.5 text-xs text-(--color-muted-2)">{negativeTokens}</span>
                  </Tabs.Trigger>
                </Tabs.List>
                <span className="pb-2.5 text-xs text-(--color-muted-2)">相关标签</span>
              </div>

              <Tabs.Content value="positive" className="px-4 pt-3 outline-none">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="描述你想生成的画面，例如：1girl, solo, …"
                  rows={4}
                  className="w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-(--color-muted-2)"
                />
              </Tabs.Content>
              <Tabs.Content value="negative" className="px-4 pt-3 outline-none">
                <textarea
                  value={negative}
                  onChange={(e) => setNegative(e.target.value)}
                  placeholder="不希望出现的内容，例如：lowres, bad anatomy, …"
                  rows={4}
                  className="w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-(--color-muted-2)"
                />
              </Tabs.Content>
            </Tabs.Root>

            <div className="flex items-center justify-between gap-3 border-t border-(--color-border) px-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs text-(--color-muted)">
                  <IconSpark className="size-3 text-(--color-success)" />
                  <span className="truncate">0 Gems · 先用免费额度，再用图片权益（剩余 0 张）</span>
                </p>
                <p className="mt-1 text-[11px] text-(--color-muted-2)">
                  {prompt.length + negative.length} 字符 · 单次请求 × 1
                </p>
              </div>
              <button
                type="button"
                className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-(--color-primary) px-6 text-sm font-medium text-white shadow-(--shadow-card) transition-opacity hover:opacity-90"
              >
                <span>生成</span>
                <kbd className="rounded border border-white/30 bg-white/15 px-1 font-mono text-[10px]">
                  Ctrl
                </kbd>
                <kbd className="-ml-1 rounded border border-white/30 bg-white/15 px-1 font-mono text-[10px]">
                  Enter
                </kbd>
              </button>
            </div>
          </section>
        </div>

        <aside className="hidden w-64 shrink-0 flex-col border-l border-(--color-border) bg-(--color-surface-1) xl:flex">
          <div className="flex h-12 items-center gap-2 border-b border-(--color-border) px-4">
            <span className="text-sm font-semibold">历史</span>
            <span className="text-xs text-(--color-muted-2)">0</span>
          </div>
          <div className="flex flex-1 items-center justify-center p-6">
            <p className="text-center text-sm text-(--color-muted)">还没有生成历史</p>
          </div>
        </aside>
      </div>
    </ConsoleShell>
  );
}
