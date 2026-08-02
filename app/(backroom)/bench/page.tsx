import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { api } from "@/convex/_generated/api";
import { listBenchRuns } from "@/lib/server/djBenchRuns";

import styles from "./bench.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "DJ Bench / Revibe" };

function duration(summary: { achievedDurationSec?: number; simulatedTimeSec: number }) {
  return ((summary.achievedDurationSec ?? summary.simulatedTimeSec) / 60).toFixed(1);
}

export default async function BenchPage() {
  const token = await convexAuthNextjsToken();
  const user = token ? await fetchQuery(api.users.viewer, {}, { token }).catch(() => null) : null;
  const developmentAccess = process.env.NODE_ENV === "development";
  if ((!user || user.isAnonymous) && !developmentAccess) redirect("/dashboard?returnTo=/bench");
  const runs = listBenchRuns();

  return <main className={styles.shell}>
    <div className={styles.noise} />
    <nav className={styles.topbar}><Link href="/backroom">REVIBE <b>BENCH</b></Link><span>SET EVIDENCE ARCHIVE</span><span>{runs.length} RUNS</span></nav>
    <header className={styles.hero}>
      <h1>Hear the<br />decision.</h1>
      <p><b>MODEL PERFORMANCE / SET-TIME EVIDENCE</b>Open any run. Jump through virtual set, audition real track streams, inspect exact model text, provider-returned reasoning, tools, failures, and transition plans at same timestamp.</p>
    </header>
    {runs.length === 0 ? <div className={styles.empty}>No bench runs yet. Run <code>bun run bench:dj</code>, then reload.</div> : <section className={styles.ledger} aria-label="Bench runs">
      <div className={styles.ledgerHeader}><span>Run</span><span>Model</span><span>Coverage</span><span>Transitions</span><span>Status</span><span>Evidence</span></div>
      {runs.map(({ runId, summary, hasTimeline }) => <Link className={styles.run} href={`/bench/${runId}`} key={runId}>
        <span><strong>{new Date(summary.startedAt).toLocaleString()}</strong><small>{runId}</small></span>
        <span><code>{summary.model}</code><small>{summary.promptPolicyVersion ?? "legacy/unversioned"}</small></span>
        <span>{duration(summary)} min</span>
        <span>{summary.acceptedTransitions} transitions</span>
        <span className={`${styles.status} ${summary.ok ? styles.pass : styles.fail}`}>{summary.ok ? "PASS" : "FAIL"}</span>
        <span className={hasTimeline ? styles.pass : styles.legacy}>{hasTimeline ? "TIMELINE" : "LEGACY"}</span>
      </Link>)}
    </section>}
  </main>;
}
