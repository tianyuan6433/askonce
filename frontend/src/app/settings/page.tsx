"use client";

import { useCallback, useEffect, useState } from "react";
import { type AppSettings, getSettings, updateSettings } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type ToggleField = "dark_mode" | "smart_notifications" | "ai_summaries";

export default function SettingsPage() {
  const { t } = useI18n();

  const TOGGLES: { field: ToggleField; label: string; description: string }[] = [
    {
      field: "smart_notifications",
      label: t("settings.smartNotifications"),
      description: t("settings.smartNotificationsDesc"),
    },
    {
      field: "ai_summaries",
      label: t("settings.aiSummaries"),
      description: t("settings.aiSummariesDesc"),
    },
  ];

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<Partial<AppSettings>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingAI, setSavingAI] = useState(false);
  const [savingData, setSavingData] = useState(false);
  const [savedAI, setSavedAI] = useState(false);
  const [savedData, setSavedData] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s);
        setDraft(s);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("settings.failedLoadSettings")))
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = useCallback(
    async (field: ToggleField) => {
      if (!settings) return;
      const next = !settings[field];
      setSettings({ ...settings, [field]: next });
      try {
        const updated = await updateSettings({ [field]: next });
        setSettings(updated);
        setDraft((d) => ({ ...d, [field]: updated[field] }));
      } catch {
        setSettings((prev) => (prev ? { ...prev, [field]: !next } : prev));
        setError(t("settings.failedSave"));
      }
    },
    [settings],
  );

  const saveAIConfig = useCallback(async () => {
    setSavingAI(true);
    setError(null);
    try {
      const updated = await updateSettings({
        claude_model: draft.claude_model,
        claude_api_base: draft.claude_api_base,
        confidence_auto_reply: draft.confidence_auto_reply,
        confidence_draft_min: draft.confidence_draft_min,
        max_clarification_rounds: draft.max_clarification_rounds,
      });
      setSettings(updated);
      setDraft((d) => ({ ...d, ...updated }));
      setSavedAI(true);
      setTimeout(() => setSavedAI(false), 2000);
    } catch {
      setError(t("settings.failedSave"));
    } finally {
      setSavingAI(false);
    }
  }, [draft]);

  const saveDataConfig = useCallback(async () => {
    setSavingData(true);
    setError(null);
    try {
      const updated = await updateSettings({
        knowledge_stale_days: draft.knowledge_stale_days,
        max_upload_size_mb: draft.max_upload_size_mb,
      });
      setSettings(updated);
      setDraft((d) => ({ ...d, ...updated }));
      setSavedData(true);
      setTimeout(() => setSavedData(false), 2000);
    } catch {
      setError(t("settings.failedSave"));
    } finally {
      setSavingData(false);
    }
  }, [draft]);

  /* ------------------------------------------------------------------ */
  /*  Loading / Error states                                             */
  /* ------------------------------------------------------------------ */

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          <p className="text-on-surface-variant text-sm font-medium">{t("settings.loadingSettings")}</p>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-error-container/10 border border-error/20 rounded-xl p-8 text-center max-w-md">
          <span className="material-symbols-outlined text-error text-4xl mb-3 block">error</span>
          <p className="text-error text-sm font-medium">{error ?? t("settings.unableToLoad")}</p>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  const storageUsedMb = settings.storage_used_mb ?? 0;
  const storageLimitGb = settings.storage_limit_gb ?? 100;
  const storagePercent = storageLimitGb > 0
    ? Math.min(100, Math.round((storageUsedMb / (storageLimitGb * 1024)) * 100))
    : 0;

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <div>
      {/* Page header */}
      <div className="mb-12">
        <h2 className="text-3xl font-extrabold text-on-surface tracking-tight mb-2">
          {t("settings.title")}
        </h2>
        <p className="text-on-surface-variant text-lg">
          {t("settings.subtitle")}
        </p>
      </div>

      {/* Global error banner */}
      {error && (
        <div className="mb-6 bg-error-container/10 border border-error/20 rounded-xl px-5 py-3 flex items-center gap-3">
          <span className="material-symbols-outlined text-error text-xl">warning</span>
          <p className="text-error text-sm flex-1">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-error/60 hover:text-error transition-colors"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      )}

      {/* Bento grid */}
      <div className="grid grid-cols-12 gap-8 items-start">
        {/* ============================================================ */}
        {/*  LEFT COLUMN — 7/12                                          */}
        {/* ============================================================ */}
        <div className="col-span-7 space-y-8">
          {/* ── AI Configuration ── */}
          <section className="bg-white/70 backdrop-blur-xl border border-primary/5 rounded-2xl shadow-[0_20px_40px_rgba(0,72,68,0.04)] p-8">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 rounded-xl bg-primary-container flex items-center justify-center">
                <span className="material-symbols-outlined text-on-primary-container text-2xl">
                  smart_toy
                </span>
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-on-surface">{t("settings.aiConfig")}</h3>
                <p className="text-on-surface-variant text-sm">
                  {t("settings.aiConfigDesc")}
                </p>
              </div>
            </div>

            <div className="space-y-6">
              {/* Claude Model */}
              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">
                  {t("settings.claudeModel")}
                </label>
                <input
                  type="text"
                  value={draft.claude_model ?? ""}
                  onChange={(e) => setDraft({ ...draft, claude_model: e.target.value })}
                  placeholder="claude-sonnet-4-20250514"
                  className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-shadow"
                />
              </div>

              {/* API Base URL */}
              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">
                  {t("settings.apiBaseUrl")}
                </label>
                <input
                  type="text"
                  value={draft.claude_api_base ?? ""}
                  onChange={(e) => setDraft({ ...draft, claude_api_base: e.target.value })}
                  placeholder="https://api.anthropic.com"
                  className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-shadow"
                />
              </div>

              {/* Auto-Reply Threshold */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                    {t("settings.autoReplyThreshold")}
                  </label>
                  <span className="text-sm font-extrabold text-primary tabular-nums">
                    {(draft.confidence_auto_reply ?? 0).toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={draft.confidence_auto_reply ?? 0}
                  onChange={(e) =>
                    setDraft({ ...draft, confidence_auto_reply: parseFloat(e.target.value) })
                  }
                  className="w-full h-2 rounded-full appearance-none cursor-pointer bg-surface-container-high accent-primary"
                />
                <div className="flex justify-between text-[10px] text-on-surface-variant/60 mt-1">
                  <span>0.00</span>
                  <span>1.00</span>
                </div>
              </div>

              {/* Draft Threshold */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                    {t("settings.draftThreshold")}
                  </label>
                  <span className="text-sm font-extrabold text-primary tabular-nums">
                    {(draft.confidence_draft_min ?? 0).toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={draft.confidence_draft_min ?? 0}
                  onChange={(e) =>
                    setDraft({ ...draft, confidence_draft_min: parseFloat(e.target.value) })
                  }
                  className="w-full h-2 rounded-full appearance-none cursor-pointer bg-surface-container-high accent-primary"
                />
                <div className="flex justify-between text-[10px] text-on-surface-variant/60 mt-1">
                  <span>0.00</span>
                  <span>1.00</span>
                </div>
              </div>

              {/* Max Clarification Rounds */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                    Max Clarification Rounds
                  </label>
                  <span className="text-sm font-extrabold text-primary tabular-nums">
                    {draft.max_clarification_rounds ?? 3}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={draft.max_clarification_rounds ?? 3}
                  onChange={(e) =>
                    setDraft({ ...draft, max_clarification_rounds: parseInt(e.target.value) })
                  }
                  className="w-full h-2 rounded-full appearance-none cursor-pointer bg-surface-container-high accent-primary"
                />
                <div className="flex justify-between text-[10px] text-on-surface-variant/60 mt-1">
                  <span>1</span>
                  <span>10</span>
                </div>
                <p className="text-[10px] text-on-surface-variant/50 mt-1">
                  Maximum number of clarification rounds before forcing a direct answer
                </p>
              </div>
            </div>

            {/* Save AI Config */}
            <div className="mt-8 flex items-center gap-4">
              <button
                onClick={saveAIConfig}
                disabled={savingAI}
                className="bg-gradient-to-br from-primary to-primary-dim text-on-primary rounded-full px-6 py-2.5 text-sm font-bold shadow-card hover:shadow-elevated transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {savingAI ? (
                  <>
                    <div className="w-4 h-4 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />
                    {t("settings.saving")}
                  </>
                ) : savedAI ? (
                  <>
                    <span className="material-symbols-outlined text-lg">check_circle</span>
                    {t("settings.saved")}
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-lg">save</span>
                    {t("settings.saveAiConfig")}
                  </>
                )}
              </button>
            </div>
          </section>

          {/* ── Data Management ── */}
          <section className="bg-white/70 backdrop-blur-xl border border-primary/5 rounded-2xl shadow-[0_20px_40px_rgba(0,72,68,0.04)] p-8">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 rounded-xl bg-secondary-container flex items-center justify-center">
                <span className="material-symbols-outlined text-secondary text-2xl">database</span>
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-on-surface">{t("settings.dataManagement")}</h3>
                <p className="text-on-surface-variant text-sm">
                  {t("settings.dataManagementDesc")}
                </p>
              </div>
            </div>

            <div className="space-y-6">
              {/* Knowledge Retention */}
              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">
                  {t("settings.staleDays")}
                </label>
                <div className="flex items-center gap-3 px-4 py-3 bg-surface-container-lowest rounded-xl border border-outline-variant/30">
                  <span className="material-symbols-outlined text-primary text-lg">all_inclusive</span>
                  <span className="text-sm font-semibold text-on-surface">{t("settings.neverExpires")}</span>
                </div>
              </div>

              {/* Max Upload Size */}
              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">
                  {t("settings.maxUploadSize")}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    value={draft.max_upload_size_mb ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        max_upload_size_mb: parseInt(e.target.value, 10) || 0,
                      })
                    }
                    className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-3 pr-14 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30 transition-shadow"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-on-surface-variant">
                    {t("settings.mb")}
                  </span>
                </div>
              </div>

              {/* Storage usage bar */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                    {t("settings.storageUsage")}
                  </span>
                  <span className="text-xs font-bold text-on-surface-variant">
                    {storageUsedMb < 1024
                      ? t("settings.storageUsedMb", { used: storageUsedMb, total: storageLimitGb })
                      : t("settings.storageUsedGb", { used: (storageUsedMb / 1024).toFixed(1), total: storageLimitGb })}
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-surface-container-high overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-tertiary transition-all duration-500"
                    style={{ width: `${storagePercent}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Save Data Config */}
            <div className="mt-8 flex items-center gap-4">
              <button
                onClick={saveDataConfig}
                disabled={savingData}
                className="bg-gradient-to-br from-primary to-primary-dim text-on-primary rounded-full px-6 py-2.5 text-sm font-bold shadow-card hover:shadow-elevated transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {savingData ? (
                  <>
                    <div className="w-4 h-4 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" />
                    {t("settings.saving")}
                  </>
                ) : savedData ? (
                  <>
                    <span className="material-symbols-outlined text-lg">check_circle</span>
                    {t("settings.saved")}
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-lg">save</span>
                    {t("settings.saveDataSettings")}
                  </>
                )}
              </button>
            </div>
          </section>
        </div>

        {/* ============================================================ */}
        {/*  RIGHT COLUMN — 5/12                                         */}
        {/* ============================================================ */}
        <div className="col-span-5 space-y-8">
          {/* ── Preferences ── */}
          <section className="bg-white/70 backdrop-blur-xl border border-primary/5 rounded-2xl shadow-[0_20px_40px_rgba(0,72,68,0.04)] p-8">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 rounded-xl bg-tertiary-container flex items-center justify-center">
                <span className="material-symbols-outlined text-tertiary text-2xl">tune</span>
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-on-surface">{t("settings.preferences")}</h3>
                <p className="text-on-surface-variant text-sm">{t("settings.preferencesDesc")}</p>
              </div>
            </div>

            <div className="space-y-5">
              {TOGGLES.map(({ field, label, description }) => (
                <label
                  key={field}
                  className="flex items-center justify-between gap-4 p-4 rounded-xl bg-surface-container-lowest border border-primary/5 cursor-pointer hover:border-primary/10 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-on-surface">{label}</p>
                    <p className="text-xs text-on-surface-variant mt-0.5">{description}</p>
                  </div>

                  {/* Toggle switch */}
                  <div className="relative shrink-0">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={settings[field]}
                      onChange={() => handleToggle(field)}
                    />
                    <div className="w-11 h-6 rounded-full bg-surface-container-high peer-checked:bg-primary transition-colors" />
                    <div className="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform peer-checked:translate-x-5" />
                  </div>
                </label>
              ))}
            </div>

            {/* Storage usage bar (secondary placement) */}
            <div className="mt-8 p-4 rounded-xl bg-surface-container-lowest border border-primary/5">
              <div className="flex items-center gap-3 mb-3">
                <span className="material-symbols-outlined text-on-surface-variant text-lg">
                  cloud
                </span>
                <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                  {t("settings.storage")}
                </span>
              </div>
              <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-tertiary transition-all duration-500"
                  style={{ width: `${storagePercent}%` }}
                />
              </div>
              <p className="text-[11px] text-on-surface-variant mt-2">
                {storageUsedMb < 1024
                  ? t("settings.storageUsedMb", { used: storageUsedMb, total: storageLimitGb })
                  : t("settings.storageUsedGb", { used: (storageUsedMb / 1024).toFixed(1), total: storageLimitGb })}
              </p>
            </div>
          </section>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  FOOTER                                                       */}
      {/* ============================================================ */}
      <div className="mt-12 pt-8 border-t border-outline-variant/20">
        <div className="flex items-center justify-between">
          <button className="flex items-center gap-2 text-sm font-bold text-error hover:text-error/80 transition-colors">
            <span className="material-symbols-outlined text-lg">logout</span>
            {t("settings.signOut")}
          </button>
          <p className="text-xs text-on-surface-variant/60">{t("settings.version")}</p>
        </div>
      </div>
    </div>
  );
}
