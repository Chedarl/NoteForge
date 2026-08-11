import type { Metadata } from "next";
import "./globals.css";

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
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}