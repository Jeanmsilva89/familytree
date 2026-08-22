type Props = { onTry: () => void };

export function ExamplePreview({ onTry }: Props) {
  return (
    <aside className="example-art" aria-label="Example family, not loaded">
      <header>
        <strong>Example</strong>
        <span className="badge">NOT YOUR TREE</span>
      </header>
      <div className="mini-tree">
        <div className="couple" aria-hidden="true">
          <span>Alex</span>
          <span>+</span>
          <span>Jordan</span>
        </div>
        <div className="kids" aria-hidden="true">
          <span className="chip">Sam</span>
          <span className="chip">Riley</span>
        </div>
      </div>
      <p className="hint">A tiny fictional couple with two kids. Your names stay empty until you type one.</p>
      <button type="button" className="btn ghost" onClick={onTry}>
        Try example
      </button>
    </aside>
  );
}
