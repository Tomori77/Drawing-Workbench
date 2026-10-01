export interface StatCard {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}

export const accountStats: StatCard[] = [
  { label: "Gems 余额", value: "537", unit: "Gems", hint: "用于支付生成费用与购买图包" },
  { label: "图包次数", value: "0", hint: "每 10 分钟免费 20 张，之后每张消耗 1 次" },
  { label: "已消耗 Gems", value: "726", unit: "Gems", hint: "自账户创建以来的累计消耗" },
  { label: "请求数", value: "389", hint: "工作台与开放 API 的生成请求总数" }
];

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
  "Euler Ancestral",
  "Euler",
  "DPM++ 2M",
  "DPM++ 2M SDE",
  "DPM++ 2S Ancestral"
];

export const noiseScheduleOptions = ["Karras", "Exponential", "Polyexponential", "Native"];

export const canvasSizes = [
  { label: "Portrait", ratio: "832×1216", width: 832, height: 1216 },
  { label: "Landscape", ratio: "1216×832", width: 1216, height: 832 },
  { label: "Square", ratio: "1024×1024", width: 1024, height: 1024 },
  { label: "Small Square", ratio: "512×512", width: 512, height: 512 }
];

export const actionTabs = [
  { value: "img2img", label: "图生图" },
  { value: "inpaint", label: "局部重绘" },
  { value: "vibe", label: "氛围迁移" },
  { value: "precise", label: "精准参考" }
];

export interface GalleryWork {
  id: string;
  title: string;
  ratio: string;
  time: string;
  author: string;
  views: number;
  gradient: string;
}

const gradients = [
  "linear-gradient(135deg, #a8c0ff 0%, #3f2b96 100%)",
  "linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)",
  "linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)",
  "linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)",
  "linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)",
  "linear-gradient(135deg, #fdcbf1 0%, #e6dee9 100%)",
  "linear-gradient(135deg, #c1dfc4 0%, #deecdd 100%)",
  "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)",
  "linear-gradient(135deg, #fee2e2 0%, #bfdbfe 100%)",
  "linear-gradient(135deg, #fceabb 0%, #f8b500 100%)",
  "linear-gradient(135deg, #dbeafe 0%, #93c5fd 100%)",
  "linear-gradient(135deg, #f5d0fe 0%, #c084fc 100%)"
];

export const galleryWorks: GalleryWork[] = [
  { id: "w01", title: "知更鸟", ratio: "832×1216", time: "2 小时前", author: "本地作品", views: 1 },
  { id: "w02", title: "花火", ratio: "832×1216", time: "5 小时前", author: "本地作品", views: 1 },
  { id: "w03", title: "特写", ratio: "1216×832", time: "昨天", author: "本地作品", views: 2 },
  { id: "w04", title: "初音未来", ratio: "832×1216", time: "昨天", author: "本地作品", views: 0 },
  { id: "w05", title: "纳西妲点赞", ratio: "1024×1024", time: "2 天前", author: "本地作品", views: 1 },
  { id: "w06", title: "冬装纳西妲", ratio: "832×1216", time: "3 天前", author: "本地作品", views: 1 },
  { id: "w07", title: "亚托莉拥抱", ratio: "832×1216", time: "3 天前", author: "本地作品", views: 1 },
  { id: "w08", title: "女仆若若", ratio: "1216×832", time: "4 天前", author: "本地作品", views: 3 },
  { id: "w09", title: "艾拉打招呼", ratio: "832×1216", time: "5 天前", author: "本地作品", views: 1 },
  { id: "w10", title: "双面的吉他手", ratio: "1024×1024", time: "1 周前", author: "本地作品", views: 6 },
  { id: "w11", title: "魔法少女伊莉雅", ratio: "832×1216", time: "1 周前", author: "本地作品", views: 4 },
  { id: "w12", title: "知更鸟", ratio: "1216×832", time: "2 周前", author: "本地作品", views: 0 }
].map((work, index) => ({ ...work, gradient: gradients[index % gradients.length] }));

export const gallerySorts = [
  { value: "latest", label: "最新" },
  { value: "views", label: "最多浏览" }
];
