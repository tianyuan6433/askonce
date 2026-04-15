import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { I18nProvider } from "@/lib/i18n";
import { FloatingAskOnce } from "@/components/layout/FloatingAskOnce";
import "./globals.css";

export const metadata: Metadata = {
  title: "AskOnce — Digital Sanctuary",
  description: "AI-powered smart reply system with living knowledge base",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // lang defaults to "en"; I18nProvider updates document.documentElement.lang on the client
  return (
    <html lang="en" className="light">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <I18nProvider>
          <AppShell>{children}</AppShell>
          <FloatingAskOnce />
        </I18nProvider>
      </body>
    </html>
  );
}
