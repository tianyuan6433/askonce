"use client";

import { useI18n } from "@/lib/i18n";

interface AIIdentificationProps {
  detectedQuestion: string | null;
  tags: string[];
  imagePreviewUrl: string | null;
  isProcessing: boolean;
  matchedSourceCount?: number;
}

export function AIIdentification({ detectedQuestion, tags, imagePreviewUrl, isProcessing, matchedSourceCount = 0 }: AIIdentificationProps) {
  const { t } = useI18n();
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center text-xs font-bold">2</span>
        <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface-variant">{t("ask.aiIdentification")}</h3>
      </div>

      <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-primary/5">
        {isProcessing ? (
          <div className="flex flex-col items-center justify-center h-full py-16">
            <div className="w-16 h-16 rounded-full bg-primary/5 flex items-center justify-center mb-4 animate-pulse">
              <span className="material-symbols-outlined text-primary text-3xl">psychology</span>
            </div>
            <p className="text-sm font-bold text-on-surface mb-1">{t("ask.analyzingInput")}</p>
            <p className="text-xs text-on-surface-variant">{t("ask.analyzingInputDesc")}</p>
          </div>
        ) : detectedQuestion ? (
          <>
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-bold text-primary tracking-widest">
                  {t("ask.detectedQuestion")}
                </label>
                {matchedSourceCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold rounded-full">
                    <span className="material-symbols-outlined text-xs">library_books</span>
                    {t("ask.matchedKnowledge", { n: matchedSourceCount })}
                  </span>
                )}
              </div>
              <p className="text-lg font-medium leading-relaxed italic text-on-surface">
                &ldquo;{detectedQuestion}&rdquo;
              </p>
            </div>

            {tags.length > 0 && (
              <div className="mb-8">
                <label className="text-[10px] font-bold text-primary tracking-widest block mb-3">
                  {t("ask.tagsContext")}
                </label>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1 bg-secondary-container text-on-secondary-container text-[11px] font-bold rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {imagePreviewUrl && (
              <div className="relative overflow-hidden rounded-lg aspect-video border border-outline-variant/10">
                <img
                  src={imagePreviewUrl}
                  alt={t("ask.uploadedScreenshot")}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                  <span className="bg-white/90 backdrop-blur px-3 py-1 rounded text-[10px] font-bold">
                    {t("ask.scanningCompleted")}
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-surface-container-low flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-on-surface-variant/40 text-3xl">search</span>
            </div>
            <p className="text-sm font-medium text-on-surface-variant/60 mb-1">
              {t("ask.awaitingInput")}
            </p>
            <p className="text-xs text-on-surface-variant/40 max-w-[200px]">
              {t("ask.awaitingInputDesc")}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
