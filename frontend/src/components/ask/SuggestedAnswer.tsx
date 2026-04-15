"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";

interface SourceEntry {
  id: string;
  question_patterns: string[];
  answer: string;
  score: number;
  tags?: string[];
}

interface SuggestedAnswerProps {
  draftReply: string | null;
  confidence: number;
  isProcessing: boolean;
  sources: SourceEntry[];
  onReject: () => void;
}

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function ScoreBar({ score }: { score: number }) {
  const maxScore = 10;
  const pct = Math.min((score / maxScore) * 100, 100);
  const color = pct >= 60 ? "bg-emerald-500" : pct >= 30 ? "bg-amber-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-bold text-on-surface-variant tabular-nums">{score.toFixed(2)}</span>
    </div>
  );
}

function SourceCard({ source }: { source: SourceEntry }) {
  const [expanded, setExpanded] = useState(false);
  const firstPattern = source.question_patterns[0] || "—";
  const tags = source.tags ?? [];

  return (
    <button
      type="button"
      onClick={() => setExpanded(!expanded)}
      className="w-full text-left bg-surface-container-low hover:bg-surface-container-high rounded-lg p-3 transition-colors border border-outline-variant/10"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <code className="text-[10px] font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded shrink-0">
          {truncateId(source.id)}
        </code>
        <span className="material-symbols-outlined text-xs text-on-surface-variant">
          {expanded ? "expand_less" : "expand_more"}
        </span>
      </div>
      <p className="text-xs font-medium text-on-surface line-clamp-1 mb-1.5">{firstPattern}</p>
      <ScoreBar score={source.score} />
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {tags.map((tag) => (
            <span key={tag} className="px-1.5 py-0.5 bg-secondary-container text-on-secondary-container text-[9px] font-bold rounded-full">
              {tag}
            </span>
          ))}
        </div>
      )}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-outline-variant/10">
          <p className="text-xs text-on-surface-variant leading-relaxed whitespace-pre-wrap">{source.answer}</p>
        </div>
      )}
    </button>
  );
}

export function SuggestedAnswer({
  draftReply,
  confidence,
  isProcessing,
  sources,
  onReject,
}: SuggestedAnswerProps) {
  const { t } = useI18n();
  const [editedReply, setEditedReply] = useState(draftReply || "");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (draftReply !== null) {
      setEditedReply(draftReply);
    }
  }, [draftReply]);

  const confidenceColor = confidence >= 0.9
    ? "bg-emerald-50 border-emerald-100 text-emerald-800"
    : confidence >= 0.6
    ? "bg-amber-50 border-amber-100 text-amber-800"
    : "bg-red-50 border-red-100 text-red-800";

  const confidenceDotColor = confidence >= 0.9
    ? "bg-emerald-500"
    : confidence >= 0.6
    ? "bg-amber-500"
    : "bg-red-500";

  return (
    <section className="col-span-12 lg:col-span-8 space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center text-xs font-bold">3</span>
        <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface-variant">{t("ask.suggestedAnswer")}</h3>
      </div>

      <div className="bg-surface-container-lowest rounded-xl p-8 shadow-xl border border-primary/10 relative min-h-[400px]">
        {isProcessing ? (
          <div className="flex flex-col items-center justify-center h-full py-16">
            <div className="w-16 h-16 rounded-full bg-primary/5 flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-primary text-3xl animate-spin">autorenew</span>
            </div>
            <p className="text-sm font-bold text-on-surface mb-1">{t("ask.generatingResponse")}</p>
            <p className="text-xs text-on-surface-variant">{t("ask.generatingResponseDesc")}</p>
          </div>
        ) : draftReply ? (
          <>
            {/* Confidence Badge */}
            <div className={`absolute top-6 right-6 flex items-center gap-2 px-3 py-1 rounded-full border ${confidenceColor}`}>
              <span className={`w-2 h-2 rounded-full ${confidenceDotColor} animate-pulse`} />
              <span className="text-[11px] font-bold">{Math.round(confidence * 100)}% {t("ask.confidence")}</span>
            </div>

            {/* AI Draft — clean, direct display */}
            <div className="mb-6">
              <textarea
                value={editedReply}
                onChange={(e) => setEditedReply(e.target.value)}
                rows={10}
                className="w-full bg-surface-container-low/30 border border-outline-variant/20 focus:ring-2 focus:ring-primary/20 focus:border-primary/40 rounded-xl p-6 text-base leading-relaxed text-on-surface resize-y"
                placeholder={t("ask.aiDraftResponse")}
              />
            </div>

            {/* Citation Sources */}
            <div className="mb-8">
              <label className="text-[10px] font-bold text-primary tracking-widest block mb-3 uppercase">
                {t("ask.sourcesLabel")}
              </label>
              {sources.length > 0 ? (
                <div className="space-y-2">
                  {sources.map((src) => (
                    <SourceCard key={src.id} source={src} />
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <span className="material-symbols-outlined text-amber-600 text-lg">warning</span>
                  <p className="text-xs text-amber-800 font-medium">
                    {t("ask.noSourcesWarning")}
                  </p>
                </div>
              )}
            </div>

            {/* Action Buttons — just copy */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(editedReply);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex-1 px-8 py-4 bg-gradient-to-br from-primary to-primary-dim text-on-primary font-bold rounded-full shadow-lg shadow-primary/20 hover:opacity-90 transition-opacity flex items-center justify-center gap-2 text-sm"
              >
                <span className="material-symbols-outlined text-sm">{copied ? "check" : "content_copy"}</span>
                {copied ? t("ask.copied") : t("ask.copyToClipboard")}
              </button>
              <button
                onClick={onReject}
                className="px-6 py-4 bg-surface-container-high text-on-surface-variant font-bold rounded-full hover:bg-surface-container-highest transition-colors flex items-center justify-center gap-2 text-sm"
              >
                <span className="material-symbols-outlined text-sm">refresh</span>
                {t("ask.newQuery")}
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-surface-container-low flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-on-surface-variant/40 text-3xl">smart_toy</span>
            </div>
            <p className="text-sm font-medium text-on-surface-variant/60 mb-1">
              {t("ask.readyToRespond")}
            </p>
            <p className="text-xs text-on-surface-variant/40 max-w-[200px]">
              {t("ask.readyToRespondDesc")}
            </p>
          </div>
        )}
      </div>

      {/* Smart Routing Info */}
      {draftReply && !isProcessing && (
        <div className="bg-tertiary/5 p-6 rounded-xl border border-tertiary/10">
          <div className="flex items-start gap-4">
            <span className="material-symbols-outlined text-tertiary">info</span>
            <div>
              <p className="text-sm font-bold text-tertiary mb-1">{t("ask.smartRouting")}</p>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                {t("ask.smartRoutingDesc")}
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
