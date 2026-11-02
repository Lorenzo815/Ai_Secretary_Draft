import type { Metadata } from "next";
import { Public_Sans, Sora } from "next/font/google";
import "./globals.css";

const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap" });
const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Oria Backoffice", template: "%s · Oria Backoffice" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${sora.variable} ${publicSans.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
