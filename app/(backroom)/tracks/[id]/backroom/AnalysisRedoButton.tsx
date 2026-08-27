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
      className={styles.redoButton}
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
    >
      {enqueuing ? "queuing…" : "Redo analysis"}
    </button>
  );
}
