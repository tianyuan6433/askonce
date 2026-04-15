"use client";

import { useI18n } from "@/lib/i18n";

interface HistoryItem {
  id: string;
  title: string;
  subtitle: string;
  timeAgo: string;
  status: "sent" | "draft" | "saved";
}

const mockHistory: HistoryItem[] = [
  { id: "1", title: "Project Alpha Sync", subtitle: "Sent to client via Slack", timeAgo: "YESTERDAY", status: "sent" },
  { id: "2", title: "Billing Inquiry #902", subtitle: "Resolved in Intercom", timeAgo: "2 DAYS AGO", status: "sent" },
  { id: "3", title: "Roadmap Question", subtitle: "Saved to Library", timeAgo: "3 DAYS AGO", status: "draft" },
];

export function RecentActivity() {
  const { t } = useI18n();
  return (
    <section className="mt-16">
      <h3 className="text-xl font-bold mb-8 flex items-center gap-3">
        <span className="material-symbols-outlined text-primary">history</span>
        {t("ask.draftingHistory")}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {mockHistory.map((item) => (
          <div
            key={item.id}
            className="p-6 bg-surface-container-lowest rounded-xl shadow-sm hover:shadow-md transition-shadow group cursor-pointer"
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-4 ${
              item.status === "sent"
                ? "bg-secondary-container/30 text-secondary"
                : "bg-primary/5 text-primary"
            }`}>
              <span className="material-symbols-outlined">
                {item.status === "sent" ? "done_all" : "drafts"}
              </span>
            </div>
            <p className="text-sm font-bold mb-1 truncate">{item.title}</p>
            <p className="text-xs text-on-surface-variant mb-4">{item.subtitle}</p>
            <span className="text-[10px] font-bold text-on-surface-variant/40">{item.timeAgo}</span>
          </div>
        ))}
        <div className="p-6 border-2 border-dashed border-outline-variant/20 rounded-xl flex flex-col items-center justify-center text-center group cursor-pointer hover:bg-surface-container-low transition-colors">
          <span className="material-symbols-outlined text-outline-variant group-hover:text-primary mb-2">add_circle</span>
          <p className="text-xs font-bold text-outline-variant">{t("ask.viewFullArchive")}</p>
        </div>
      </div>
    </section>
  );
}
