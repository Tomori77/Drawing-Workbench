import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as Tabs from "@radix-ui/react-tabs";
import * as Slider from "@radix-ui/react-slider";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import ConsoleShell from "../components/ConsoleShell";
import Lightbox from "../components/Lightbox";
import { IconClose, IconPlus, IconSliders, IconSpark } from "../components/icons";
import { useGenerate } from "../hooks/useGenerate";
import { useGallery } from "../hooks/useGallery";
import {
  useCreatePreset,
  useDeletePreset,
  usePresets,
  useUpdatePreset
} from "../hooks/usePresets";
import type { GalleryMeta, GenerateImage, GenerateParams, Preset } from "../lib/api";
import { DialogActions, DialogShell, inputClass } from "../components/console-ui";
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

interface ReproduceState {
  reproduce?: GalleryMeta;
}

function asParamString(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function asParamNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

type UpdatePresetMutation = ReturnType<typeof useUpdatePreset>;
type DeletePresetMutation = ReturnType<typeof useDeletePreset>;
type CreatePresetMutation = ReturnType<typeof useCreatePreset>;

function RecipeManagerDialog({
  open,
  onOpenChange,
  recipes,
  currentPayload,
  onApply,
  updateMutation,
  deleteMutation
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipes: Preset[];
  currentPayload: () => GenerateParams;
  onApply: (preset: Preset) => void;
  updateMutation: UpdatePresetMutation;
  deleteMutation: DeletePresetMutation;
}) {
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setRenameId(null);
      setRenameValue("");
      updateMutation.reset();
    }
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={close}
      title="管理配方"
      description="应用、用当前参数覆盖、改名或删除。"
    >
      {recipes.length === 0 ? (
        <p className="py-6 text-center text-sm text-(--color-muted)">还没有配方。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {recipes.map((item) => (
            <li key={item.id} className="rounded-(--radius-input) border border-(--color-border) p-2.5">
              {renameId === item.id ? (
                <div className="flex items-center gap-2">
                  <input
                    className={inputClass}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    disabled={!renameValue.trim()}
                    onClick={() =>
                      updateMutation.mutate(
                        { id: item.id, patch: { name: renameValue.trim() } },
                        { onSuccess: () => setRenameId(null) }
                      )
                    }
                    className="h-9 shrink-0 rounded-full bg-(--color-primary) px-3 text-sm text-white disabled:opacity-50"
                  >
                    保存
                  </button>
                </div>
              ) : (
                <>
                  <div className="text-sm font-medium">{item.name}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onApply(item)}
                      className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) hover:border-(--color-border-strong) hover:text-(--color-text)"
                    >
                      应用
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateMutation.mutate({ id: item.id, patch: { payload: currentPayload() as unknown as Record<string, unknown> } })
                      }
                      className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) hover:border-(--color-border-strong) hover:text-(--color-text)"
                    >
                      覆盖
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenameId(item.id);
                        setRenameValue(item.name);
                      }}
                      className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) hover:border-(--color-border-strong) hover:text-(--color-text)"
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(item.id)}
                      className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) hover:border-(--color-warning)/50 hover:text-(--color-warning)"
                    >
                      删除
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {updateMutation.isError && (
        <p className="mt-3 text-sm text-(--color-warning)">操作失败：{updateMutation.error.message}</p>
      )}
      {deleteMutation.isError && (
        <p className="mt-3 text-sm text-(--color-warning)">删除失败：{deleteMutation.error.message}</p>
      )}
      <DialogActions pending={updateMutation.isPending || deleteMutation.isPending} confirmLabel="完成" onCancel={() => close(false)} onConfirm={() => close(false)} />
    </DialogShell>
  );
}

