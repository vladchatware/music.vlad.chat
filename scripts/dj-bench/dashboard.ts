import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { BenchSummary, CoherenceEvidence } from "./report";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function infrastructureFailure(run: BenchSummary): boolean {
  return !run.outgoingTrack && run.stateReads === 0 && run.acceptedTransitions === 0;
}

function invalidRun(run: BenchSummary): boolean {
  return run.validity === "invalid";
}

function failureClass(run: BenchSummary): string {
  if (invalidRun(run)) return "Invalid harness run";
  if (infrastructureFailure(run)) return "Infrastructure";
  if (run.continuity?.status === "fail") return "Continuity";
  if (run.falseSuccessClaims > 0) return "False success";
  if ((run.backstageNarrationCount ?? 0) > 0) return "Backstage narration";
  if (run.duplicateAcceptedTracks > 0) return "Duplicate";
  if (run.impossibleScheduleAttempts > 0) return "Invalid timing";
  return run.ok ? "Pass" : "Contract";
}

function allEvidence(runs: BenchSummary[]): CoherenceEvidence[] {
  return runs.flatMap((run) => run.coherenceEvidence ?? []);
}

function continuityChart(runs: BenchSummary[]): string {
  if (runs.length === 0) {
    return '<div class="empty">No performance episodes. Infrastructure failures excluded.</div>';
  }
  const maxTransitions = Math.max(...runs.map((run) => run.requestedTransitions));
  const values = Array.from({ length: maxTransitions }, (_, index) => {
    const transition = index + 1;
    return runs.filter((run) => run.acceptedTransitions >= transition).length / runs.length;
  });
  const width = 720;
  const height = 250;
  const left = 52;
  const top = 20;
  const plotWidth = width - left - 24;
  const plotHeight = height - top - 42;
  const x = (index: number) =>
    left + (maxTransitions <= 1 ? plotWidth / 2 : index / (maxTransitions - 1) * plotWidth);
  const y = (value: number) => top + (1 - value) * plotHeight;
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Continuity survival curve">
    ${[0, 0.25, 0.5, 0.75, 1].map((tick) => `
      <line x1="${left}" y1="${y(tick)}" x2="${width - 24}" y2="${y(tick)}" class="grid"/>
      <text x="${left - 10}" y="${y(tick) + 4}" text-anchor="end">${percent(tick)}</text>
    `).join("")}
    <polyline points="${points}" class="line"/>
    ${values.map((value, index) => `
      <circle cx="${x(index)}" cy="${y(value)}" r="5"/>
      <text x="${x(index)}" y="${height - 12}" text-anchor="middle">T${index + 1}</text>
      <text x="${x(index)}" y="${y(value) - 10}" text-anchor="middle" class="value">${percent(value)}</text>
    `).join("")}
  </svg>`;
}

function coherenceChart(evidence: CoherenceEvidence[]): string {
  const complete = evidence.filter((item) => item.analysisComplete);
  if (complete.length === 0) {
    return '<div class="empty">No accepted transition with paired analysis. Coherence unscorable.</div>';
  }
  const rows = complete.map((item, index) => {
    const tempo = item.tempo?.normalizedDeltaPercent;
    const energy = item.energy?.delta;
    const keyMatch = item.harmonic?.sameKey;
    const tempoWidth = tempo === undefined ? 0 : Math.min(100, tempo / 16 * 100);
    const energyPosition = energy === undefined
      ? 50
      : Math.max(0, Math.min(100, (energy + 0.5) * 100));
    return `<div class="coherence-row">
      <div class="transition-id">T${index + 1}<small>${item.fromTrackId} → ${item.toTrackId}</small></div>
      <div><span class="metric-label">Tempo Δ ${tempo?.toFixed(1) ?? "—"}%</span><div class="bar"><i style="width:${tempoWidth}%"></i></div></div>
      <div><span class="metric-label">Energy Δ ${energy === undefined ? "—" : `${energy >= 0 ? "+" : ""}${energy.toFixed(2)}`}</span><div class="energy-axis"><i style="left:${energyPosition}%"></i></div></div>
      <div class="key ${keyMatch ? "match" : "change"}">${item.harmonic ? `${escapeHtml(item.harmonic.outgoingKey)} → ${escapeHtml(item.harmonic.incomingKey)}` : "key —"}</div>
    </div>`;
  }).join("");
  return `<div class="coherence-legend">Tempo bar: 0–16% normalized change · Energy axis: −0.5 to +0.5 · Key badge: exact Camelot match only</div>${rows}`;
}

function failureChart(runs: BenchSummary[]): string {
  const counts = new Map<string, number>();
  for (const run of runs) {
    const name = failureClass(run);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const maximum = Math.max(1, ...counts.values());
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([name, count]) => `<div class="failure-row">
      <span>${escapeHtml(name)}</span>
      <div class="failure-bar"><i style="width:${count / maximum * 100}%"></i></div>
      <strong>${count}</strong>
    </div>`)
    .join("");
}

function modelTable(runs: BenchSummary[]): string {
  const groups = new Map<string, BenchSummary[]>();
  for (const run of runs) {
    const key = `${run.provider}/${run.model}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return [...groups.entries()].map(([model, attempts]) => {
    const evaluated = attempts.filter(
      (run) => !infrastructureFailure(run) && !invalidRun(run),
    );
    const transitions = evaluated.reduce((total, run) => total + run.acceptedTransitions, 0);
    const requested = evaluated.reduce((total, run) => total + run.requestedTransitions, 0);
    const evidence = allEvidence(evaluated);
    const complete = evidence.filter((item) => item.analysisComplete).length;
    return `<tr>
      <td>${escapeHtml(model)}</td>
      <td>${attempts.length}</td>
      <td>${evaluated.length}</td>
      <td>${evaluated.length ? percent(evaluated.filter((run) => run.ok).length / evaluated.length) : "—"}</td>
      <td>${requested ? percent(transitions / requested) : "—"}</td>
      <td>${evidence.length ? percent(complete / evidence.length) : "—"}</td>
      <td>${median(evaluated.map((run) => run.tokens.total))?.toFixed(0) ?? "—"}</td>
    </tr>`;
  }).join("");
}

