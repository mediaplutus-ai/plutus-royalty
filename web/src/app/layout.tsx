import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plutus Media — Royalties",
  description: "See where every rupee of your royalties comes from, what Plutus keeps, and when you get paid.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
