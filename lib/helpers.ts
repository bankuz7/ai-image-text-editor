"use client";

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface DetectedText {
  id: string;
  text: string;
  confidence: number;
  bbox: BBox;
  autoSize: number;
  autoColor: string;
  autoFont: string;
}

export interface EditState {
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  offsetX: number;
  offsetY: number;
  rotation: number;
  inpaintRadius: number;
}

export const FONT_OPTIONS = [
  { value: "Inter, sans-serif", label: "Inter" },
  { value: "Roboto, sans-serif", label: "Roboto" },
  { value: "Open Sans, sans-serif", label: "Open Sans" },
  { value: "Lato, sans-serif", label: "Lato" },
  { value: "Montserrat, sans-serif", label: "Montserrat" },
  { value: "Poppins, sans-serif", label: "Poppins" },
  { value: "Noto Sans, sans-serif", label: "Noto Sans" },
  { value: "Noto Sans Devanagari, sans-serif", label: "Noto Hindi" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Courier New, monospace", label: "Courier" },
];

export function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export function getDominantColor(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number
): string {
  const w = Math.max(1, Math.floor(x1 - x0));
  const h = Math.max(1, Math.floor(y1 - y0));
  try {
    const data = ctx.getImageData(Math.floor(x0), Math.floor(y0), w, h).data;
    const darks: number[][] = [];
    const lights: number[][] = [];
    for (let i = 0; i < data.length; i += 12) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const br = (r + g + b) / 3;
      if (br < 100) darks.push([r, g, b]);
      else if (br > 180) lights.push([r, g, b]);
    }
    const pool = darks.length > 5 ? darks : lights.length > 5 ? lights : null;
    if (!pool || pool.length === 0) return "#1a1a1a";
    let r = 0, g = 0, b = 0;
    for (const p of pool) { r += p[0]; g += p[1]; b += p[2]; }
    r = Math.round(r / pool.length);
    g = Math.round(g / pool.length);
    b = Math.round(b / pool.length);
    if ((r + g + b) / 3 > 170) return "#1a1a1a";
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  } catch {
    return "#1a1a1a";
  }
}

export function estimateFontSize(text: string, bbox: BBox, fontFamily: string): number {
  const boxW = Math.max(8, bbox.x1 - bbox.x0);
  const boxH = Math.max(8, bbox.y1 - bbox.y0);
  if (!text.trim()) return Math.max(12, Math.round(boxH * 0.75));
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  if (!ctx) return Math.max(12, Math.round(boxH * 0.75));
  let lo = 8;
  let hi = Math.min(300, Math.round(boxH * 1.4));
  let best = Math.round(boxH * 0.75);
  for (let i = 0; i < 14; i++) {
    const mid = Math.round((lo + hi) / 2);
    ctx.font = `${mid}px ${fontFamily}`;
    const metrics = ctx.measureText(text);
    const tw = metrics.width;
    const th = (metrics.actualBoundingBoxAscent || mid * 0.8) + (metrics.actualBoundingBoxDescent || mid * 0.2);
    if (tw <= boxW * 0.98 && th <= boxH * 0.95) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return Math.max(10, best);
}

export function guessFontFamily(text: string): string {
  if (/[\u0900-\u097F]/.test(text)) return "Noto Sans Devanagari, sans-serif";
  if (text.length > 14) return "Inter, sans-serif";
  return "Roboto, sans-serif";
}

export function simpleInpaint(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number, radius: number
) {
  const pad = Math.max(3, radius);
  const sx = Math.max(0, Math.floor(x0 - pad));
  const sy = Math.max(0, Math.floor(y0 - pad));
  const ex = Math.min(ctx.canvas.width, Math.ceil(x1 + pad));
  const ey = Math.min(ctx.canvas.height, Math.ceil(y1 + pad));
  let r = 0, g = 0, b = 0, n = 0;
  const sample = (x: number, y: number) => {
    try {
      const d = ctx.getImageData(x, y, 1, 1).data;
      r += d[0]; g += d[1]; b += d[2]; n++;
    } catch {}
  };
  for (let x = sx; x < ex; x += 2) { sample(x, sy); sample(x, ey - 1); }
  for (let y = sy; y < ey; y += 2) { sample(sx, y); sample(ex - 1, y); }
  const fill = n > 0 ? `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})` : "#f0f0f0";
  ctx.save();
  const expand = Math.max(2, radius * 0.5);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(
    Math.floor(x0 - expand), Math.floor(y0 - expand),
    Math.ceil(x1 - x0 + expand * 2), Math.ceil(y1 - y0 + expand * 2), 4
  );
  ctx.fill();
  ctx.restore();
}

export function mergeNearbyBoxes(items: DetectedText[], xThresh = 25, yThresh = 12): DetectedText[] {
  if (items.length <= 1) return items;
  const sorted = [...items].sort((a, b) => {
    const dy = a.bbox.y0 - b.bbox.y0;
    if (Math.abs(dy) > yThresh) return dy;
    return a.bbox.x0 - b.bbox.x0;
  });
  const used = new Set<number>();
  const merged: DetectedText[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    let group = [sorted[i]];
    used.add(i);
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < sorted.length; j++) {
        if (used.has(j)) continue;
        const cand = sorted[j];
        for (const g of group) {
          const sameRow = Math.abs((cand.bbox.y0 + cand.bbox.y1) / 2 - (g.bbox.y0 + g.bbox.y1) / 2) < yThresh;
          const nearX = cand.bbox.x0 <= g.bbox.x1 + xThresh && cand.bbox.x1 >= g.bbox.x0 - xThresh;
          if (sameRow && nearX) {
            group.push(cand);
            used.add(j);
            changed = true;
            break;
          }
        }
      }
    }
    group.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const text = group.map((g) => g.text).join(" ");
    const x0 = Math.min(...group.map((g) => g.bbox.x0));
    const y0 = Math.min(...group.map((g) => g.bbox.y0));
    const x1 = Math.max(...group.map((g) => g.bbox.x1));
    const y1 = Math.max(...group.map((g) => g.bbox.y1));
    const conf = group.reduce((s, g) => s + g.confidence, 0) / group.length;
    const font = guessFontFamily(text);
    const bbox = { x0, y0, x1, y1 };
    merged.push({
      id: generateId(), text, confidence: conf, bbox,
      autoSize: estimateFontSize(text, bbox, font),
      autoColor: group[0].autoColor, autoFont: font,
    });
  }
  return merged;
}
