"use client";

import { useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import styles from "../../../backroom.module.css";

export function AnalysisEnqueue({
  trackId,
  scheduled,
}: {
  trackId: string;
  scheduled: boolean;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const [enqueuing, setEnqueuing] = useState(false);
  const [enqueued, setEnqueued] = useState(scheduled);

  if (isLoading) {
    return (
      <section className={styles.emptyState}>
        <b>ANALYSIS NOT READY</b>
        <p>Checking authentication…</p>
      </section>
    );
  }

  if (enqueued) {
    return (
      <section className={styles.emptyState}>
        <b>ANALYSIS NOT READY</b>
        <p>Analysis scheduled. Run worker, then refresh.</p>
      </section>
    );
  }

  if (!isAuthenticated) {
    return (
      <section className={styles.emptyState}>
        <b>ANALYSIS NOT READY</b>
        <p>Sign in with SoundCloud to analyze this track.</p>
        <button
          className={styles.authButton}
          type="button"
          onClick={() => signIn("soundcloud", { redirectTo: window.location.href })}
        >
          Continue with SoundCloud →
        </button>
      </section>
    );
  }

  return (
    <section className={styles.emptyState}>
      <b>ANALYSIS NOT READY</b>
      <p>{enqueuing ? "Scheduling analysis…" : "Analyze this track to see timing, structure, emotion, and DJ-safe entry points."}</p>
      {!enqueuing && (
        <button
          className={styles.authButton}
          type="button"
          disabled={enqueuing}
          onClick={async () => {
            setEnqueuing(true);
            try {
              const res = await fetch(`/api/tracks/${trackId}`);
              if (res.ok) setEnqueued(true);
            } finally {
              setEnqueuing(false);
            }
          }}
        >
          Analyze with SoundCloud →
        </button>
      )}
    </section>
  );
}
