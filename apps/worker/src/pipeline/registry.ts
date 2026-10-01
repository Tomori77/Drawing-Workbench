import type { Adapter } from "./types";
import { naiAdapter } from "./adapters/nai";
import { openaiAdapter } from "./adapters/openai";
import { templateAdapter } from "./adapters/template";

const adapters: Record<string, Adapter> = {
  [naiAdapter.type]: naiAdapter,
  [openaiAdapter.type]: openaiAdapter
};

export function getAdapter(type: string): Adapter {
  return adapters[type] ?? templateAdapter;
}