function runTable(
  runs: BenchSummary[],
  root: string,
  reportUrl?: (run: BenchSummary) => string,
): string {
  return runs.map((run) => {
    const relativeReport = reportUrl
      ? reportUrl(run)
      : run.reportPath.startsWith(root)
        ? `.${run.reportPath.slice(root.length)}`
        : `file://${run.reportPath}`;
    return `<tr>
      <td><a href="${escapeHtml(relativeReport)}">${escapeHtml(run.runId)}</a></td>
      <td><span class="status ${run.ok ? "pass" : infrastructureFailure(run) || invalidRun(run) ? "infra" : "fail"}">${run.ok ? "PASS" : invalidRun(run) ? "INVALID" : infrastructureFailure(run) ? "INFRA" : "FAIL"}</span></td>
      <td>${escapeHtml(run.model)}</td>
      <td>${escapeHtml(run.scenario)}</td>
      <td>${run.acceptedTransitions}/${run.requestedTransitions}</td>
      <td>${(run.coherenceEvidence ?? []).filter((item) => item.analysisComplete).length}/${(run.coherenceEvidence ?? []).length}</td>
      <td>${run.tokens.total}</td>
      <td>${escapeHtml(failureClass(run))}</td>
    </tr>`;
  }).join("");
}

export function renderBenchmarkDashboard(
  root: string,
  runs: BenchSummary[],
  reportUrl?: (run: BenchSummary) => string,
): string {
  const evaluated = runs.filter(
    (run) => !infrastructureFailure(run) && !invalidRun(run),
  );
  const infrastructure = runs.filter((run) => infrastructureFailure(run)).length;
  const invalid = runs.filter((run) => invalidRun(run)).length;
  const accepted = evaluated.reduce((total, run) => total + run.acceptedTransitions, 0);
  const requested = evaluated.reduce((total, run) => total + run.requestedTransitions, 0);
  const evidence = allEvidence(evaluated);
  const completeEvidence = evidence.filter((item) => item.analysisComplete);
  const passRate = evaluated.length
    ? evaluated.filter((run) => run.ok).length / evaluated.length
    : null;
  const continuityRate = requested ? accepted / requested : null;
  const coherenceCoverage = evidence.length ? completeEvidence.length / evidence.length : null;
  const tempoMedian = median(completeEvidence.flatMap((item) =>
    item.tempo ? [item.tempo.normalizedDeltaPercent] : []));
  const energyMedian = median(completeEvidence.flatMap((item) =>
    item.energy ? [item.energy.delta] : []));

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DJ Agent Benchmark</title>
<style>
:root{color-scheme:dark;--bg:#0c1015;--panel:#141a22;--line:#263240;--text:#e8eef5;--muted:#8d9bad;--blue:#67b7ff;--green:#57d69a;--red:#ff6b7a;--amber:#e9c46a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}main{max-width:1440px;margin:auto;padding:32px}h1{font-size:28px;margin:0}h2{font-size:16px;margin:0 0 18px}.subtitle,.note{color:var(--muted)}.subtitle{margin:4px 0 28px}.cards{display:grid;grid-template-columns:repeat(6,minmax(140px,1fr));gap:12px}.card,.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px}.card{padding:16px}.card b{display:block;font-size:25px;margin-top:8px}.card span{color:var(--muted);font-size:11px;text-transform:uppercase}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}.panel{padding:20px;overflow:auto}.wide{margin-top:14px}svg{width:100%;min-height:250px}svg text{fill:var(--muted);font-size:11px}svg .grid{stroke:var(--line);stroke-width:1}svg .line{fill:none;stroke:var(--blue);stroke-width:3}svg circle{fill:var(--blue)}svg .value{fill:var(--text)}.empty{display:grid;place-items:center;min-height:230px;color:var(--muted);border:1px dashed var(--line)}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:11px;text-transform:uppercase}.failure-row{display:grid;grid-template-columns:130px 1fr 28px;gap:10px;align-items:center;margin:10px 0}.failure-bar,.bar{height:8px;background:#202a35;border-radius:8px;overflow:hidden}.failure-bar i{display:block;height:100%;background:var(--red)}.coherence-row{display:grid;grid-template-columns:145px 1fr 1fr 100px;gap:16px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)}.transition-id small{display:block;color:var(--muted)}.metric-label{font-size:11px;color:var(--muted)}.bar i{display:block;height:100%;background:var(--blue)}.energy-axis{height:8px;background:linear-gradient(90deg,#3a5874 0 49.5%,#8995a3 49.5% 50.5%,#416c54 50.5%);position:relative;border-radius:8px}.energy-axis i{position:absolute;top:-3px;width:3px;height:14px;background:#fff}.key{padding:5px;border-radius:5px;text-align:center}.key.match{background:#173f35;color:var(--green)}.key.change{background:#473d22;color:var(--amber)}.coherence-legend{color:var(--muted);font-size:11px;margin-bottom:8px}.status{padding:3px 7px;border-radius:4px}.status.pass{color:var(--green);background:#173f35}.status.fail{color:var(--red);background:#4a2028}.status.infra{color:var(--amber);background:#473d22}a{color:var(--blue)}@media(max-width:1000px){.cards{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}.coherence-row{grid-template-columns:120px 1fr}}
</style>
</head>
<body><main>
<h1>DJ Agent Benchmark</h1>
<div class="subtitle">${runs.length} stored attempts · ${evaluated.length} performance episodes · generated ${new Date().toISOString()}</div>
<section class="cards">
  <div class="card"><span>Episode pass rate</span><b>${passRate === null ? "—" : percent(passRate)}</b></div>
  <div class="card"><span>Continuity completion</span><b>${continuityRate === null ? "—" : percent(continuityRate)}</b></div>
  <div class="card"><span>Coherence coverage</span><b>${coherenceCoverage === null ? "—" : percent(coherenceCoverage)}</b></div>
  <div class="card"><span>Median tempo Δ</span><b>${tempoMedian === null ? "—" : `${tempoMedian.toFixed(1)}%`}</b></div>
  <div class="card"><span>Median energy Δ</span><b>${energyMedian === null ? "—" : `${energyMedian >= 0 ? "+" : ""}${energyMedian.toFixed(2)}`}</b></div>
  <div class="card"><span>Excluded runs</span><b>${infrastructure + invalid}</b></div>
</section>
<section class="grid2">
  <article class="panel"><h2>Continuity survival</h2><div class="note">Share of performance episodes surviving through each required transition.</div>${continuityChart(evaluated)}</article>
  <article class="panel"><h2>Failure taxonomy</h2><div class="note">Infrastructure separated from model performance.</div>${failureChart(runs)}</article>
</section>
<section class="panel wide"><h2>Coherence trajectory</h2><div class="note">Measured evidence, not listening quality. Exact-key badge intentionally conservative.</div>${coherenceChart(completeEvidence)}</section>
<section class="panel wide"><h2>Model/config comparison</h2><table><thead><tr><th>Model</th><th>Attempts</th><th>Evaluated</th><th>Pass</th><th>Continuity</th><th>Coherence coverage</th><th>Median tokens</th></tr></thead><tbody>${modelTable(runs)}</tbody></table></section>
<section class="panel wide"><h2>Episode drill-down</h2><table><thead><tr><th>Run</th><th>Status</th><th>Model</th><th>Scenario</th><th>Transitions</th><th>Coherence pairs</th><th>Tokens</th><th>Class</th></tr></thead><tbody>${runTable(runs, root, reportUrl)}</tbody></table></section>
<p class="note">Musical coherence remains unvalidated until real-audio listening scores exist. Dashboard reports mechanical continuity and analysis evidence only.</p>
</main></body></html>`;
  return html;
}

export function writeBenchmarkDashboard(root: string, runs: BenchSummary[]): string {
  mkdirSync(root, { recursive: true });
  const outputPath = join(root, "benchmark.html");
  const html = renderBenchmarkDashboard(root, runs);
  writeFileSync(outputPath, html);
  return outputPath;
}
