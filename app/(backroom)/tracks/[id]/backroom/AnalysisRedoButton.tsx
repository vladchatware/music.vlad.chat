"use client";

import { useConvexAuth } from "convex/react";
import { useState } from "react";
import styles from "../../../backroom.module.css";

export function AnalysisRedoButton({ trackId }: { trackId: string }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [enqueuing, setEnqueuing] = useState(false);
  const [enqueued, setEnqueued] = useState(false);

  if (isLoading || !isAuthenticated) return null;
  if (enqueued) return <span className={styles.pending}>re-queued</span>;

  return (
    <button
      className={styles.authButton}
      type="button"
      disabled={enqueuing}
      onClick={async () => {
        setEnqueuing(true);
        try {
          const res = await fetch(`/api/tracks/${trackId}?force=true`);
          if (res.ok) setEnqueued(true);
        } finally {
          setEnqueuing(false);
        }
      }}
      style={{ marginTop: 0, padding: "5px 10px", fontSize: 9, fontFamily: "Courier New,monospace", textTransform: "uppercase", letterSpacing: ".08em", background: "transparent", border: "1px solid var(--line)", color: "var(--muted)" }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--acid)"; e.currentTarget.style.color = "var(--ink)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; e.currentTarget.style.color = "var(--muted)"; }}
    >
      {enqueuing ? "queuing…" : "Redo analysis"}
    </button>
  );
}
