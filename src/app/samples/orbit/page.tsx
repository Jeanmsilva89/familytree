import type { Metadata } from "next";
import { SampleStage } from "@/components/samples/SampleStage";

export const metadata: Metadata = { title: "Orbit focus · Family Tree" };

export default function OrbitSamplePage() {
  return <SampleStage kind="orbit" />;
}
