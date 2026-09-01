import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./focus.css";
import "./brand.css";
import { ThemeProvider } from "@/lib/theme";
import { Analytics } from "@vercel/analytics/next";

const title = "Family Tree";
const description =
  "A free local-first family tree. One name is enough. Stays on this device. No account.";

export const metadata: Metadata = {
  metadataBase: new URL("https://familytree-rose.vercel.app"),
  title,
  description,
  applicationName: "Family Tree",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Family Tree",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title,
    description,
    siteName: "Family Tree",
    type: "website",
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "Family Tree" }],
  },
  twitter: {
    card: "summary",
    title,
    description,
    images: ["/icon-512.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#f4eadc",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
