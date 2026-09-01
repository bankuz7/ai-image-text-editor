"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload,
  ScanSearch,
  Check,
  Undo2,
  Download,
  Plus,
  Type,
  Palette,
  Move,
  RotateCw,
  Eraser,
  Loader2,
  ImageIcon,
  Sparkles,
} from "lucide-react";

// ---------- Types ----------
interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface DetectedText {
  id: string;
  text: string;
  confidence: number;
  bbox: BBox;
  // Auto-matched style
  autoSize: number;
  autoColor: string;
  autoFont: string;
}

interface EditState {
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  offsetX: number;
  offsetY: number;
  rotation: number;
  inpaintRadius: number;
}

// ---------- Font options (Google Fonts loaded in CSS) ----------
const FONT_OPTIONS = [
  { value: "Inter, sans-serif", label: "Inter (Modern)" },
  { value: "Roboto, sans-serif", label: "Roboto" },
  { value: "Open Sans, sans-serif", label: "Open Sans" },
  { value: "Lato, sans-serif", label: "Lato" },
  { value: "Montserrat, sans-serif", label: "Montserrat" },
  { value: "Poppins, sans-serif", label: "Poppins" },
  { value: "Noto Sans, sans-serif", label: "Noto Sans" },
  { value: "Noto Sans Devanagari, sans-serif", label: "Noto Sans Hindi" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Georgia, serif", label: "Georgia (Serif)" },
  { value: "Courier New, monospace", label: "Courier (Mono)" },
];

// ---------- Helpers ----------
function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function getDominantColor(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): string {
  const w = Math.max(1, Math.floor(x1 - x0));
  const h = Math.max(1, Math.floor(y1 - y0));
  try {
    const data = ctx.getImageData(x0, y0, w, h).data;
    let r = 0,
      g = 0,
      b = 0,
      count = 0;
    // Sample every few pixels + prefer darker pixels (typical text)
    for (let i = 0; i < data.length; i += 16) {
      const pr = data[i];
      const pg = data[i + 1];
      const pb = data[i + 2];
      const brightness = (pr + pg + pb) / 3;
      // Weight darker pixels more (text is usually dark)
      const weight = brightness < 140 ? 3 : 1;
      r += pr * weight;
      g += pg * weight;
      b += pb * weight;
      count += weight;
    }
    if (count === 0) return "#111111";
    r = Math.round(r / count);
    g = Math.round(g / count);
    b = Math.round(b / count);
    // If color is too light, force dark text
    if ((r + g + b) / 3 > 200) return "#1a1a1a";
    return `#${r.toString(16).padStart(2, "0")}${g
      .toString(16)
      .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  } catch {
    return "#111111";
  }
}

function estimateFontSize(bbox: BBox): number {
  const h = bbox.y1 - bbox.y0;
  // Slightly smaller than full box height looks more natural
  return Math.max(12, Math.round(h * 0.78));
}

function guessFontFamily(text: string): string {
  // Simple heuristic: Devanagari characters → Hindi font
  if (/[\u0900-\u097F]/.test(text)) {
    return "Noto Sans Devanagari, sans-serif";
  }
  // Longer words / modern looking → Inter / Poppins
  if (text.length > 12) return "Inter, sans-serif";
  return "Roboto, sans-serif";
}

// Simple inpaint: fill the region with average surrounding color + slight blur
function simpleInpaint(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number
) {
  const pad = Math.max(2, radius);
  const sx = Math.max(0, Math.floor(x0 - pad));
  const sy = Math.max(0, Math.floor(y0 - pad));
  const ex = Math.min(ctx.canvas.width, Math.ceil(x1 + pad));
  const ey = Math.min(ctx.canvas.height, Math.ceil(y1 + pad));

  // Sample border pixels for fill color
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  const sample = (x: number, y: number) => {
    try {
      const d = ctx.getImageData(x, y, 1, 1).data;
      r += d[0];
      g += d[1];
      b += d[2];
      n++;
    } catch {}
  };

  // Top & bottom edges
  for (let x = sx; x < ex; x += 2) {
    sample(x, sy);
    sample(x, ey - 1);
  }
  // Left & right edges
  for (let y = sy; y < ey; y += 2) {
    sample(sx, y);
    sample(ex - 1, y);
  }

  const fill =
    n > 0
      ? `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`
      : "#f5f5f5";

  ctx.save();
  ctx.fillStyle = fill;
  // Slightly larger rounded rect for softer edge
  const rx = Math.floor(x0 - radius * 0.4);
  const ry = Math.floor(y0 - radius * 0.4);
  const rw = Math.ceil(x1 - x0 + radius * 0.8);
  const rh = Math.ceil(y1 - y0 + radius * 0.8);
  ctx.beginPath();
  ctx.roundRect(rx, ry, rw, rh, 3);
  ctx.fill();
  ctx.restore();
}

// ---------- Main Component ----------
export default function Home() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [detected, setDetected] = useState<DetectedText[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>({
    text: "",
    fontSize: 32,
    fontFamily: "Inter, sans-serif",
    color: "#111111",
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    inpaintRadius: 6,
  });
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [status, setStatus] = useState("Upload an image to get started");
  const [history, setHistory] = useState<string[]>([]);
  const [showBoxes, setShowBoxes] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const baseImageRef = useRef<HTMLImageElement | null>(null);
  const workingSrcRef = useRef<string | null>(null);

  const selected = detected.find((d) => d.id === selectedId) || null;

  // ---------- Load image ----------
  const loadImage = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      setImageSrc(src);
      workingSrcRef.current = src;
      setDetected([]);
      setSelectedId(null);
      setHistory([]);
      setStatus("Image loaded • Click Detect Text");
      const img = new Image();
      img.onload = () => {
        baseImageRef.current = img;
        drawCanvas(src, [], null, null);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) loadImage(file);
  };

  // ---------- Core draw ----------
  const drawCanvas = useCallback(
    (
      src: string,
      boxes: DetectedText[],
      sel: DetectedText | null,
      currentEdit: EditState | null
    ) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        // Draw remaining boxes
        if (showBoxes) {
          boxes.forEach((d) => {
            const isSel = sel && d.id === sel.id;
            ctx.strokeStyle = isSel ? "#22d3ee" : "#fbbf24";
            ctx.lineWidth = isSel ? 3 : 1.5;
            ctx.setLineDash(isSel ? [] : [6, 4]);
            ctx.strokeRect(
              d.bbox.x0,
              d.bbox.y0,
              d.bbox.x1 - d.bbox.x0,
              d.bbox.y1 - d.bbox.y0
            );
            ctx.setLineDash([]);
          });
        }

        // Live edit preview
        if (sel && currentEdit) {
          simpleInpaint(
            ctx,
            sel.bbox.x0,
            sel.bbox.y0,
            sel.bbox.x1,
            sel.bbox.y1,
            currentEdit.inpaintRadius
          );

          ctx.save();
          const cx =
            (sel.bbox.x0 + sel.bbox.x1) / 2 + currentEdit.offsetX;
          const cy =
            (sel.bbox.y0 + sel.bbox.y1) / 2 + currentEdit.offsetY;
          ctx.translate(cx, cy);
          ctx.rotate((currentEdit.rotation * Math.PI) / 180);
          ctx.font = `${currentEdit.fontSize}px ${currentEdit.fontFamily}`;
          ctx.fillStyle = currentEdit.color;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.shadowColor = "rgba(0,0,0,0.25)";
          ctx.shadowBlur = 2;
          ctx.shadowOffsetX = 1;
          ctx.shadowOffsetY = 1;
          ctx.fillText(currentEdit.text, 0, 0);
          ctx.restore();
        }
      };
      img.src = src;
    },
    [showBoxes]
  );

  // Redraw when edit / selection changes
  useEffect(() => {
    if (!workingSrcRef.current) return;
    drawCanvas(
      workingSrcRef.current,
      detected,
      selected,
      selected ? edit : null
    );
  }, [edit, selectedId, detected, drawCanvas, selected]);

  // ---------- OCR ----------
  const runOcr = async () => {
    if (!workingSrcRef.current) {
      setStatus("Please upload an image first");
      return;
    }
    setIsOcrRunning(true);
    setStatus("Detecting text (English + Hindi)...");

    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng+hin", 1, {
        logger: (m) => {
          if (m.status === "recognizing text") {
            setStatus(`OCR progress: ${Math.round((m.progress || 0) * 100)}%`);
          }
        },
      });

      const result = await worker.recognize(workingSrcRef.current);
      await worker.terminate();

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");

      const items: DetectedText[] = [];
      const words = result.data.words || [];

      for (const w of words) {
        if (!w.text.trim() || w.confidence < 40) continue;
        const bbox: BBox = {
          x0: w.bbox.x0,
          y0: w.bbox.y0,
          x1: w.bbox.x1,
          y1: w.bbox.y1,
        };
        let autoColor = "#111111";
        if (ctx) {
          autoColor = getDominantColor(
            ctx,
            bbox.x0,
            bbox.y0,
            bbox.x1,
            bbox.y1
          );
        }
        items.push({
          id: generateId(),
          text: w.text,
          confidence: w.confidence,
          bbox,
          autoSize: estimateFontSize(bbox),
          autoColor,
          autoFont: guessFontFamily(w.text),
        });
      }

      if (items.length === 0 && result.data.lines) {
        for (const line of result.data.lines) {
          if (!line.text.trim()) continue;
          const bbox: BBox = {
            x0: line.bbox.x0,
            y0: line.bbox.y0,
            x1: line.bbox.x1,
            y1: line.bbox.y1,
          };
          let autoColor = "#111111";
          if (ctx) {
            autoColor = getDominantColor(
              ctx,
              bbox.x0,
              bbox.y0,
              bbox.x1,
              bbox.y1
            );
          }
          items.push({
            id: generateId(),
            text: line.text.trim(),
            confidence: line.confidence || 70,
            bbox,
            autoSize: estimateFontSize(bbox),
            autoColor,
            autoFont: guessFontFamily(line.text),
          });
        }
      }

      setDetected(items);
      if (items.length > 0) {
        selectText(items[0]);
        setStatus(`✅ Found ${items.length} text regions • Select one to edit`);
      } else {
        setStatus("No text detected. Try a clearer image.");
      }
    } catch (err: any) {
      console.error(err);
      setStatus("OCR failed: " + (err?.message || "Unknown error"));
    } finally {
      setIsOcrRunning(false);
    }
  };

  // ---------- Selection with auto-match ----------
  const selectText = (item: DetectedText) => {
    setSelectedId(item.id);
    setEdit({
      text: item.text,
      fontSize: item.autoSize,
      fontFamily: item.autoFont,
      color: item.autoColor,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      inpaintRadius: 6,
    });
  };

  // ---------- Apply permanent edit ----------
  const applyEdit = () => {
    if (!selected || !workingSrcRef.current || !canvasRef.current) return;

    setHistory((h) => [...h.slice(-14), workingSrcRef.current!]);

    const canvas = canvasRef.current;
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tctx = tempCanvas.getContext("2d")!;
    const img = new Image();
    img.onload = () => {
      tctx.drawImage(img, 0, 0);
      simpleInpaint(
        tctx,
        selected.bbox.x0,
        selected.bbox.y0,
        selected.bbox.x1,
        selected.bbox.y1,
        edit.inpaintRadius
      );
      tctx.save();
      const cx = (selected.bbox.x0 + selected.bbox.x1) / 2 + edit.offsetX;
      const cy = (selected.bbox.y0 + selected.bbox.y1) / 2 + edit.offsetY;
      tctx.translate(cx, cy);
      tctx.rotate((edit.rotation * Math.PI) / 180);
      tctx.font = `${edit.fontSize}px ${edit.fontFamily}`;
      tctx.fillStyle = edit.color;
      tctx.textAlign = "center";
      tctx.textBaseline = "middle";
      tctx.shadowColor = "rgba(0,0,0,0.2)";
      tctx.shadowBlur = 1;
      tctx.fillText(edit.text, 0, 0);
      tctx.restore();

      const newSrc = tempCanvas.toDataURL("image/png");
      workingSrcRef.current = newSrc;
      setImageSrc(newSrc);

      const remaining = detected.filter((d) => d.id !== selected.id);
      setDetected(remaining);
      setSelectedId(null);
      if (remaining.length > 0) {
        selectText(remaining[0]);
      } else {
        drawCanvas(newSrc, [], null, null);
      }
      setStatus("✅ Edit applied • Select next text or download");
    };
    img.src = workingSrcRef.current;
  };

  // ---------- Undo ----------
  const undo = () => {
    if (history.length === 0) {
      setStatus("Nothing to undo");
      return;
    }
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    workingSrcRef.current = prev;
    setImageSrc(prev);
    setSelectedId(null);
    drawCanvas(prev, detected, null, null);
    setStatus("↩️ Undo successful");
  };

  // ---------- Add new text ----------
  const addNewText = () => {
    if (!canvasRef.current) return;
    const w = canvasRef.current.width;
    const h = canvasRef.current.height;
    const bw = Math.min(220, w * 0.4);
    const bh = 40;
    const item: DetectedText = {
      id: generateId(),
      text: "New Text",
      confidence: 100,
      bbox: {
        x0: w / 2 - bw / 2,
        y0: h / 2 - bh / 2,
        x1: w / 2 + bw / 2,
        y1: h / 2 + bh / 2,
      },
      autoSize: 32,
      autoColor: "#111111",
      autoFont: "Inter, sans-serif",
    };
    setDetected((d) => [...d, item]);
    selectText(item);
    setStatus("➕ New text added • Position & style it, then Apply");
  };

  // ---------- Download ----------
  const download = () => {
    if (!workingSrcRef.current) return;
    const link = document.createElement("a");
    link.download = `edited-${Date.now()}.png`;
    link.href = workingSrcRef.current;
    link.click();
    setStatus("💾 Image downloaded");
  };

  // ---------- UI ----------
  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-400 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-lg leading-tight">
                AI Image Text Editor
              </h1>
              <p className="text-xs text-slate-400">
                Auto font • OCR • Smart replace
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn bg-blue-600 hover:bg-blue-500"
            >
              <Upload className="w-4 h-4" />
              Open
            </button>
            <button
              onClick={runOcr}
              disabled={isOcrRunning || !imageSrc}
              className="btn bg-violet-600 hover:bg-violet-500 disabled:opacity-50"
            >
              {isOcrRunning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ScanSearch className="w-4 h-4" />
              )}
              Detect Text
            </button>
            <button
              onClick={applyEdit}
              disabled={!selected}
              className="btn bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              Apply
            </button>
            <button
              onClick={undo}
              disabled={history.length === 0}
              className="btn bg-amber-600 hover:bg-amber-500 disabled:opacity-50"
            >
              <Undo2 className="w-4 h-4" />
              Undo
            </button>
            <button
              onClick={addNewText}
              disabled={!imageSrc}
              className="btn bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Add Text
            </button>
            <button
              onClick={download}
              disabled={!imageSrc}
              className="btn bg-green-600 hover:bg-green-500 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Download
            </button>
          </div>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadImage(f);
        }}
      />

      {/* Main */}
      <div className="flex-1 flex flex-col lg:flex-row max-w-[1600px] w-full mx-auto">
        {/* Sidebar */}
        <aside className="w-full lg:w-[340px] border-r border-slate-800 bg-slate-900/50 p-4 space-y-5 overflow-y-auto max-h-[calc(100vh-64px)]">
          {/* Detected list */}
          <section>
            <h2 className="section-title">
              <Type className="w-4 h-4" /> Detected Text
            </h2>
            {detected.length === 0 ? (
              <p className="text-sm text-slate-500 mt-2">
                No text yet. Upload image → Detect Text
              </p>
            ) : (
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto pr-1">
                {detected.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => selectText(d)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition ${
                      selectedId === d.id
                        ? "bg-cyan-500/20 border border-cyan-500/50 text-cyan-100"
                        : "bg-slate-800/60 hover:bg-slate-800 border border-transparent"
                    }`}
                  >
                    <span className="font-medium">{d.text}</span>
                    <span className="text-xs text-slate-400 ml-2">
                      {Math.round(d.confidence)}%
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Edit controls */}
          <section className={selected ? "" : "opacity-50 pointer-events-none"}>
            <h2 className="section-title">
              <Sparkles className="w-4 h-4" /> Edit & Auto Match
            </h2>

            <label className="label">Replacement Text</label>
            <input
              type="text"
              value={edit.text}
              onChange={(e) => setEdit({ ...edit, text: e.target.value })}
              className="input"
              placeholder="New text..."
            />

            <label className="label mt-3">Font Family (Auto matched)</label>
            <select
              value={edit.fontFamily}
              onChange={(e) =>
                setEdit({ ...edit, fontFamily: e.target.value })
              }
              className="input"
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>

            <label className="label mt-3 flex justify-between">
              <span>Font Size</span>
              <span className="text-cyan-400">{edit.fontSize}px</span>
            </label>
            <input
              type="range"
              min={10}
              max={200}
              value={edit.fontSize}
              onChange={(e) =>
                setEdit({ ...edit, fontSize: Number(e.target.value) })
              }
              className="w-full accent-cyan-500"
            />

            <label className="label mt-3 flex items-center gap-2">
              <Palette className="w-3.5 h-3.5" /> Color (Auto detected)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={edit.color}
                onChange={(e) => setEdit({ ...edit, color: e.target.value })}
                className="w-10 h-10 rounded cursor-pointer bg-transparent border-0"
              />
              <input
                type="text"
                value={edit.color}
                onChange={(e) => setEdit({ ...edit, color: e.target.value })}
                className="input flex-1 font-mono text-sm"
              />
            </div>

            <label className="label mt-3 flex justify-between">
              <span className="flex items-center gap-1">
                <Move className="w-3.5 h-3.5" /> Offset X
              </span>
              <span>{edit.offsetX}px</span>
            </label>
            <input
              type="range"
              min={-150}
              max={150}
              value={edit.offsetX}
              onChange={(e) =>
                setEdit({ ...edit, offsetX: Number(e.target.value) })
              }
              className="w-full accent-cyan-500"
            />

            <label className="label mt-2 flex justify-between">
              <span>Offset Y</span>
              <span>{edit.offsetY}px</span>
            </label>
            <input
              type="range"
              min={-150}
              max={150}
              value={edit.offsetY}
              onChange={(e) =>
                setEdit({ ...edit, offsetY: Number(e.target.value) })
              }
              className="w-full accent-cyan-500"
            />

            <label className="label mt-3 flex justify-between">
              <span className="flex items-center gap-1">
                <RotateCw className="w-3.5 h-3.5" /> Rotation
              </span>
              <span>{edit.rotation}°</span>
            </label>
            <input
              type="range"
              min={-45}
              max={45}
              value={edit.rotation}
              onChange={(e) =>
                setEdit({ ...edit, rotation: Number(e.target.value) })
              }
              className="w-full accent-cyan-500"
            />

            <label className="label mt-3 flex justify-between">
              <span className="flex items-center gap-1">
                <Eraser className="w-3.5 h-3.5" /> Erase Radius
              </span>
              <span>{edit.inpaintRadius}</span>
            </label>
            <input
              type="range"
              min={1}
              max={30}
              value={edit.inpaintRadius}
              onChange={(e) =>
                setEdit({ ...edit, inpaintRadius: Number(e.target.value) })
              }
              className="w-full accent-cyan-500"
            />
          </section>

          <div className="pt-2 border-t border-slate-800">
            <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showBoxes}
                onChange={(e) => setShowBoxes(e.target.checked)}
                className="accent-cyan-500"
              />
              Show detection boxes
            </label>
          </div>

          <div className="text-xs text-slate-500 bg-slate-800/40 rounded-lg p-3 leading-relaxed">
            <strong className="text-slate-300">How to use:</strong>
            <ol className="list-decimal ml-4 mt-1 space-y-1">
              <li>Upload image</li>
              <li>Click Detect Text (auto size + color + font)</li>
              <li>Select a region → edit live</li>
              <li>Click Apply → next text</li>
              <li>Download when done</li>
            </ol>
          </div>
        </aside>

        {/* Canvas area */}
        <main
          className="flex-1 relative canvas-container flex items-center justify-center p-4 overflow-auto min-h-[50vh]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          {!imageSrc ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-600 rounded-2xl p-12 text-center cursor-pointer hover:border-cyan-500/50 hover:bg-slate-900/40 transition max-w-md"
            >
              <ImageIcon className="w-16 h-16 mx-auto text-slate-500 mb-4" />
              <p className="text-lg font-medium text-slate-300">
                Drop image here or click to upload
              </p>
              <p className="text-sm text-slate-500 mt-2">
                JPG, PNG, WebP supported
              </p>
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              className="max-w-full max-h-[calc(100vh-120px)] rounded-lg shadow-2xl shadow-black/40"
            />
          )}
        </main>
      </div>

      {/* Status bar */}
      <footer className="border-t border-slate-800 bg-slate-900 px-4 py-2 text-sm text-slate-400 flex items-center gap-2">
        {isOcrRunning && <Loader2 className="w-4 h-4 animate-spin text-violet-400" />}
        <span>{status}</span>
      </footer>

      <style jsx global>{`
        .btn {
          @apply inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition text-white;
        }
        .section-title {
          @apply flex items-center gap-2 text-sm font-semibold text-slate-200;
        }
        .label {
          @apply block text-xs font-medium text-slate-400 mb-1;
        }
        .input {
          @apply w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500;
        }
      `}</style>
    </div>
  );
}
