import type { Metadata } from "next";
import { BackendStatusProvider } from "@/components/BackendStatusProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "GDArena — Group Discussion Practice",
  description:
    "Structured, real-time Group Discussion practice platform with AI participants and live evaluation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-page text-ink antialiased">
        <BackendStatusProvider>{children}</BackendStatusProvider>
      </body>
    </html>
  );
}

