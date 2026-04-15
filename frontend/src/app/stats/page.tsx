"use client";

import { useEffect, useState } from "react";
import {
  getStatsOverview,
  getTrends,
  type StatsOverview,
  type TrendsResponse,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/* ── helpers ─────────────────────────────────────────────────────── */

function estimateTimeSavedMinutes(stats: StatsOverview): number {
  // ~3 min saved per auto reply, ~1.5 min per confirmed draft
  return stats.auto_reply_count * 3 + stats.confirmed_count * 1.5;
}

function fmtHours(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function coveragePercent(stats: StatsOverview): number {
  // Resolution rate: % of queries where user actually adopted the reply (copied)
  if (stats.total_interactions === 0) return 0;
  return Math.min(Math.round((stats.adopted_count / stats.total_interactions) * 100), 100);
}

interface ActivityItem {
  icon: string;
  label: string;
  detail: string;
  timeSaved: string;
  color: string;
}

function buildActivityLog(stats: StatsOverview, t: (key: string, vars?: Record<string, string | number>) => string): ActivityItem[] {
  const items: ActivityItem[] = [];
  if (stats.auto_reply_count > 0) {
    items.push({
      icon: "bolt",
      label: t("stats.autoReplied"),
      detail: t("stats.autoRepliedDesc", { n: stats.auto_reply_count }),
      timeSaved: fmtHours(stats.auto_reply_count * 3),
      color: "bg-primary-container text-on-primary-container",
    });
  }
  if (stats.confirmed_count > 0) {
    items.push({
      icon: "check_circle",
      label: t("stats.confirmedDrafts"),
      detail: t("stats.confirmedDraftsDesc", { n: stats.confirmed_count }),
      timeSaved: fmtHours(stats.confirmed_count * 1.5),
      color: "bg-secondary-container text-on-secondary-container",
    });
  }
  if (stats.draft_reply_count > 0) {
    items.push({
      icon: "edit_note",
      label: t("stats.draftsGenerated"),
      detail: t("stats.draftsGeneratedDesc", { n: stats.draft_reply_count }),
      timeSaved: "—",
      color: "bg-tertiary-container text-tertiary",
    });
  }
  if (stats.low_confidence_count > 0) {
    items.push({
      icon: "help_outline",
      label: t("stats.lowConfidence"),
      detail: t("stats.lowConfidenceDesc", { n: stats.low_confidence_count }),
      timeSaved: "—",
      color: "bg-surface-container text-on-surface-variant",
    });
  }
  if (items.length === 0) {
    items.push({
      icon: "info",
      label: t("stats.noActivity"),
      detail: t("stats.noActivityDesc"),
      timeSaved: "—",
      color: "bg-surface-container text-on-surface-variant",
    });
  }
  return items;
}

/* ── skeleton pulse ──────────────────────────────────────────────── */

function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-primary/[0.06] ${className}`}
      style={style}
    />
  );
}

/* ── SVG circular gauge ──────────────────────────────────────────── */

function CircularGauge({ percent, coverageLabel }: { percent: number; coverageLabel: string }) {
  const r = 70;
  const cx = 90;
  const cy = 90;
  const circumference = 2 * Math.PI * r;
  const arc = (percent / 100) * circumference;

  return (
    <svg viewBox="0 0 180 180" className="w-40 h-40 mx-auto">
      {/* track */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        strokeWidth={12}
        className="stroke-primary/[0.08]"
        strokeLinecap="round"
      />
      {/* progress */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        strokeWidth={12}
        className="stroke-primary transition-all duration-700 ease-out"
        strokeLinecap="round"
        strokeDasharray={`${arc} ${circumference - arc}`}
        strokeDashoffset={circumference * 0.25} // start at 12 o'clock
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      {/* center label */}
      <text
        x={cx}
        y={cy - 6}
        textAnchor="middle"
        className="fill-on-surface text-3xl font-extrabold"
        style={{ fontSize: 32 }}
      >
        {percent}%
      </text>
      <text
        x={cx}
        y={cy + 16}
        textAnchor="middle"
        className="fill-on-surface-variant text-xs"
        style={{ fontSize: 12 }}
      >
        {coverageLabel}
      </text>
    </svg>
  );
}

/* ── main page ───────────────────────────────────────────────────── */

export default function StatsPage() {
  const { t } = useI18n();
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");

  const loadData = async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const [s, tr] = await Promise.all([getStatsOverview(), getTrends(p)]);
      setStats(s);
      setTrends(tr);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("stats.failedLoadStats"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(period); }, [period]);

  /* ── header with period selector ──────────────────────────────── */
  const header = (
    <div className="mb-10 flex items-end justify-between">
      <div>
        <h2 className="text-3xl font-extrabold text-on-surface tracking-tight mb-2">
          {t("stats.title")}
        </h2>
        <p className="text-on-surface-variant text-lg">
          {t("stats.subtitle")}
        </p>
      </div>
      <div className="flex gap-1 bg-surface-container-low p-1 rounded-full">
        {(["day", "week", "month"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-5 py-2 rounded-full text-xs font-bold transition-colors ${
              period === p
                ? "bg-primary text-on-primary shadow-sm"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {t(`stats.period_${p}`)}
          </button>
        ))}
      </div>
    </div>
  );

  /* ── loading state ────────────────────────────────────────────── */
  if (loading) {
    return (
      <div>
        {header}
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-4">
            <div className="bg-white/70 backdrop-blur-xl rounded-xl shadow-[0_20px_40px_rgba(0,72,68,0.04)] p-8 h-full">
              <Skeleton className="h-4 w-24 mb-6" />
              <Skeleton className="h-12 w-32 mb-4" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          <div className="col-span-8">
            <div className="bg-white/70 backdrop-blur-xl rounded-xl shadow-[0_20px_40px_rgba(0,72,68,0.04)] p-8 h-full">
              <Skeleton className="h-4 w-48 mb-8" />
              <div className="flex items-end gap-3 h-40">
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    className="flex-1"
                    style={{ height: `${30 + Math.random() * 70}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="col-span-4">
            <div className="bg-white/70 backdrop-blur-xl rounded-xl shadow-[0_20px_40px_rgba(0,72,68,0.04)] p-8 h-full flex flex-col items-center justify-center">
              <Skeleton className="h-40 w-40 rounded-full" />
            </div>
          </div>
          <div className="col-span-8">
            <div className="bg-white/70 backdrop-blur-xl rounded-xl shadow-[0_20px_40px_rgba(0,72,68,0.04)] p-8 h-full">
              <Skeleton className="h-4 w-36 mb-6" />
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full mb-3" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── error state ──────────────────────────────────────────────── */
  if (error || !stats) {
    return (
      <div>
        {header}
        <div className="bg-white/70 backdrop-blur-xl rounded-xl shadow-[0_20px_40px_rgba(0,72,68,0.04)] p-12 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant/50 mb-4 block">
            cloud_off
          </span>
          <p className="text-on-surface font-bold text-lg mb-1">
            {t("stats.unableToLoad")}
          </p>
          <p className="text-on-surface-variant text-sm mb-6">
            {error || t("stats.unexpectedError")}
          </p>
          <button
            onClick={() => loadData(period)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary-dim transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">
              refresh
            </span>
            {t("stats.retry")}
          </button>
        </div>
      </div>
    );
  }

  /* ── derived data ─────────────────────────────────────────────── */
  const timeSaved = estimateTimeSavedMinutes(stats);
  const coverage = coveragePercent(stats);
  const activityLog = buildActivityLog(stats, t);

  // bar chart data — use trends data directly (already time-aware)
  const barData = trends?.data || [];
  const maxBar = Math.max(...barData.map((d) => d.interactions), 1);
  const summary = trends?.summary;

  // Comparison helper
  const changeBadge = (pct: number | null | undefined) => {
    if (pct === null || pct === undefined) return null;
    const isUp = pct > 0;
    const color = isUp ? "text-emerald-600 bg-emerald-50" : pct < 0 ? "text-red-500 bg-red-50" : "text-on-surface-variant bg-surface-container";
    const icon = isUp ? "trending_up" : pct < 0 ? "trending_down" : "trending_flat";
    return (
      <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-lg font-semibold text-xs ${color}`}>
        <span className="material-symbols-outlined text-[14px]">{icon}</span>
        {pct > 0 ? "+" : ""}{pct}%
      </span>
    );
  };

  /* ── render ───────────────────────────────────────────────────── */
  return (
    <div>
      {header}

      <div className="grid grid-cols-12 gap-6">
        {/* ─── Time Recovery ─────────────────────────────────────── */}
        <div className="col-span-12 md:col-span-4">
          <div className="bg-white/70 backdrop-blur-xl rounded-xl shadow-[0_20px_40px_rgba(0,72,68,0.04)] p-8 h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-6">
                <span className="material-symbols-outlined text-primary text-xl">
                  schedule
                </span>
                <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                  {t("stats.timeRecovery")}
                </span>
              </div>
              <p className="text-5xl font-extrabold text-on-surface tracking-tight leading-none mb-2">
                {fmtHours(timeSaved)}
              </p>
              <p className="text-on-surface-variant text-sm">
                {t("stats.savedThisPeriod")}
              </p>
            </div>

            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-on-surface-variant">{t("stats.adoptionRate")}</span>
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-lg bg-primary-container text-on-primary-container font-semibold text-xs">
                  {stats.adoption_rate}%
                </span>
              </div>
              {summary && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-on-surface-variant">{t("stats.periodQueries")}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-on-surface">{summary.current_total}</span>
                      {changeBadge(summary.total_change_pct)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-on-surface-variant">{t("stats.periodAdopted")}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-on-surface">{summary.current_confirmed}</span>
                      {changeBadge(summary.confirmed_change_pct)}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ─── Interaction Volume ───────────────────────────────── */}
        <div className="col-span-12 md:col-span-8">
          <div className="bg-white/70 backdrop-blur-xl rounded-xl shadow-[0_20px_40px_rgba(0,72,68,0.04)] p-8 h-full flex flex-col">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-xl">
                  bar_chart
                </span>
                <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                  {t("stats.volumeTitle")}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-on-surface-variant">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-primary" />
                  {t("stats.interactions")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-primary/30" />
                  {t("stats.confirmed")}
                </span>
              </div>
            </div>

            <div className="flex-1 flex items-end gap-1 min-h-[160px] overflow-x-auto">
              {barData.map((d, i) => {
                const interH = (d.interactions / maxBar) * 100;
                const confH = (d.confirmed / maxBar) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group min-w-[20px]">
                    <span className="text-[11px] font-semibold text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">
                      {d.interactions}
                    </span>
                    <div className="w-full flex flex-col items-center gap-[2px]" style={{ height: 140 }}>
                      <div className="w-full flex-1 flex flex-col justify-end gap-[2px]">
                        <div
                          className="w-full rounded-t-md bg-primary/25 transition-all duration-500 ease-out group-hover:bg-primary/40"
                          style={{ height: `${confH}%`, minHeight: d.confirmed > 0 ? 4 : 0 }}
                        />
                        <div
                          className="w-full rounded-t-md bg-primary transition-all duration-500 ease-out group-hover:bg-primary-dim"
                          style={{ height: `${interH}%`, minHeight: d.interactions > 0 ? 4 : 0 }}
                        />
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold text-on-surface-variant mt-1 truncate w-full text-center">
                      {period === "day" ? d.label.slice(0, 5) : d.label.split(" ")[0]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ─── Resolution Rate & Adoption Gauge ────────────────── */}
        <div className="col-span-12 md:col-span-4">
          <div className="bg-white/70 backdrop-blur-xl rounded-xl shadow-[0_20px_40px_rgba(0,72,68,0.04)] p-8 h-full flex flex-col items-center justify-center">
            <div className="flex items-center gap-2 mb-6 self-start">
              <span className="material-symbols-outlined text-primary text-xl">
                donut_large
              </span>
              <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                {t("stats.adoptionOverview")}
              </span>
            </div>

            <CircularGauge percent={stats.adoption_rate} coverageLabel={t("stats.adoptionRate")} />

            <div className="mt-6 grid grid-cols-3 gap-x-4 gap-y-2 text-center w-full">
              <div>
                <p className="text-xl font-extrabold text-on-surface">
                  {stats.adopted_count}
                </p>
                <p className="text-[11px] text-on-surface-variant">
                  {t("stats.adopted")}
                </p>
              </div>
              <div>
                <p className="text-xl font-extrabold text-on-surface">
                  {stats.total_knowledge_entries}
                </p>
                <p className="text-[11px] text-on-surface-variant">
                  {t("stats.entries")}
                </p>
              </div>
              <div>
                <p className="text-xl font-extrabold text-on-surface">
                  {stats.total_interactions}
                </p>
                <p className="text-[11px] text-on-surface-variant">
                  {t("stats.queries")}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Recent Activity Log ──────────────────────────────── */}
        <div className="col-span-12 md:col-span-8">
          <div className="bg-white/70 backdrop-blur-xl rounded-xl shadow-[0_20px_40px_rgba(0,72,68,0.04)] p-8 h-full flex flex-col">
            <div className="flex items-center gap-2 mb-6">
              <span className="material-symbols-outlined text-primary text-xl">
                history
              </span>
              <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                {t("stats.recentActivityLog")}
              </span>
            </div>

            <div className="flex-1 flex flex-col gap-3">
              {activityLog.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 rounded-xl bg-surface-container-lowest p-4 hover:bg-surface-container-low transition-colors"
                >
                  <div
                    className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${item.color}`}
                  >
                    <span className="material-symbols-outlined text-xl">
                      {item.icon}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-on-surface truncate">
                      {item.label}
                    </p>
                    <p className="text-xs text-on-surface-variant truncate">
                      {item.detail}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-sm font-extrabold text-primary tabular-nums">
                      {item.timeSaved}
                    </p>
                    <p className="text-[11px] text-on-surface-variant">
                      {t("stats.saved")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
