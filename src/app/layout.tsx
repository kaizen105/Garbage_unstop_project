import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

import { ReportsProvider } from "@/lib/store/reports";

export const metadata: Metadata = {
  title: "SafaiKavach - AI Municipal Dispatch & Audit Engine",
  description: "AI Municipal Dispatch Engine",
};

export const viewport = {
  themeColor: "#0f172a"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ReportsProvider>
          {children}
        </ReportsProvider>
        <footer className="bg-slate-950 text-slate-500 text-xs text-center py-2 border-t border-slate-900 shrink-0">
          Demo data (synthetic)
        </footer>
      </body>
    </html>
  );
}
