import type { Metadata } from "next";
import Link from "next/link";

import { listDJChatSessions } from "@/lib/server/djChatSessionReplay";

import styles from "./bench.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "DJ Bench / Revibe" };

export default async function BenchPage() {
  const sessions = await listDJChatSessions().catch((error) => {
    console.error("Failed to list AI chat sessions", error);
    return [];
  });

  return <main className={styles.shell}>
    <div className={styles.noise} />
    <nav className={styles.topbar}><Link href="/backroom">REVIBE <b>BENCH</b></Link><span>SET EVIDENCE ARCHIVE</span><span>{sessions.length} RUNS</span></nav>
    <header className={styles.hero}>
      <h1>Hear the<br />decision.</h1>
      <p><b>MODEL PERFORMANCE / SET-TIME EVIDENCE</b>Open any run. Jump through virtual set, audition real track streams, inspect exact model text, provider-returned reasoning, tools, failures, and transition plans at same timestamp.</p>
    </header>
    {sessions.length === 0 ? <div className={styles.empty}>No completed AI chat sessions yet.</div> : <section className={styles.ledger} aria-label="Bench runs">
      <div className={styles.ledgerHeader}><span>Run</span><span>Model</span><span>Coverage</span><span>Transitions</span><span>Status</span><span>Evidence</span></div>
      {sessions.map((session) => <Link className={styles.run} href={`/bench/${session.sessionKey}`} key={session.sessionKey}>
        <span><strong>{new Date(session.updatedAt).toLocaleString()}</strong><small>{session.sessionKey}</small></span>
        <span><code>{session.model}</code><small>live AI chat</small></span>
        <span>{((session.updatedAt - session.createdAt) / 60_000).toFixed(1)} min</span>
        <span>{session.turnCount} captures</span>
        <span className={`${styles.status} ${styles.pass}`}>STORED</span>
        <span className={styles.pass}>SESSION</span>
      </Link>)}
    </section>}
  </main>;
}
