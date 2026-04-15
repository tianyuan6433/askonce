"use client";

import { useState, useRef, useCallback } from "react";
import { useI18n } from "@/lib/i18n";

interface InputZoneProps {
  onImageUpload: (file: File) => void;
  onTextSubmit: (text: string) => void;
  isProcessing: boolean;
}

export function InputZone({ onImageUpload, onTextSubmit, isProcessing }: InputZoneProps) {
  const { t } = useI18n();
  const [isDragging, setIsDragging] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showPreviewAndUpload = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    onImageUpload(file);
  }, [onImageUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      showPreviewAndUpload(file);
    }
  }, [showPreviewAndUpload]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      showPreviewAndUpload(file);
    }
  }, [showPreviewAndUpload]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            showPreviewAndUpload(file);
            break;
          }
        }
      }
    }
  }, [showPreviewAndUpload]);

  const clearPreview = useCallback(() => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
  }, [imagePreview]);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center text-xs font-bold">1</span>
        <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface-variant">{t("ask.inputZone")}</h3>
      </div>

      <div className="bg-surface-container-lowest border border-primary/5 rounded-xl p-6 space-y-4" onPaste={handlePaste}>
        {/* Drop Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !imagePreview && fileInputRef.current?.click()}
          className={`group relative border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center text-center transition-all aspect-[3/2] cursor-pointer ${
            isDragging
              ? "border-primary bg-primary/5 scale-[1.02]"
              : "border-outline-variant/30 bg-surface-container-low/30 hover:border-primary/50"
          }`}
        >
          {imagePreview ? (
            <div className="relative w-full h-full flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview} alt="Preview" className="max-w-full max-h-full rounded-lg object-contain" />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); clearPreview(); }}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-surface-container-highest/80 flex items-center justify-center hover:bg-error/20 transition-colors"
              >
                <span className="material-symbols-outlined text-xs text-on-surface">close</span>
              </button>
            </div>
          ) : (
            <>
              <div className={`w-12 h-12 rounded-full bg-primary/5 flex items-center justify-center mb-3 transition-transform ${
                isDragging ? "scale-125" : "group-hover:scale-110"
              }`}>
                <span className="material-symbols-outlined text-primary text-2xl">
                  {isProcessing ? "hourglass_top" : "cloud_upload"}
                </span>
              </div>
              <p className="text-xs font-bold text-on-surface mb-1">
                {isProcessing ? t("ask.processing") : t("ask.uploadScreenshot")}
              </p>
              <p className="text-[10px] text-on-surface-variant">
                {isDragging ? t("ask.releaseToUpload") : t("ask.dragHint")}
              </p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* OR Divider */}
        <div className="relative">
          <div aria-hidden="true" className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-outline-variant/20" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-surface-container-lowest px-2 text-on-surface-variant/40 font-bold">{t("ask.or")}</span>
          </div>
        </div>

        {/* Text Query */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
            {t("ask.directTextQuery")}
          </label>
          <textarea
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            className="w-full bg-surface-container-low/30 border-none focus:ring-2 focus:ring-primary/20 rounded-xl p-4 text-xs leading-relaxed text-on-surface resize-none h-32"
            placeholder={t("ask.textQueryPlaceholder")}
          />
          <button
            onClick={() => {
              if (queryText.trim()) {
                onTextSubmit(queryText.trim());
                setQueryText("");
              }
            }}
            disabled={!queryText.trim() || isProcessing}
            className="w-full py-3 bg-secondary-container text-on-secondary-container text-xs font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isProcessing ? t("ask.analyzingText") : t("ask.analyzeText")}
          </button>
        </div>
      </div>

      {/* Recent Drafts */}
      <div className="bg-surface-container-low rounded-xl p-6">
        <h4 className="text-xs font-bold mb-4 opacity-60">{t("ask.recentDrafts")}</h4>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-surface-container-lowest flex items-center justify-center">
              <span className="material-symbols-outlined text-xs">image</span>
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-semibold truncate">Customer_Inquiry_04.png</p>
              <p className="text-[10px] opacity-50">2 mins ago</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-surface-container-lowest flex items-center justify-center">
              <span className="material-symbols-outlined text-xs">text_snippet</span>
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-semibold truncate">Email_Feedback_Text</p>
              <p className="text-[10px] opacity-50">1 hour ago</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
