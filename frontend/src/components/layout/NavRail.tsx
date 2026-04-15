"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useI18n, LOCALES, LOCALE_LABELS, LOCALE_NAMES } from "@/lib/i18n";

const COLLAPSED_WIDTH = 72;
const EXPANDED_WIDTH = 256;
const STORAGE_KEY = "askonce-nav-collapsed";

const navItems = [
  { href: "/ask", icon: "chat_bubble", labelKey: "nav.ask" },
  { href: "/library", icon: "folder_open", labelKey: "nav.library" },
  { href: "/stats", icon: "bar_chart", labelKey: "nav.stats" },
  { href: "/settings", icon: "settings", labelKey: "nav.settings" },
];

export function useNavWidth() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "true");
  }, []);
  return collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;
}

export function NavRail() {
  const pathname = usePathname();
  const { t, locale, setLocale } = useI18n();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(STORAGE_KEY, String(next));
    window.dispatchEvent(new Event("nav-collapse"));
  };

  const toggleLocale = () => {
    const idx = LOCALES.indexOf(locale);
    setLocale(LOCALES[(idx + 1) % LOCALES.length]);
  };

  const width = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  return (
    <nav
      style={{ width }}
      className="fixed left-0 top-0 h-full flex flex-col py-6 bg-emerald-50 dark:bg-emerald-950/20 border-r border-emerald-100/10 font-headline text-sm font-medium tracking-tight z-50 transition-all duration-300 overflow-hidden"
    >
      {/* Brand */}
      <div className={cn("mb-12", collapsed ? "px-0 flex justify-center" : "px-8")}>
        <Link href="/" className={cn(collapsed && "flex justify-center")}>
          {collapsed ? (
            <span className="text-xl font-bold text-emerald-900 dark:text-emerald-100 tracking-tighter">
              A
            </span>
          ) : (
            <>
              <h1 className="text-xl font-bold text-emerald-900 dark:text-emerald-100 tracking-tighter whitespace-nowrap">
                {t("nav.brand")}
              </h1>
              <p className="text-xs text-on-surface-variant opacity-60 whitespace-nowrap">
                {t("nav.subtitle")}
              </p>
            </>
          )}
        </Link>
      </div>

      {/* Nav items */}
      <div className="flex flex-col space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? t(item.labelKey) : undefined}
              className={cn(
                "flex items-center py-3 transition-all duration-300",
                collapsed ? "justify-center px-0 mx-1" : "gap-3 px-4 mx-0",
                isActive
                  ? "text-emerald-900 dark:text-white bg-white/50 dark:bg-emerald-900/40 rounded-3xl mx-2 shadow-sm border-l-4 border-emerald-600"
                  : "text-emerald-700/70 dark:text-emerald-400/60 hover:text-emerald-900 dark:hover:text-emerald-100 hover:bg-emerald-100/50 dark:hover:bg-emerald-800/30"
              )}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              {!collapsed && (
                <span className="whitespace-nowrap">{t(item.labelKey)}</span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div className="mt-auto flex flex-col gap-2 px-2">
        {/* Language toggle */}
        <button
          onClick={toggleLocale}
          title={t("common.language")}
          className={cn(
            "flex items-center py-2 rounded-lg transition-colors duration-200 text-emerald-700/70 dark:text-emerald-400/60 hover:bg-emerald-100/50 dark:hover:bg-emerald-800/30",
            collapsed ? "justify-center px-0" : "gap-3 px-3"
          )}
        >
          <span className="w-6 h-6 flex items-center justify-center text-xs font-bold rounded border border-current">
            {LOCALE_LABELS[locale]}
          </span>
          {!collapsed && (
            <span className="whitespace-nowrap text-xs">
              {LOCALE_NAMES[locale]}
            </span>
          )}
        </button>

        {/* Collapse toggle */}
        <button
          onClick={toggle}
          title={collapsed ? t("nav.expand") : t("nav.collapse")}
          className={cn(
            "flex items-center py-2 rounded-lg transition-colors duration-200 text-emerald-700/70 dark:text-emerald-400/60 hover:bg-emerald-100/50 dark:hover:bg-emerald-800/30",
            collapsed ? "justify-center px-0" : "gap-3 px-3"
          )}
        >
          <span className="material-symbols-outlined">
            {collapsed ? "menu" : "menu_open"}
          </span>
          {!collapsed && (
            <span className="whitespace-nowrap text-xs">
              {t("nav.collapse")}
            </span>
          )}
        </button>
      </div>
    </nav>
  );
}
