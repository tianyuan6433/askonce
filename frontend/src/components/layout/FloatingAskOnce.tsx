"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

export function FloatingAskOnce() {
  const pathname = usePathname();

  // Hide on the Ask page itself
  if (pathname === "/ask") return null;

  return (
    <div
      id="floating-askonce-btn"
      style={{
        position: "fixed",
        bottom: 40,
        right: 40,
        zIndex: 2147483647, // max int32 — above everything
      }}
    >
      <Link
        href="/ask"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 12,
          paddingLeft: 16,
          paddingRight: 24,
          paddingTop: 14,
          paddingBottom: 14,
          backgroundColor: "#006662",
          color: "#ffffff",
          borderRadius: 9999,
          boxShadow: "0 8px 32px rgba(0,102,98,0.4)",
          textDecoration: "none",
          fontFamily: "Plus Jakarta Sans, system-ui, sans-serif",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            width: 36,
            height: 36,
            borderRadius: 9999,
            backgroundColor: "rgba(255,255,255,0.2)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 20, color: "#ffffff" }}
          >
            auto_awesome
          </span>
        </span>
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em", color: "#ffffff" }}>
          Ask Once
        </span>
      </Link>
    </div>
  );
}
