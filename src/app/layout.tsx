import type { Metadata } from "next";
import "./globals.css";
import { devAuthEnabled } from "@/lib/auth/devSession";

export const metadata: Metadata = {
  title: "NoteForge",
  description:
    "Controlled intake, verification and insight between therapists and clinical note production.",
  // This application is not for search engines. Ever.
  robots: { index: false, follow: false, nocache: true },
  icons: { icon: "/brand/noteforge-logo.jpg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {/*
          Impossible to miss, and impossible to reach in production — the
          function it asks always returns false there. Its whole job is that
          nobody ever looks at a screen reached through the development door and
          believes they are looking at the real thing.
        */}
        {devAuthEnabled() ? (
          <div className="bg-rose-700 px-4 py-1 text-center text-xs font-semibold text-white">
            DEV_AUTH is on — signed in without Supabase. Not a real session.
          </div>
        ) : null}
        {children}
      </body>
    </html>
  );
}