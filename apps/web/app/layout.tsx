import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Seller Ecosystem",
  description: "Personal workspace for AI-powered sales, agents and automation."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}