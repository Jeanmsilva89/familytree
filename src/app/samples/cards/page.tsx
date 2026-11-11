import type { Metadata } from "next";
import { SampleStage } from "@/components/samples/SampleStage";

export const metadata: Metadata = { title: "Floating cards · Family Tree" };

export default function CardsSamplePage() {
  return <SampleStage kind="cards" />;
}
