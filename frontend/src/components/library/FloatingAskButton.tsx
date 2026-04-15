"use client";

import Link from "next/link";

export function FloatingAskButton() {
  return (
    <div
      style={{ position: "fixed", bottom: 40, right: 40, zIndex: 99999 }}
    >
      <Link
        href="/ask"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          paddingLeft: 16,
          paddingRight: 24,
          paddingTop: 16,
          paddingBottom: 16,
          backgroundColor: "#006662",
          color: "#fff",
          borderRadius: 9999,
          boxShadow: "0 20px 40px rgba(0,103,98,0.3)",
          textDecoration: "none",
          transition: "transform 0.15s",
        }}
        className="hover:scale-105 active:scale-95"
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 9999,
            backgroundColor: "rgba(255,255,255,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 22, color: "#fff" }}>
            auto_awesome
          </span>
        </div>
        <span style={{ fontWeight: 700, letterSpacing: "-0.01em" }}>Ask Once</span>
      </Link>
    </div>
  );
}
