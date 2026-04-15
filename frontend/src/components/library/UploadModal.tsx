"use client";

import { useState, useRef, useCallback } from "react";
import { createKnowledge, extractKnowledge } from "@/lib/api";

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "screenshot" | "text";
}

export function UploadModal({ isOpen, onClose, mode }: UploadModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      setUploadedFile(file);
    }
  }, []);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      if (mode === "screenshot" && uploadedFile) {
        const result = await extractKnowledge(uploadedFile);
        if (result.entries && result.entries.length > 0) {
          for (const entry of result.entries) {
            await createKnowledge({
              question_patterns: entry.question_patterns || [result.detected_question || "Unknown"],
              answer: entry.answer || "",
              tags: entry.tags || result.tags || [],
            });
          }
          alert(`Successfully extracted ${result.entries.length} knowledge entries!`);
        } else {
          alert("No knowledge entries could be extracted from this image.");
        }
      } else if (mode === "text" && pasteText.trim()) {
        const result = await extractKnowledge(undefined, pasteText);
        if (result.entries && result.entries.length > 0) {
          for (const entry of result.entries) {
            await createKnowledge({
              question_patterns: entry.question_patterns || ["Unknown"],
              answer: entry.answer || "",
              tags: entry.tags || [],
            });
          }
          alert(`Successfully extracted ${result.entries.length} knowledge entries!`);
        } else {
          await createKnowledge({
            question_patterns: [pasteText.slice(0, 100)],
            answer: pasteText,
            tags: ["manual"],
          });
          alert("Knowledge entry created!");
        }
      }
      onClose();
      setUploadedFile(null);
      setPasteText("");
      window.location.reload();
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-inverse-surface/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-lg p-8 z-10">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-on-surface">
            {mode === "screenshot" ? "Upload Screenshot" : "Paste Knowledge Text"}
          </h3>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {mode === "screenshot" ? (
          <div className="space-y-4">
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                isDragging ? "border-primary bg-primary/5" : "border-outline-variant/30 hover:border-primary/50"
              }`}
            >
              {uploadedFile ? (
                <>
                  <span className="material-symbols-outlined text-primary text-4xl mb-3">check_circle</span>
                  <p className="text-sm font-bold text-on-surface">{uploadedFile.name}</p>
                  <p className="text-xs text-on-surface-variant mt-1">
                    {(uploadedFile.size / 1024).toFixed(0)} KB
                  </p>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-primary/40 text-4xl mb-3">cloud_upload</span>
                  <p className="text-sm font-bold text-on-surface">Drop screenshot here</p>
                  <p className="text-xs text-on-surface-variant mt-1">or click to browse</p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setUploadedFile(file);
                }}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste your knowledge text, meeting notes, or article content here..."
              className="w-full bg-surface-container-low/30 border-none focus:ring-2 focus:ring-primary/20 rounded-xl p-4 text-sm leading-relaxed text-on-surface resize-none h-48"
            />
            <div className="flex gap-2">
              <span className="px-3 py-1 bg-surface-container rounded-full text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                Auto-Summary
              </span>
              <span className="px-3 py-1 bg-surface-container rounded-full text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                Markdown Support
              </span>
            </div>
          </div>
        )}

        <div className="flex gap-3 mt-8">
          <button
            onClick={onClose}
            className="flex-1 px-6 py-3 bg-surface-container-high text-on-surface font-bold rounded-xl hover:bg-surface-container-highest transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || (mode === "screenshot" ? !uploadedFile : !pasteText.trim())}
            className="flex-[2] px-6 py-3 bg-primary text-on-primary font-bold rounded-xl hover:opacity-90 transition-opacity text-sm disabled:opacity-50"
          >
            <span className="flex items-center justify-center gap-2">
              <span className={`material-symbols-outlined text-sm ${isSubmitting ? "animate-spin" : ""}`}>
                {isSubmitting ? "autorenew" : "auto_awesome"}
              </span>
              {isSubmitting ? "Processing..." : "Extract Knowledge"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
