import Link from "next/link";
import { notFound } from "next/navigation";

import { readBenchRun } from "@/lib/server/djBenchRuns";

import styles from "../bench.module.css";
import BenchInspector from "./BenchInspector";

export const dynamic = "force-dynamic";

export default async function BenchRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const run = readBenchRun(runId);
  if (!run) notFound();

  return <main className={styles.shell}>
    <div className={styles.noise} />
    <nav className={styles.topbar}><Link href="/bench">REVIBE <b>BENCH</b></Link><span>{runId}</span><span>{run.summary.provider} / {run.summary.model} · {run.summary.promptPolicyVersion ?? "legacy/unversioned"}</span></nav>
    {run.manifest
      ? <BenchInspector manifest={run.manifest} summary={run.summary} />
      : <section className={styles.legacyPanel}><b>LEGACY RUN — NO REPLAY MANIFEST</b>This run predates set/source timeline mapping. Model transcript remains in report, but timestamp audio replay would be invented. Run bench again to create inspectable evidence.</section>}
  </main>;
}
