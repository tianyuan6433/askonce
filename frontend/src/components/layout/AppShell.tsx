"use client";

import { useState, useEffect } from "react";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";

const COLLAPSED_WIDTH = 72;
const EXPANDED_WIDTH = 256;
const STORAGE_KEY = "askonce-nav-collapsed";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [navWidth, setNavWidth] = useState(EXPANDED_WIDTH);

  useEffect(() => {
    const sync = () => {
      const collapsed = localStorage.getItem(STORAGE_KEY) === "true";
      setNavWidth(collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH);
    };
    sync();
    window.addEventListener("nav-collapse", sync);
    return () => window.removeEventListener("nav-collapse", sync);
  }, []);

  useEffect(() => {
    // Always force light mode
    document.documentElement.classList.add("light");
    document.documentElement.classList.remove("dark");
  }, []);

  return (
    <div className="min-h-screen bg-surface">
      <NavRail />
      <main
        style={{ marginLeft: navWidth }}
        className="min-h-screen p-8 transition-all duration-300"
      >
        <TopBar />
        {children}
      </main>
    </div>
  );
}
