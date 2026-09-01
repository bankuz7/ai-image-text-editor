"use client";

import {
  Upload, ScanSearch, Check, Undo2, Download, Plus, Type, Palette,
  Move, RotateCw, Eraser, Loader2, ImageIcon, Sparkles, Menu, X,
} from "lucide-react";
import { FONT_OPTIONS } from "@/lib/helpers";
import { useEditor } from "@/components/useEditor";

export default function Editor() {
  const {
    imageSrc, detected, selectedId, edit, setEdit,
    isOcrRunning, status, history, showBoxes, setShowBoxes,
    sidebarOpen, setSidebarOpen,
    canvasRef, fileInputRef, selected,
    loadImage, onDrop, runOcr, selectText,
    handleCanvasClick, handleCanvasMouseMove,
    applyEdit, undo, addNewText, download,
  } = useEditor();

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              className="lg:hidden p-2 rounded-lg bg-slate-800 text-slate-200"
              onClick={() => setSidebarOpen((o) => !o)}
              aria-label="Toggle panel"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-400 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0 hidden sm:block">
              <h1 className="font-semibold text-base leading-tight truncate">AI Text Editor</h1>
              <p className="text-[11px] text-slate-400 truncate">Tap text • Auto match</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
            <button onClick={() => fileInputRef.current?.click()} className="btn bg-blue-600 hover:bg-blue-500 text-xs sm:text-sm px-2.5 sm:px-3">
              <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Open</span>
            </button>
            <button onClick={runOcr} disabled={isOcrRunning || !imageSrc} className="btn bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-xs sm:text-sm px-2.5 sm:px-3">
              {isOcrRunning ? <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" /> : <ScanSearch className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
              Detect
            </button>
            <button onClick={applyEdit} disabled={!selected} className="btn bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs sm:text-sm px-2.5 sm:px-3">
              <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Apply
            </button>
            <button onClick={undo} disabled={history.length === 0} className="btn bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-xs sm:text-sm px-2.5 sm:px-3">
              <Undo2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
            <button onClick={download} disabled={!imageSrc} className="btn bg-green-600 hover:bg-green-500 disabled:opacity-50 text-xs sm:text-sm px-2.5 sm:px-3">
              <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          </div>
        </div>
      </header>

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) loadImage(f); }} />

      <div className="flex-1 flex flex-col lg:flex-row max-w-[1600px] w-full mx-auto relative">
        <aside className={`fixed lg:static inset-y-0 left-0 z-20 w-[min(100%,320px)] lg:w-[320px] border-r border-slate-800 bg-slate-900 p-3 sm:p-4 space-y-4 overflow-y-auto transform transition-transform duration-200 ease-out ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"} top-[52px] lg:top-0 max-h-[calc(100vh-52px)] lg:max-h-[calc(100vh-56px)]`}>
          <section>
            <h2 className="section-title"><Type className="w-4 h-4" /> Detected Text</h2>
            {detected.length === 0 ? (
              <p className="text-sm text-slate-500 mt-2">Upload → Detect → Tap text on image</p>
            ) : (
              <div className="mt-2 space-y-1 max-h-36 overflow-y-auto pr-1">
                {detected.map((d) => (
                  <button key={d.id} onClick={() => selectText(d)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition ${
                      selectedId === d.id
                        ? "bg-cyan-500/20 border border-cyan-500/50 text-cyan-100"
                        : "bg-slate-800/60 hover:bg-slate-800 border border-transparent"
                    }`}>
                    <span className="font-medium">{d.text}</span>
                    <span className="text-xs text-slate-400 ml-2">{Math.round(d.confidence)}%</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className={selected ? "" : "opacity-40 pointer-events-none"}>
            <h2 className="section-title"><Sparkles className="w-4 h-4" /> Edit</h2>
            <label className="label">Text</label>
            <input type="text" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} className="input" placeholder="New text…" />
            <label className="label mt-3">Font</label>
            <select value={edit.fontFamily} onChange={(e) => setEdit({ ...edit, fontFamily: e.target.value })} className="input">
              {FONT_OPTIONS.map((f) => (<option key={f.value} value={f.value}>{f.label}</option>))}
            </select>
            <label className="label mt-3 flex justify-between"><span>Size</span><span className="text-cyan-400">{edit.fontSize}px</span></label>
            <input type="range" min={10} max={220} value={edit.fontSize} onChange={(e) => setEdit({ ...edit, fontSize: Number(e.target.value) })} className="w-full accent-cyan-500" />
            <label className="label mt-3 flex items-center gap-2"><Palette className="w-3.5 h-3.5" /> Color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })} className="w-10 h-10 rounded cursor-pointer bg-transparent border-0" />
              <input type="text" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })} className="input flex-1 font-mono text-sm" />
            </div>
            <label className="label mt-3 flex justify-between"><span className="flex items-center gap-1"><Move className="w-3.5 h-3.5" /> Offset X</span><span>{edit.offsetX}</span></label>
            <input type="range" min={-150} max={150} value={edit.offsetX} onChange={(e) => setEdit({ ...edit, offsetX: Number(e.target.value) })} className="w-full accent-cyan-500" />
            <label className="label mt-2 flex justify-between"><span>Offset Y</span><span>{edit.offsetY}</span></label>
            <input type="range" min={-150} max={150} value={edit.offsetY} onChange={(e) => setEdit({ ...edit, offsetY: Number(e.target.value) })} className="w-full accent-cyan-500" />
            <label className="label mt-3 flex justify-between"><span className="flex items-center gap-1"><RotateCw className="w-3.5 h-3.5" /> Rotation</span><span>{edit.rotation}°</span></label>
            <input type="range" min={-45} max={45} value={edit.rotation} onChange={(e) => setEdit({ ...edit, rotation: Number(e.target.value) })} className="w-full accent-cyan-500" />
            <label className="label mt-3 flex justify-between"><span className="flex items-center gap-1"><Eraser className="w-3.5 h-3.5" /> Erase</span><span>{edit.inpaintRadius}</span></label>
            <input type="range" min={1} max={28} value={edit.inpaintRadius} onChange={(e) => setEdit({ ...edit, inpaintRadius: Number(e.target.value) })} className="w-full accent-cyan-500" />
            <button onClick={addNewText} disabled={!imageSrc} className="mt-4 w-full btn bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 justify-center">
              <Plus className="w-4 h-4" /> Add New Text
            </button>
          </section>

          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer pt-1">
            <input type="checkbox" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} className="accent-cyan-500" />
            Show boxes
          </label>
        </aside>

        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/50 z-10 lg:hidden top-[52px]" onClick={() => setSidebarOpen(false)} />
        )}

        <main className="flex-1 relative canvas-container flex items-center justify-center p-2 sm:p-4 overflow-auto min-h-[45vh]"
          onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          {!imageSrc ? (
            <div onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-600 rounded-2xl p-8 sm:p-12 text-center cursor-pointer hover:border-cyan-500/50 hover:bg-slate-900/40 transition max-w-md mx-4">
              <ImageIcon className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-slate-500 mb-3" />
              <p className="text-base sm:text-lg font-medium text-slate-300">Tap to upload image</p>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">JPG, PNG, WebP</p>
            </div>
          ) : (
            <canvas ref={canvasRef} onClick={handleCanvasClick} onMouseMove={handleCanvasMouseMove}
              className="max-w-full max-h-[calc(100vh-110px)] rounded-lg shadow-2xl shadow-black/40 cursor-crosshair touch-manipulation" />
          )}
        </main>
      </div>

      <footer className="border-t border-slate-800 bg-slate-900 px-3 py-2 text-xs sm:text-sm text-slate-400 flex items-center gap-2 sticky bottom-0 z-20">
        {isOcrRunning && <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400 shrink-0" />}
        <span className="truncate">{status}</span>
      </footer>

      <style jsx global>{`
        .btn { @apply inline-flex items-center gap-1 sm:gap-1.5 py-1.5 rounded-lg font-medium transition text-white; }
        .section-title { @apply flex items-center gap-2 text-sm font-semibold text-slate-200; }
        .label { @apply block text-xs font-medium text-slate-400 mb-1; }
        .input { @apply w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500; }
      `}</style>
    </div>
  );
}
