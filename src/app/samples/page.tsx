import Link from "next/link";

const directions = [
  {
    href: "/samples/depth",
    title: "Depth sky",
    line: "Households sit on glowing discs, and distant generations fall softly out of focus.",
  },
  {
    href: "/samples/cards",
    title: "Floating cards",
    line: "Families begin as stars, then ease open into cards as you pinch closer.",
  },
  {
    href: "/samples/orbit",
    title: "Orbit focus",
    line: "Press and hold someone to bring them center, with relatives on rings.",
  },
];

export default function SamplesIndexPage() {
  return (
    <main className="smp-index">
      <p className="smp-kicker">Fixture · not your tree</p>
      <h1>Three ways to look</h1>
      <ul>
        {directions.map((direction) => (
          <li key={direction.href}>
            <Link href={direction.href}>
              <strong>{direction.title}</strong>
              <span>{direction.line}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
