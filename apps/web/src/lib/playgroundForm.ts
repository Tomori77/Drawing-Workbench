import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AccountMode } from "./api";
import { actionTabs, modelOptions, noiseScheduleOptions, samplerOptions } from "./mock";

export const PLAYGROUND_FORM_KEY = "dwb_playground_form";

// 首次使用（无缓存）时的默认负面词，参考 yesnai 的默认负面词逐字保留。
export const DEFAULT_NEGATIVE =
  "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry";

export interface CustomSize {
  width: number;
  height: number;
}

export interface PlaygroundFormValues {
  model: string;
  action: string;
  sizeIndex: number;
  customSize: CustomSize | null;
  sampler: string;
  schedule: string;
  steps: number;
  guidance: number;
  seed: string;
  prompt: string;
  negative: string;
  artistContent: string;
  upstreamId: string | undefined;
  accountMode: AccountMode;
  accountId: string;
  recipeSelect: string;
  artistSelect: string;
}

interface PlaygroundFormStore extends PlaygroundFormValues {
  patch: (partial: Partial<PlaygroundFormValues>) => void;
}

const DEFAULTS: PlaygroundFormValues = {
  model: modelOptions[0].value,
  action: actionTabs[0].value,
  sizeIndex: 0,
  customSize: null,
  sampler: samplerOptions[0].value,
  schedule: noiseScheduleOptions[0].value,
  steps: 28,
  guidance: 5,
  seed: "",
  prompt: "",
  negative: DEFAULT_NEGATIVE,
  artistContent: "",
  upstreamId: undefined,
  accountMode: "auto",
  accountId: "",
  recipeSelect: "",
  artistSelect: ""
};

export const usePlaygroundForm = create<PlaygroundFormStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      patch: (partial) => set(partial)
    }),
    {
      name: PLAYGROUND_FORM_KEY,
      partialize: (state): PlaygroundFormValues => ({
        model: state.model,
        action: state.action,
        sizeIndex: state.sizeIndex,
        customSize: state.customSize,
        sampler: state.sampler,
        schedule: state.schedule,
        steps: state.steps,
        guidance: state.guidance,
        seed: state.seed,
        prompt: state.prompt,
        negative: state.negative,
        artistContent: state.artistContent,
        upstreamId: state.upstreamId,
        accountMode: state.accountMode,
        accountId: state.accountId,
        recipeSelect: state.recipeSelect,
        artistSelect: state.artistSelect
      })
    }
  )
);

export function hasPersistedPlaygroundForm(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PLAYGROUND_FORM_KEY) !== null;
  } catch {
    return false;
  }
}
