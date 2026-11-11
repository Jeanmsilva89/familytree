import type { Metadata } from "next";
import { SampleStage } from "@/components/samples/SampleStage";

export const metadata: Metadata = { title: "Depth sky · Family Tree" };

export default function DepthSamplePage() {
  return <SampleStage kind="depth" />;
}
