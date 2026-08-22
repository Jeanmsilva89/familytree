import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Family Tree",
  description: "A free local-first family tree. One name is enough. Stays on this device. No account.",
  applicationName: "Family Tree",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Family Tree",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f4eadc",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