function ArtistManagerDialog({
  open,
  onOpenChange,
  artists,
  onApply,
  updateMutation,
  deleteMutation,
  createMutation,
  onExtract
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artists: Preset[];
  onApply: (content: string) => void;
  updateMutation: UpdatePresetMutation;
  deleteMutation: DeletePresetMutation;
  createMutation: CreatePresetMutation;
  onExtract: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formContent, setFormContent] = useState("");

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setEditingId(null);
      updateMutation.reset();
      createMutation.reset();
    }
  };

  const startEdit = (item: Preset) => {
    setEditingId(item.id);
    setFormName(item.name);
    setFormContent(item.content ?? "");
  };
  const startNew = () => {
    setEditingId("new");
    setFormName("");
    setFormContent("");
  };
  const save = () => {
    const name = formName.trim();
    if (!name) return;
    if (editingId === "new") {
      createMutation.mutate(
        { kind: "artist", name, content: formContent },
        { onSuccess: () => setEditingId(null) }
      );
    } else if (editingId) {
      updateMutation.mutate(
        { id: editingId, patch: { name, content: formContent } },
        { onSuccess: () => setEditingId(null) }
      );
    }
  };

  const formOpen = editingId !== null;

  return (
    <DialogShell
      open={open}
      onOpenChange={close}
      title="管理画师串"
      description="画师串会在提交时拼接到正向提示词最前面（不改动输入框内容）。"
    >
      {formOpen ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-(--color-muted)">名称</span>
            <input className={inputClass} value={formName} onChange={(e) => setFormName(e.target.value)} autoFocus />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-(--color-muted)">内容</span>
            <textarea
              className="min-h-28 w-full resize-y rounded-(--radius-input) border border-(--color-border) bg-(--color-surface-1) px-3 py-2 text-sm outline-none focus:border-(--color-primary)"
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="h-9 rounded-full border border-(--color-border) px-4 text-sm hover:border-(--color-border-strong)"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!formName.trim() || createMutation.isPending || updateMutation.isPending}
              onClick={save}
              className="h-9 rounded-full bg-(--color-primary) px-4 text-sm font-medium text-white disabled:opacity-50"
            >
              保存
            </button>
          </div>
        </div>
      ) : (
        <>
          <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {artists.map((item) => (
              <li key={item.id} className="rounded-(--radius-input) border border-(--color-border) p-2.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span>{item.name}</span>
                  {item.builtin && (
                    <span className="rounded-full border border-(--color-border) px-2 py-0.5 text-[10px] text-(--color-muted-2)">
                      内置
                    </span>
                  )}
                </div>
                <p className="mt-1 max-h-12 overflow-y-auto text-[11px] leading-relaxed break-words whitespace-pre-wrap text-(--color-muted-2)">
                  {item.content}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onApply(item.content ?? "")}
                    className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) hover:border-(--color-border-strong) hover:text-(--color-text)"
                  >
                    应用
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(item)}
                    className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) hover:border-(--color-border-strong) hover:text-(--color-text)"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(item.id)}
                    className="rounded-full border border-(--color-border) px-3 py-1 text-xs text-(--color-muted) hover:border-(--color-warning)/50 hover:text-(--color-warning)"
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={startNew}
              className="rounded-full border border-(--color-border) px-3 py-1.5 text-xs text-(--color-muted) hover:border-(--color-border-strong) hover:text-(--color-text)"
            >
              新增
            </button>
            <button
              type="button"
              onClick={onExtract}
              className="rounded-full border border-(--color-border) px-3 py-1.5 text-xs text-(--color-muted) hover:border-(--color-border-strong) hover:text-(--color-text)"
            >
              从当前提示词提炼
            </button>
          </div>
        </>
      )}
      {deleteMutation.isError && (
        <p className="mt-3 text-sm text-(--color-warning)">删除失败：{deleteMutation.error.message}</p>
      )}
      <DialogActions pending={deleteMutation.isPending} confirmLabel="完成" onCancel={() => close(false)} onConfirm={() => close(false)} />
    </DialogShell>
  );
}

