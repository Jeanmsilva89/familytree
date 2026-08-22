import Link from "next/link";

export default function PrintablesIndex() {
  return (
    <div className="app-shell printables">
      <p>
        <Link href="/">← Back to Family Tree</Link>
      </p>
      <h1>Kid printables</h1>
      <p className="lede">Print-friendly pages you can save as PDF. Names come from the tree on this device.</p>
      <div className="canvas">
        <Link className="unit" href="/printables/cards">
          <p className="unit-label">Cards</p>
          <strong>Relationship cards</strong>
          <p className="hint">One card per person to cut out and mix.</p>
        </Link>
        <Link className="unit" href="/printables/match">
          <p className="unit-label">Worksheet</p>
          <strong>Match the lines</strong>
          <p className="hint">Draw a line from each name to how they fit.</p>
        </Link>
        <Link className="unit" href="/printables/puzzle">
          <p className="unit-label">Puzzle</p>
          <strong>Who belongs together?</strong>
          <p className="hint">A simple four-piece cut-out of the couple and kids.</p>
        </Link>
      </div>
    </div>
  );
}
