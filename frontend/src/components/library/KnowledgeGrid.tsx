"use client";

import { useState, useEffect, useCallback } from "react";
import { KnowledgeCard } from "./KnowledgeCard";
import { listKnowledge, type KnowledgeEntry } from "@/lib/api";

type FilterTab = "all" | "recent" | "favorites";

const tagColorMap: Record<string, "primary" | "secondary" | "tertiary" | "default"> = {
  pricing: "primary",
  enterprise: "primary",
  returns: "tertiary",
  policy: "tertiary",
  support: "tertiary",
  development: "secondary",
  onboarding: "primary",
};

function getTagColor(tags: string[]): "primary" | "secondary" | "tertiary" | "default" {
  for (const tag of tags) {
    if (tagColorMap[tag.toLowerCase()]) return tagColorMap[tag.toLowerCase()];
  }
  return "default";
}

function getStatus(entry: KnowledgeEntry): "cited" | "draft" | "review" {
  if (entry.status === "review") return "review";
  if (entry.confidence >= 0.8) return "cited";
  return "draft";
}

export function KnowledgeGrid() {
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listKnowledge({ page: 1, page_size: 50 });
      setEntries(data.items);
      setTotal(data.total);
    } catch (err) {
      console.error("Failed to load knowledge:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "recent", label: "Recent" },
    { key: "favorites", label: "Favorites" },
  ];

  return (
    <section className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-outline-variant/10 pb-6">
        <h2 className="text-3xl font-bold tracking-tight text-on-surface">
          Knowledge Library
          {total > 0 && (
            <span className="text-base font-normal text-on-surface-variant ml-3">({total} entries)</span>
          )}
        </h2>
        <div className="flex items-center gap-3">
          <div className="flex bg-surface-container-low p-1 rounded-full">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  activeTab === tab.key
                    ? "bg-surface-container-lowest shadow-sm text-on-surface"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            onClick={fetchEntries}
            className="p-2.5 bg-surface-container-low text-on-surface-variant rounded-full hover:bg-surface-container-high transition-colors"
            title="Refresh"
          >
            <span className="material-symbols-outlined">refresh</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <span className="material-symbols-outlined text-primary animate-spin text-3xl">autorenew</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-surface-container-low flex items-center justify-center mb-4">
            <span className="material-symbols-outlined text-on-surface-variant/40 text-3xl">menu_book</span>
          </div>
          <p className="text-sm font-medium text-on-surface-variant/60 mb-1">No Knowledge Yet</p>
          <p className="text-xs text-on-surface-variant/40 max-w-[250px]">
            Upload screenshots or paste text above to start building your knowledge base.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {entries.map((entry) => (
            <KnowledgeCard
              key={entry.id}
              id={entry.id}
              title={entry.question_patterns[0] || "Untitled"}
              description={entry.answer}
              tag={entry.tags[0] || "General"}
              tagColor={getTagColor(entry.tags)}
              timeAgo={entry.source_type}
              status={getStatus(entry)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