export default function Playground() {
  const location = useLocation();
  const navigate = useNavigate();
  const [model, setModel] = useState(modelOptions[0].value);
  const [action, setAction] = useState(actionTabs[0].value);
  const [sizeIndex, setSizeIndex] = useState(0);
  const [sampler, setSampler] = useState(samplerOptions[0].value);
  const [schedule, setSchedule] = useState(noiseScheduleOptions[0].value);
  const [steps, setSteps] = useState(28);
  const [guidance, setGuidance] = useState(5);
  const [seed, setSeed] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [promptTab, setPromptTab] = useState<PromptTab>("positive");
  const [sessionImages, setSessionImages] = useState<GenerateImage[]>([]);
  const [lightbox, setLightbox] = useState<GenerateImage | null>(null);
  const [mobileParamsOpen, setMobileParamsOpen] = useState(false);

  const [artistContent, setArtistContent] = useState("");

  const recipeQuery = usePresets("recipe");
  const artistQuery = usePresets("artist");
  const recipes = recipeQuery.data?.items ?? [];
  const artists = artistQuery.data?.items ?? [];

  const [recipeSelect, setRecipeSelect] = useState("");
  const [artistSelect, setArtistSelect] = useState("");
  const [recipeDialogOpen, setRecipeDialogOpen] = useState(false);
  const [artistDialogOpen, setArtistDialogOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const createPreset = useCreatePreset("recipe");
  const updateRecipe = useUpdatePreset("recipe");
  const deleteRecipe = useDeletePreset("recipe");
  const updateArtist = useUpdatePreset("artist");
  const deleteArtist = useDeletePreset("artist");
  const createArtist = useCreatePreset("artist");

  const preset = canvasSizes[sizeIndex];
  const [customSize, setCustomSize] = useState<{ width: number; height: number } | null>(null);
  const canvas = customSize ?? preset;
  const canvasRatio = customSize ? `${customSize.width}×${customSize.height}` : preset.ratio;
  const generateMutation = useGenerate();
  const galleryQuery = useGallery();
  const historyItems = useMemo(
    () => (galleryQuery.data?.pages ?? []).flatMap((page) => page.items).slice(0, 24),
    [galleryQuery.data]
  );

  const positiveTokens = Math.ceil(prompt.length / 4);
  const negativeTokens = Math.ceil(negative.length / 4);

  // 当前全部参数快照，供「存为 / 覆盖配方」使用。
  const snapshotParams = (): GenerateParams => ({
    model,
    prompt,
    negative_prompt: negative,
    action,
    n: 1,
    size: `${canvas.width}x${canvas.height}`,
    parameters: {
      width: canvas.width,
      height: canvas.height,
      steps,
      scale: guidance,
      seed: Number.parseInt(seed, 10) || 0,
      sampler,
      noise_schedule: schedule
    }
  });

  // 把配方快照灌回全部 state。
  const applyRecipe = (preset: Preset) => {
    const p = preset.payload as Partial<GenerateParams> | undefined;
    if (!p) return;
    if (p.model) setModel(p.model);
    if (p.action) setAction(p.action);
    if (typeof p.prompt === "string") setPrompt(p.prompt);
    if (typeof p.negative_prompt === "string") setNegative(p.negative_prompt);
    const params: Partial<GenerateParams["parameters"]> = p.parameters ?? {};
    if (params.sampler) setSampler(params.sampler);
    if (params.noise_schedule) setSchedule(params.noise_schedule);
    if (params.steps !== undefined) setSteps(Math.round(asParamNumber(params.steps, 28)));
    if (params.scale !== undefined) setGuidance(asParamNumber(params.scale, 5));
    if (params.seed !== undefined) setSeed(String(params.seed));
    const width = asParamNumber(params.width, NaN);
    const height = asParamNumber(params.height, NaN);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      const presetIndex = canvasSizes.findIndex((s) => s.width === width && s.height === height);
      if (presetIndex >= 0) {
        setCustomSize(null);
        setSizeIndex(presetIndex);
      } else {
        setCustomSize({ width, height });
      }
    }
  };

  const saveRecipe = () => {
    const name = saveName.trim();
    if (!name) return;
    createPreset.mutate(
      { kind: "recipe", name, payload: snapshotParams() as unknown as Record<string, unknown> },
      {
        onSuccess: (created) => {
          setRecipeSelect(created.id);
          setSaveDialogOpen(false);
          setSaveName("");
        }
      }
    );
  };

  const extractArtist = () => {
    const match = prompt.match(/^\s*((?:\[{0,3}artist:[^\]]+\]{0,3})(?:\s*,\s*(?:\[{0,3}artist:[^\]]+\]{0,3}))*[,]?)/i);
    const found = match?.[1]?.replace(/,\s*$/, "").trim();
    if (found) setArtistContent(found);
  };

  const submit = () => {
    if (generateMutation.isPending) return;
    const positive = artistContent ? `${artistContent}, ${prompt}` : prompt;
    const body: GenerateParams = {
      model,
      prompt: positive,
      negative_prompt: negative,
      action,
      n: 1,
      size: `${canvas.width}x${canvas.height}`,
      parameters: {
        width: canvas.width,
        height: canvas.height,
        steps,
        scale: guidance,
        seed: Number.parseInt(seed, 10) || 0,
        sampler,
        noise_schedule: schedule,
        ...(artistContent ? { artist: artistContent } : {})
      }
    };
    generateMutation.mutate(body, {
      onSuccess: (result) => {
        setSessionImages((prev) => [...result.images, ...prev].slice(0, 24));
      }
    });
  };

  // 从画廊「复现」：预填参数并清掉 location.state，避免刷新重复填入。
  const reproducedRef = useRef<string | null>(null);
  useEffect(() => {
    const incoming = (location.state as ReproduceState | null)?.reproduce;
    if (!incoming) {
      reproducedRef.current = null;
      return;
    }
    if (reproducedRef.current === incoming.id) return;
    reproducedRef.current = incoming.id;

    const params = incoming.params ?? {};
    if (incoming.model) setModel(incoming.model);
    if (incoming.action) setAction(incoming.action);
    const incomingArtist = asParamString(params.artist, "");
    if (incomingArtist) {
      setArtistContent(incomingArtist);
      const prefix = `${incomingArtist}, `;
      setPrompt(
        incoming.prompt.positive.startsWith(prefix)
          ? incoming.prompt.positive.slice(prefix.length)
          : incoming.prompt.positive
      );
    } else {
      setArtistContent("");
      if (incoming.prompt.positive) setPrompt(incoming.prompt.positive);
    }
    if (incoming.prompt.negative) setNegative(incoming.prompt.negative);

    const incomingSampler = asParamString(params.sampler, "");
    if (incomingSampler) setSampler(incomingSampler);
    const incomingSchedule = asParamString(params.noise_schedule, "");
    if (incomingSchedule) setSchedule(incomingSchedule);
    if (params.steps !== undefined && params.steps !== null) setSteps(Math.round(asParamNumber(params.steps, 28)));
    if (params.scale !== undefined && params.scale !== null) setGuidance(asParamNumber(params.scale, 5));
    if (params.seed !== undefined && params.seed !== null) setSeed(String(params.seed));

    const width = asParamNumber(incoming.width ?? params.width, NaN);
    const height = asParamNumber(incoming.height ?? params.height, NaN);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      const presetIndex = canvasSizes.findIndex((s) => s.width === width && s.height === height);
      if (presetIndex >= 0) {
        setCustomSize(null);
        setSizeIndex(presetIndex);
      } else {
        setCustomSize({ width, height });
      }
    }

    navigate(".", { replace: true, state: null });
  }, [location.state, navigate]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const errorMessage = generateMutation.error
    ? generateMutation.error.message
    : null;

  const displayImages = sessionImages.length > 0 ? sessionImages : generateMutation.data?.images ?? [];

  const renderParamsBody = () => (
    <div className="flex-1 overflow-y-auto">
      <PanelSection title="配方" meta="参数快照">
        <Field label="配方">
          <select
            className={inputClass}
            value={recipeSelect}
            onChange={(e) => setRecipeSelect(e.target.value)}
          >
            <option value="">选择配方…</option>
            {recipes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!recipeSelect}
            onClick={() => {
              const found = recipes.find((item) => item.id === recipeSelect);
              if (found) applyRecipe(found);
            }}
            className="h-8 rounded-full border border-(--color-border) px-3 text-xs text-(--color-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-40"
          >
            应用
          </button>
          <button
            type="button"
            onClick={() => {
              setSaveName("");
              setSaveDialogOpen(true);
            }}
            className="h-8 rounded-full border border-(--color-border) px-3 text-xs text-(--color-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text)"
          >
            存为配方
          </button>
          <button
            type="button"
            onClick={() => setRecipeDialogOpen(true)}
            className="h-8 rounded-full border border-(--color-border) px-3 text-xs text-(--color-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text)"
          >
            管理
          </button>
        </div>
      </PanelSection>

      <PanelSection title="画师串" meta={artistContent ? "已启用" : undefined}>
        <Field label="画师串">
          <select
            className={inputClass}
            value={artistSelect}
            onChange={(e) => setArtistSelect(e.target.value)}
          >
            <option value="">选择画师串…</option>
            {artists.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.builtin ? "（内置）" : ""}
              </option>
            ))}
          </select>
        </Field>
        <p className="max-h-16 overflow-y-auto rounded-(--radius-input) bg-(--color-surface-2) px-2.5 py-1.5 text-[11px] leading-relaxed break-words whitespace-pre-wrap text-(--color-muted)">
          {artistContent || "未启用画师串"}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!artistSelect}
            onClick={() => {
              const found = artists.find((item) => item.id === artistSelect);
              if (found) setArtistContent(found.content ?? "");
            }}
            className="h-8 rounded-full border border-(--color-border) px-3 text-xs text-(--color-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-40"
          >
            应用
          </button>
          <button
            type="button"
            disabled={!artistContent}
            onClick={() => setArtistContent("")}
            className="h-8 rounded-full border border-(--color-border) px-3 text-xs text-(--color-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-40"
          >
            清空
          </button>
          <button
            type="button"
            onClick={() => setArtistDialogOpen(true)}
            className="h-8 rounded-full border border-(--color-border) px-3 text-xs text-(--color-muted) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text)"
          >
            管理
          </button>
        </div>
      </PanelSection>

      <PanelSection title="模型">
        <Field label="模型">
          <SelectMenu ariaLabel="模型" value={model} options={modelOptions} onChange={setModel} />
        </Field>
        <Tabs.Root value={action} onValueChange={setAction}>
          <Tabs.List className="grid grid-cols-3 gap-1 rounded-(--radius-input) bg-(--color-surface-2) p-1">
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

      <PanelSection title="画布" meta={canvasRatio}>
        <div className="grid grid-cols-2 gap-2">
          {canvasSizes.map((option, index) => {
            const active = !customSize && index === sizeIndex;
            return (
              <button
                key={option.ratio}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setCustomSize(null);
                  setSizeIndex(index);
                }}
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
        {customSize && (
          <p className="rounded-(--radius-input) border border-(--color-text) bg-(--color-surface-2) px-3 py-2 text-xs text-(--color-muted)">
            自定义尺寸 {customSize.width}×{customSize.height}
          </p>
        )}
      </PanelSection>

      <PanelSection title="采样">
        <Field label="采样器">
          <SelectMenu
            ariaLabel="采样器"
            value={sampler}
            options={samplerOptions}
            onChange={setSampler}
          />
        </Field>
        <Field label="噪声调度">
          <SelectMenu
            ariaLabel="噪声调度"
            value={schedule}
            options={noiseScheduleOptions}
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
  );

  const paramsHeader = (
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
  );

  return (
    <ConsoleShell>
      <div className="flex min-h-[calc(100dvh-var(--topbar-h))]">
        <aside className="hidden w-80 shrink-0 flex-col border-r border-(--color-border) bg-(--color-surface-1) lg:flex">
          {paramsHeader}
          {renderParamsBody()}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <section className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-6">
            {generateMutation.isPending ? (
              <div className="flex flex-col items-center text-center">
                <span className="mb-4 flex size-16 animate-pulse items-center justify-center rounded-full border border-(--color-border) bg-(--color-surface-1) text-(--color-primary) shadow-(--shadow-card)">
                  <IconSpark className="size-7" />
                </span>
                <p className="text-base font-medium">正在生成…</p>
                <p className="mt-1 text-sm text-(--color-muted)">请稍候，完成后会显示在下方。</p>
              </div>
            ) : errorMessage ? (
              <div className="max-w-md rounded-(--radius-card) border border-(--color-warning)/40 bg-(--color-surface-1) p-6 text-center shadow-(--shadow-card)">
                <p className="text-sm font-medium text-(--color-warning)">生成失败</p>
                <p className="mt-2 text-sm text-(--color-muted)">{errorMessage}</p>
              </div>
            ) : displayImages.length > 0 ? (
              <div
                className={`grid w-full max-w-3xl gap-3 ${
                  displayImages.length > 1 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-1"
                }`}
              >
                {displayImages.map((image) => (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => setLightbox(image)}
                    className="overflow-hidden rounded-(--radius-secondary) border border-(--color-border) bg-(--color-surface-1) shadow-(--shadow-card) transition-transform hover:-translate-y-0.5"
                  >
                    <img
                      src={image.url}
                      alt="生成结果"
                      className="max-h-[60dvh] w-full object-contain"
                    />
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center text-center">
                <span className="mb-4 flex size-16 items-center justify-center rounded-full border border-(--color-border) bg-(--color-surface-1) text-(--color-muted-2) shadow-(--shadow-card)">
                  <IconSpark className="size-7" />
                </span>
                <p className="text-base font-medium">你的作品将显示在这里</p>
                <p className="mt-1 text-sm text-(--color-muted)">描述画面，选择模型，然后点击生成。</p>
              </div>
            )}
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
                <span className="hidden pb-2.5 text-xs text-(--color-muted-2) sm:inline">相关标签</span>
              </div>

              <Tabs.Content value="positive" className="px-4 pt-3 outline-none">
                <div className="mb-2 flex justify-end">
                  <button
                    type="button"
                    disabled
                    title="即将支持"
                    className="cursor-not-allowed rounded-full border border-(--color-border) px-2.5 py-0.5 text-[11px] text-(--color-muted-2) opacity-60"
                  >
                    中文转 NAI 提示词
                  </button>
                </div>
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
                  <span className="truncate">费用 — Gems · 单次请求 × 1</span>
                </p>
                <p className="mt-1 text-[11px] text-(--color-muted-2)">
                  {prompt.length + negative.length} 字符 · {canvasRatio}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMobileParamsOpen(true)}
                  className="flex h-10 items-center gap-1.5 rounded-full border border-(--color-border) bg-(--color-surface-1) px-4 text-sm text-(--color-text) transition-colors hover:border-(--color-border-strong) lg:hidden"
                >
                  <IconSliders className="size-4" />
                  参数
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={generateMutation.isPending}
                  className="flex h-10 items-center gap-2 rounded-full bg-(--color-primary) px-6 text-sm font-medium text-white shadow-(--shadow-card) transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>{generateMutation.isPending ? "生成中…" : "生成"}</span>
                  <kbd className="rounded border border-white/30 bg-white/15 px-1 font-mono text-[10px]">
                    Ctrl
                  </kbd>
                  <kbd className="-ml-1 rounded border border-white/30 bg-white/15 px-1 font-mono text-[10px]">
                    Enter
                  </kbd>
                </button>
              </div>
            </div>
            {errorMessage && (
              <p className="border-t border-(--color-border) px-4 py-2 text-xs text-(--color-warning)">
                {errorMessage}
              </p>
            )}
          </section>
        </div>

        <aside className="hidden w-64 shrink-0 flex-col border-l border-(--color-border) bg-(--color-surface-1) xl:flex">
          <div className="flex h-12 items-center gap-2 border-b border-(--color-border) px-4">
            <span className="text-sm font-semibold">历史</span>
            <span className="text-xs text-(--color-muted-2)">
              {sessionImages.length > 0 ? sessionImages.length : historyItems.length}
            </span>
          </div>
          {historyItems.length === 0 && sessionImages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <p className="text-center text-sm text-(--color-muted)">还没有生成历史</p>
            </div>
          ) : sessionImages.length > 0 ? (
            <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-3">
              {sessionImages.map((image) => (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => setLightbox(image)}
                  className="overflow-hidden rounded-(--radius-input) border border-(--color-border) bg-(--color-surface-2)"
                >
                  <img src={image.url} alt="本次生成" className="aspect-square w-full object-cover" />
                </button>
              ))}
            </div>
          ) : (
            <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-3">
              {historyItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setLightbox({ id: item.id, url: item.url, thumb_url: item.thumb_url ?? undefined })}
                  className="overflow-hidden rounded-(--radius-input) border border-(--color-border) bg-(--color-surface-2)"
                >
                  <img src={item.thumb_url ?? item.url} alt="历史作品" loading="lazy" className="aspect-square w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>

      <DialogShell
        open={saveDialogOpen}
        onOpenChange={(open) => {
          setSaveDialogOpen(open);
          if (!open) createPreset.reset();
        }}
        title="存为配方"
        description="把当前全部参数保存为一套可复用的配方。"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-(--color-muted)">配方名称</span>
          <input
            className={inputClass}
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="例如：韩漫小清新"
            autoFocus
          />
        </label>
        {createPreset.isError && (
          <p className="mt-3 text-sm text-(--color-warning)">保存失败：{createPreset.error.message}</p>
        )}
        <DialogActions
          pending={createPreset.isPending}
          disabled={!saveName.trim()}
          confirmLabel="保存"
          onCancel={() => {
            createPreset.reset();
            setSaveDialogOpen(false);
          }}
          onConfirm={saveRecipe}
        />
      </DialogShell>

      <RecipeManagerDialog
        open={recipeDialogOpen}
        onOpenChange={setRecipeDialogOpen}
        recipes={recipes}
        currentPayload={snapshotParams}
        onApply={applyRecipe}
        updateMutation={updateRecipe}
        deleteMutation={deleteRecipe}
      />

      <ArtistManagerDialog
        open={artistDialogOpen}
        onOpenChange={setArtistDialogOpen}
        artists={artists}
        onApply={(content) => setArtistContent(content)}
        updateMutation={updateArtist}
        deleteMutation={deleteArtist}
        createMutation={createArtist}
        onExtract={extractArtist}
      />

      <Dialog.Root open={mobileParamsOpen} onOpenChange={setMobileParamsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[88vw] max-w-sm flex-col border-r border-(--color-border) bg-(--color-surface-1) shadow-(--shadow-float) outline-none lg:hidden">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-(--color-border) px-4">
              <Dialog.Title className="text-sm font-semibold">参数</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="关闭参数"
                  className="flex size-8 items-center justify-center rounded-(--radius-input) text-(--color-muted) transition-colors hover:bg-(--color-surface-2)"
                >
                  <IconClose className="size-4.5" />
                </button>
              </Dialog.Close>
            </div>
            {renderParamsBody()}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Lightbox
        open={lightbox !== null}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
        src={lightbox?.url ?? null}
        alt="生成结果"
      />
    </ConsoleShell>
  );
}
