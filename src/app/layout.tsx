import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./focus.css";
import { ThemeProvider } from "@/lib/theme";

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
    icon: [
      { url: "/favicon.png", type: "image/png", sizes: "32x32" },
      { url: "/icon.png", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f4eadc",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
