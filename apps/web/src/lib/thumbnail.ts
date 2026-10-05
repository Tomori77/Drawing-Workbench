export const THUMB_MAX_SIZE = 384;

export interface ThumbnailResult {
  dataUrl: string;
  mime: string;
}

// 浏览器端用 canvas 生成缩略图：等比缩放到最大边 ≤ maxSize，优先 webp，回退 jpeg。
// 任何失败（加载失败、canvas 不可用、环境不支持）都返回 null，由调用方静默降级显示原图。
export function generateThumbnail(
  src: string,
  maxSize = THUMB_MAX_SIZE
): Promise<ThumbnailResult | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || typeof Image === "undefined") {
      resolve(null);
      return;
    }

    const image = new Image();
    image.onload = () => {
      try {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (!width || !height) {
          resolve(null);
          return;
        }

        const scale = Math.min(1, maxSize / Math.max(width, height));
        const targetWidth = Math.max(1, Math.round(width * scale));
        const targetHeight = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

        let dataUrl = canvas.toDataURL("image/webp", 0.8);
        let mime = "image/webp";
        if (!dataUrl.startsWith("data:image/webp")) {
          dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          mime = "image/jpeg";
        }
        resolve({ dataUrl, mime });
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
}
