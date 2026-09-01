import Link from "next/link";
import { notFound } from "next/navigation";

import { readDJChatBenchRun } from "@/lib/server/djChatSessionReplay";

import styles from "../bench.module.css";
import BenchInspector from "./BenchInspector";

export const dynamic = "force-dynamic";

export default async function BenchRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const run = await readDJChatBenchRun(runId).catch((error) => {
    console.error("Failed to load AI chat session replay", error);
    return null;
  });
  if (!run) notFound();

  const { manifest, summary } = run;
  return <main className={styles.shell}>
    <div className={styles.noise} />
    <nav className={styles.topbar}><Link href="/bench">REVIBE <b>BENCH</b></Link><span>{runId}</span><span>{manifest.provider} / {manifest.model} · {manifest.scenario}</span></nav>
    <BenchInspector manifest={manifest} summary={summary} />
  </main>;
}
