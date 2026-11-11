import type { Metadata } from "next";
import "./samples.css";

export const metadata: Metadata = {
  title: "Samples · Family Tree",
  robots: { index: false, follow: false },
};

export default function SamplesLayout({ children }: { children: React.ReactNode }) {
  return <div className="samples-root">{children}</div>;
}
