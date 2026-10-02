export interface QuickAction {
  title: string;
  description: string;
  to: string;
  icon: "play" | "gallery" | "key" | "wallet";
}

export const quickActions: QuickAction[] = [
  { title: "创作台", description: "生成一张新图", to: "/console/playground", icon: "play" },
  { title: "画廊", description: "浏览个人作品", to: "/gallery", icon: "gallery" },
  { title: "API 令牌", description: "为开放 API 创建密钥", to: "/console/api-keys", icon: "key" }
];

export const modelOptions = [
  { value: "nai-diffusion-4-5-full", label: "NAI Diffusion V4.5 (Full)" },
  { value: "nai-diffusion-4-5-curated", label: "NAI Diffusion V4.5 (Curated)" },
  { value: "nai-diffusion-4-full", label: "NAI Diffusion V4 (Full)" },
  { value: "nai-diffusion-4-curated", label: "NAI Diffusion V4 (Curated)" },
  { value: "nai-diffusion-3", label: "NAI Diffusion V3" },
  { value: "nai-diffusion-3-furry", label: "Furry Diffusion V3" }
];

export const samplerOptions = [
  { value: "k_euler_ancestral", label: "Euler Ancestral" },
  { value: "k_euler", label: "Euler" },
  { value: "k_dpm_2", label: "DPM2" },
  { value: "k_dpm_2_ancestral", label: "DPM2 Ancestral" },
  { value: "k_dpmpp_2s_ancestral", label: "DPM++ 2S Ancestral" },
  { value: "k_dpmpp_2m", label: "DPM++ 2M" },
  { value: "k_dpmpp_sde", label: "DPM++ SDE" }
];

export const noiseScheduleOptions = [
  { value: "karras", label: "Karras" },
  { value: "exponential", label: "Exponential" },
  { value: "polyexponential", label: "Polyexponential" },
  { value: "native", label: "Native" }
];

export const canvasSizes = [
  { label: "Portrait", ratio: "832×1216", width: 832, height: 1216 },
  { label: "Landscape", ratio: "1216×832", width: 1216, height: 832 },
  { label: "Square", ratio: "1024×1024", width: 1024, height: 1024 },
  { label: "Small Square", ratio: "512×512", width: 512, height: 512 }
];

export const actionTabs = [
  { value: "generate", label: "文生图" },
  { value: "img2img", label: "图生图" },
  { value: "inpaint", label: "局部重绘" },
  { value: "vibe", label: "氛围迁移" },
  { value: "precise", label: "精准参考" }
];

export const gallerySorts = [
  { value: "latest", label: "最新" },
  { value: "views", label: "最多浏览" }
];
