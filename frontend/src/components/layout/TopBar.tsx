"use client";

import { useI18n, LOCALES, LOCALE_LABELS } from "@/lib/i18n";

export function TopBar() {
  const { locale, setLocale, t } = useI18n();

  const toggleLocale = () => {
    const idx = LOCALES.indexOf(locale);
    setLocale(LOCALES[(idx + 1) % LOCALES.length]);
  };

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between w-full mb-8 rounded-full bg-white/70 dark:bg-emerald-950/40 backdrop-blur-xl px-6 py-2 shadow-glass focus-within:ring-2 focus-within:ring-emerald-500/20">
      <div className="flex items-center flex-1 max-w-xl">
        <span className="material-symbols-outlined text-on-surface-variant mr-3">search</span>
        <input
          type="text"
          placeholder={t("common.search") + "..."}
          className="bg-transparent border-none focus:ring-0 w-full text-sm font-headline"
        />
      </div>
      <div className="flex items-center gap-4">
        <button
          onClick={toggleLocale}
          title={t("common.language")}
          className="px-2 py-1 text-xs font-bold rounded border border-emerald-300/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100/50 dark:hover:bg-emerald-800/30 transition-colors"
        >
          {LOCALE_LABELS[locale]}
        </button>
        <button className="material-symbols-outlined text-on-surface-variant hover:opacity-80 transition-opacity">
          notifications
        </button>
        <button className="material-symbols-outlined text-on-surface-variant hover:opacity-80 transition-opacity">
          account_circle
        </button>
      </div>
    </header>
  );
}
