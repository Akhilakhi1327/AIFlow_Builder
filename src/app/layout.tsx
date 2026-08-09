import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AIFlow Builder - AI Agent Workflow Platform",
  description: "Chain AI agent steps, execute workflows, and manage permissions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} min-h-full bg-slate-950 text-slate-100 flex flex-col`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
