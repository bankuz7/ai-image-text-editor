"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  BBox, DetectedText, EditState, FONT_OPTIONS,
  generateId, getDominantColor, estimateFontSize, guessFontFamily,
  simpleInpaint, mergeNearbyBoxes,
} from "@/lib/helpers";

export function useEditor() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [detected, setDetected] = useState<DetectedText[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>({
    text: "",
    fontSize: 32,
    fontFamily: "Inter, sans-serif",
    color: "#1a1a1a",
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    inpaintRadius: 6,
  });
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [status, setStatus] = useState("Upload an image to get started");
  const [history, setHistory] = useState<string[]>([]);
  const [showBoxes, setShowBoxes] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workingSrcRef = useRef<string | null>(null);

  const selected = detected.find((d) => d.id === selectedId) || null;

  const loadImage = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      setImageSrc(src);
      workingSrcRef.current = src;
      setDetected([]);
      setSelectedId(null);
      setHistory([]);
      setStatus("Image loaded • Tap Detect Text");
      const img = new Image();
      img.onload = () => drawCanvas(src, [], null, null);
      img.src = src;
    };
    reader.readAsDataURL(file);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) loadImage(file);
  };

  const drawCanvas = useCallback(
    (src: string, boxes: DetectedText[], sel: DetectedText | null, currentEdit: EditState | null) => {
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
        if (showBoxes) {
          boxes.forEach((d) => {
            const isSel = sel && d.id === sel.id;
            ctx.strokeStyle = isSel ? "#22d3ee" : "#fbbf24";
            ctx.lineWidth = isSel ? Math.max(2, img.width / 400) : Math.max(1, img.width / 600);
            ctx.setLineDash(isSel ? [] : [6, 4]);
            ctx.strokeRect(d.bbox.x0, d.bbox.y0, d.bbox.x1 - d.bbox.x0, d.bbox.y1 - d.bbox.y0);
            ctx.setLineDash([]);
          });
        }
        if (sel && currentEdit) {
          simpleInpaint(ctx, sel.bbox.x0, sel.bbox.y0, sel.bbox.x1, sel.bbox.y1, currentEdit.inpaintRadius);
          ctx.save();
          const cx = (sel.bbox.x0 + sel.bbox.x1) / 2 + currentEdit.offsetX;
          const cy = (sel.bbox.y0 + sel.bbox.y1) / 2 + currentEdit.offsetY;
          ctx.translate(cx, cy);
          ctx.rotate((currentEdit.rotation * Math.PI) / 180);
          ctx.font = `600 ${currentEdit.fontSize}px ${currentEdit.fontFamily}`;
          ctx.fillStyle = currentEdit.color;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.shadowColor = "rgba(0,0,0,0.2)";
          ctx.shadowBlur = 1;
          ctx.fillText(currentEdit.text, 0, 0);
          ctx.restore();
        }
      };
      img.src = src;
    },
    [showBoxes]
  );

  useEffect(() => {
    if (!workingSrcRef.current) return;
    drawCanvas(workingSrcRef.current, detected, selected, selected ? edit : null);
  }, [edit, selectedId, detected, drawCanvas, selected]);

  const runOcr = async () => {
    if (!workingSrcRef.current) {
      setStatus("Please upload an image first");
      return;
    }
    setIsOcrRunning(true);
    setStatus("Detecting text…");
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng+hin", 1, {
        logger: (m) => {
          if (m.status === "recognizing text") {
            setStatus(`OCR ${Math.round((m.progress || 0) * 100)}%`);
          }
        },
      });
      let ocrSrc = workingSrcRef.current;
      const canvas = canvasRef.current;
      let scaleBack = 1;
      if (canvas && (canvas.width < 900 || canvas.height < 900)) {
        const scale = Math.min(2.5, 1200 / Math.max(canvas.width, canvas.height));
        if (scale > 1.15) {
          const tmp = document.createElement("canvas");
          tmp.width = Math.round(canvas.width * scale);
          tmp.height = Math.round(canvas.height * scale);
          const tctx = tmp.getContext("2d")!;
          tctx.imageSmoothingEnabled = true;
          tctx.imageSmoothingQuality = "high";
          const img = new Image();
          await new Promise<void>((res) => {
            img.onload = () => {
              tctx.drawImage(img, 0, 0, tmp.width, tmp.height);
              res();
            };
            img.src = workingSrcRef.current!;
          });
          ocrSrc = tmp.toDataURL("image/png");
          scaleBack = scale;
        }
      }
      const result = await worker.recognize(ocrSrc);
      await worker.terminate();
      const ctx = canvas?.getContext("2d");
      let rawItems: DetectedText[] = [];
      const lines = result.data.lines || [];
      if (lines.length > 0) {
        for (const line of lines) {
          const t = (line.text || "").trim();
          if (!t || t.length < 1) continue;
          if ((line.confidence || 0) < 25) continue;
          const bbox: BBox = {
            x0: line.bbox.x0 / scaleBack,
            y0: line.bbox.y0 / scaleBack,
            x1: line.bbox.x1 / scaleBack,
            y1: line.bbox.y1 / scaleBack,
          };
          if (bbox.x1 - bbox.x0 < 8 || bbox.y1 - bbox.y0 < 6) continue;
          let autoColor = "#1a1a1a";
          if (ctx) autoColor = getDominantColor(ctx, bbox.x0, bbox.y0, bbox.x1, bbox.y1);
          const font = guessFontFamily(t);
          rawItems.push({
            id: generateId(), text: t, confidence: line.confidence || 60, bbox,
            autoSize: estimateFontSize(t, bbox, font), autoColor, autoFont: font,
          });
        }
      }
      if (rawItems.length === 0) {
        const words = result.data.words || [];
        for (const w of words) {
          if (!w.text.trim() || w.confidence < 35) continue;
          const bbox: BBox = {
            x0: w.bbox.x0 / scaleBack, y0: w.bbox.y0 / scaleBack,
            x1: w.bbox.x1 / scaleBack, y1: w.bbox.y1 / scaleBack,
          };
          if (bbox.x1 - bbox.x0 < 6) continue;
          let autoColor = "#1a1a1a";
          if (ctx) autoColor = getDominantColor(ctx, bbox.x0, bbox.y0, bbox.x1, bbox.y1);
          const font = guessFontFamily(w.text);
          rawItems.push({
            id: generateId(), text: w.text, confidence: w.confidence, bbox,
            autoSize: estimateFontSize(w.text, bbox, font), autoColor, autoFont: font,
          });
        }
        rawItems = mergeNearbyBoxes(rawItems);
      }
      for (const item of rawItems) {
        item.autoSize = estimateFontSize(item.text, item.bbox, item.autoFont);
        if (ctx) item.autoColor = getDominantColor(ctx, item.bbox.x0, item.bbox.y0, item.bbox.x1, item.bbox.y1);
      }
      setDetected(rawItems);
      if (rawItems.length > 0) {
        selectText(rawItems[0]);
        setStatus(`✅ ${rawItems.length} text found • Tap any text on image to edit`);
        setSidebarOpen(true);
      } else {
        setStatus("No text found. Try a clearer / higher-res image.");
      }
    } catch (err: any) {
      console.error(err);
      setStatus("OCR failed: " + (err?.message || "Unknown error"));
    } finally {
      setIsOcrRunning(false);
    }
  };

  const selectText = (item: DetectedText) => {
    const size = estimateFontSize(item.text, item.bbox, item.autoFont);
    const radius = Math.max(4, Math.min(20, Math.round(Math.max(item.bbox.x1 - item.bbox.x0, item.bbox.y1 - item.bbox.y0) * 0.07)));
    setSelectedId(item.id);
    setEdit({
      text: item.text, fontSize: size, fontFamily: item.autoFont, color: item.autoColor,
      offsetX: 0, offsetY: 0, rotation: 0, inpaintRadius: radius,
    });
    setStatus(`Selected "${item.text.slice(0, 30)}${item.text.length > 30 ? "…" : ""}" • ${size}px`);
    setSidebarOpen(true);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || detected.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    let best: DetectedText | null = null;
    let bestArea = Infinity;
    for (const d of detected) {
      const { x0, y0, x1, y1 } = d.bbox;
      const pad = 6;
      if (x >= x0 - pad && x <= x1 + pad && y >= y0 - pad && y <= y1 + pad) {
        const area = (x1 - x0) * (y1 - y0);
        if (area < bestArea) { bestArea = area; best = d; }
      }
    }
    if (best) selectText(best);
    else setStatus("Tap inside a yellow box to select text");
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || detected.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    let over = false;
    for (const d of detected) {
      const { x0, y0, x1, y1 } = d.bbox;
      if (x >= x0 - 6 && x <= x1 + 6 && y >= y0 - 6 && y <= y1 + 6) { over = true; break; }
    }
    canvas.style.cursor = over ? "pointer" : "crosshair";
  };

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
      simpleInpaint(tctx, selected.bbox.x0, selected.bbox.y0, selected.bbox.x1, selected.bbox.y1, edit.inpaintRadius);
      tctx.save();
      const cx = (selected.bbox.x0 + selected.bbox.x1) / 2 + edit.offsetX;
      const cy = (selected.bbox.y0 + selected.bbox.y1) / 2 + edit.offsetY;
      tctx.translate(cx, cy);
      tctx.rotate((edit.rotation * Math.PI) / 180);
      tctx.font = `600 ${edit.fontSize}px ${edit.fontFamily}`;
      tctx.fillStyle = edit.color;
      tctx.textAlign = "center";
      tctx.textBaseline = "middle";
      tctx.shadowColor = "rgba(0,0,0,0.15)";
      tctx.shadowBlur = 1;
      tctx.fillText(edit.text, 0, 0);
      tctx.restore();
      const newSrc = tempCanvas.toDataURL("image/png");
      workingSrcRef.current = newSrc;
      setImageSrc(newSrc);
      const remaining = detected.filter((d) => d.id !== selected.id);
      setDetected(remaining);
      setSelectedId(null);
      if (remaining.length > 0) selectText(remaining[0]);
      else drawCanvas(newSrc, [], null, null);
      setStatus("✅ Applied • Tap next text or Download");
    };
    img.src = workingSrcRef.current;
  };

  const undo = () => {
    if (history.length === 0) { setStatus("Nothing to undo"); return; }
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    workingSrcRef.current = prev;
    setImageSrc(prev);
    setSelectedId(null);
    drawCanvas(prev, detected, null, null);
    setStatus("↩️ Undo");
  };

  const addNewText = () => {
    if (!canvasRef.current) return;
    const w = canvasRef.current.width;
    const h = canvasRef.current.height;
    const bw = Math.min(200, w * 0.35);
    const bh = Math.max(28, h * 0.04);
    const item: DetectedText = {
      id: generateId(), text: "New Text", confidence: 100,
      bbox: { x0: w / 2 - bw / 2, y0: h / 2 - bh / 2, x1: w / 2 + bw / 2, y1: h / 2 + bh / 2 },
      autoSize: 28, autoColor: "#1a1a1a", autoFont: "Inter, sans-serif",
    };
    setDetected((d) => [...d, item]);
    selectText(item);
    setStatus("➕ New text • Adjust then Apply");
  };

  const download = () => {
    if (!workingSrcRef.current) return;
    const link = document.createElement("a");
    link.download = `edited-${Date.now()}.png`;
    link.href = workingSrcRef.current;
    link.click();
    setStatus("💾 Downloaded");
  };

  return {
    imageSrc, setImageSrc, detected, setDetected, selectedId, setSelectedId,
    edit, setEdit, isOcrRunning, status, setStatus, history,
    showBoxes, setShowBoxes, sidebarOpen, setSidebarOpen,
    canvasRef, fileInputRef, selected,
    loadImage, onDrop, runOcr, selectText,
    handleCanvasClick, handleCanvasMouseMove,
    applyEdit, undo, addNewText, download,
  };
}
