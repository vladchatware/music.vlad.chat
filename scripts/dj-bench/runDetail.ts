import type { BenchSummary, CoherenceEvidence, ContinuityStep } from "./report";
import type { BenchTraceEvent } from "./reportStore";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function number(value: number | undefined, digits = 1): string {
  return value === undefined ? "—" : value.toFixed(digits);
}

function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function elapsed(startedAt: string, finishedAt: string): string {
  const milliseconds = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(milliseconds) && milliseconds >= 0
    ? duration(milliseconds / 1000)
    : "—";
}

function outgoingTrack(summary: BenchSummary): {
  id?: number;
  artist?: string;
  title?: string;
  bpm?: number;
} {
  if (!summary.outgoingTrack || typeof summary.outgoingTrack !== "object") return {};
  const track = summary.outgoingTrack as Record<string, unknown>;
  return {
    id: typeof track.id === "number" ? track.id : undefined,
    artist: typeof track.artist === "string" ? track.artist : undefined,
    title: typeof track.title === "string" ? track.title : undefined,
    bpm: typeof track.bpm === "number" ? track.bpm : undefined,
  };
}

function evidenceForStep(
  evidence: CoherenceEvidence[],
  step: ContinuityStep,
  index: number,
): CoherenceEvidence | undefined {
  return evidence.find(
    (item) =>
      item.fromTrackId === step.fromTrackId &&
      item.toTrackId === step.toTrackId,
  ) ?? evidence[index];
}

function transitionRows(summary: BenchSummary): string {
  if (summary.continuity.steps.length === 0) {
    return '<div class="empty">No accepted transition recorded.</div>';
  }
  return summary.continuity.steps.map((step, index) => {
    const evidence = evidenceForStep(summary.coherenceEvidence, step, index);
    const complete = evidence?.analysisComplete === true;
    const tempo = evidence?.tempo;
    const harmonic = evidence?.harmonic;
    const energy = evidence?.energy;
    return `<article class="transition ${complete ? "scored" : "partial"}">
      <div class="transition-index">T${index + 1}</div>
      <div class="track-pair">
        <strong>${step.fromTrackId}</strong><span>→</span><strong>${step.toTrackId}</strong>
        <small>accepted @ ${number(step.acceptedAtSec)}s · cue ${number(step.scheduledAtSec)}s · blend ${number(step.blendDurationSec)}s</small>
      </div>
      <div class="transition-metric"><span>Tempo</span><b>${tempo ? `${number(tempo.outgoingBpm)} → ${number(tempo.incomingBpm)}` : "unscored"}</b><small>${tempo ? `${number(tempo.normalizedDeltaPercent)}% delta` : "analysis missing"}</small></div>
      <div class="transition-metric"><span>Key</span><b>${harmonic ? `${escapeHtml(harmonic.outgoingKey)} → ${escapeHtml(harmonic.incomingKey)}` : "unscored"}</b><small>${harmonic?.sameKey ? "exact match" : harmonic ? "key change" : "analysis missing"}</small></div>
      <div class="transition-metric"><span>Energy</span><b>${energy ? `${energy.delta >= 0 ? "+" : ""}${number(energy.delta, 2)}` : "unscored"}</b><small>${energy ? `${number(energy.outgoingMean, 2)} → ${number(energy.incomingMean, 2)}` : "analysis missing"}</small></div>
      <div class="evidence ${complete ? "complete" : "missing"}">${complete ? "evidence complete" : "evidence partial"}</div>
    </article>`;
  }).join("");
}

function toolRows(summary: BenchSummary): string {
  const names = new Set([
    ...Object.keys(summary.toolCalls),
    ...Object.keys(summary.toolFailures),
  ]);
  return [...names].sort().map((name) => `<tr>
    <td>${escapeHtml(name)}</td>
    <td>${summary.toolCalls[name] ?? 0}</td>
    <td class="${(summary.toolFailures[name] ?? 0) > 0 ? "danger" : ""}">${summary.toolFailures[name] ?? 0}</td>
  </tr>`).join("");
}

function eventFocus(event: BenchTraceEvent): string {
  const parts = [
    typeof event.tool === "string" ? event.tool : undefined,
    typeof event.trackId === "number" || typeof event.trackId === "string"
      ? `track ${event.trackId}`
      : undefined,
    typeof event.turn === "number" ? `turn ${event.turn}` : undefined,
    typeof event.step === "number" ? `step ${event.step}` : undefined,
  ].filter(Boolean);
  return parts.join(" · ") || "—";
}

function eventRows(events: BenchTraceEvent[]): string {
  if (events.length === 0) {
    return '<tr><td colspan="5" class="empty-cell">Trace unavailable.</td></tr>';
  }
  return events.map((event) => `<tr>
    <td>${event.sequence ?? "—"}</td>
    <td>${number(typeof event.wallElapsedMs === "number" ? event.wallElapsedMs / 1000 : undefined)}s</td>
    <td>${number(event.simulatedTimeSec)}s</td>
    <td><span class="event-type">${escapeHtml(event.type)}</span></td>
    <td>${escapeHtml(eventFocus(event))}</td>
  </tr>`).join("");
}

function warningPanel(summary: BenchSummary): string {
  const incomplete = summary.coherenceEvidence.filter(
    (item) => !item.analysisComplete,
  ).length;
  const warnings = [
    incomplete > 0
      ? `${incomplete}/${summary.coherenceEvidence.length} transitions lack paired analysis`
      : undefined,
    summary.rejectedTransitions > 0
      ? `${summary.rejectedTransitions} transition attempt rejected`
      : undefined,
    summary.impossibleScheduleAttempts > 0
      ? `${summary.impossibleScheduleAttempts} impossible schedule attempts`
      : undefined,
    summary.error ?? undefined,
  ].filter(Boolean);
  if (warnings.length === 0) return "";
  return `<aside class="warning"><span>Review flags</span>${warnings.map((warning) =>
    `<strong>${escapeHtml(warning)}</strong>`).join("")}</aside>`;
}

export function renderBenchRunDetail(
  summary: BenchSummary,
  events: BenchTraceEvent[],
): string {
  const track = outgoingTrack(summary);
  const completeEvidence = summary.coherenceEvidence.filter(
    (item) => item.analysisComplete,
  ).length;
  const coverage = summary.coherenceEvidence.length
    ? completeEvidence / summary.coherenceEvidence.length * 100
    : 0;
  const verdict = summary.validity === "invalid"
    ? "INVALID"
    : summary.ok
      ? "PASS"
      : "FAIL";
  const artifactBase = `/bench/runs/${encodeURIComponent(summary.runId)}/artifacts`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(summary.runId)} · DJ Bench</title>
<style>
:root{color-scheme:dark;--ink:#dfe9e8;--muted:#829291;--bg:#07100f;--panel:#0c1817;--panel2:#102220;--line:#1e3834;--cyan:#69e6cf;--green:#79f0a7;--amber:#f2c86b;--red:#ff7185;--grid:rgba(105,230,207,.045)}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;color:var(--ink);font:13px/1.5 "Azeret Mono","IBM Plex Mono","SFMono-Regular",Consolas,monospace;background:radial-gradient(circle at 80% -10%,rgba(105,230,207,.11),transparent 32rem),linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px),var(--bg);background-size:auto,24px 24px,24px 24px}
main{max-width:1540px;margin:auto;padding:26px 30px 64px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:44px}.back{color:var(--cyan);text-decoration:none;text-transform:uppercase;letter-spacing:.12em}.actions{display:flex;flex-wrap:wrap;gap:8px}.button{color:var(--ink);text-decoration:none;border:1px solid var(--line);background:rgba(12,24,23,.86);padding:8px 11px;border-radius:4px}.button:hover{border-color:var(--cyan);color:var(--cyan)}
.hero{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:end;border-bottom:1px solid var(--line);padding-bottom:22px}.eyebrow{color:var(--cyan);text-transform:uppercase;letter-spacing:.2em;font-size:11px}h1{margin:8px 0 0;font-size:clamp(25px,4vw,54px);font-weight:540;letter-spacing:-.045em;word-break:break-all}.verdict{font-size:30px;border:1px solid currentColor;padding:8px 16px;transform:rotate(-2deg)}.verdict.pass{color:var(--green)}.verdict.fail,.verdict.invalid{color:var(--red)}
.cards{display:grid;grid-template-columns:repeat(6,minmax(130px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);margin:18px 0}.card{background:var(--panel);padding:16px}.card span,.label{display:block;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;font-size:10px}.card b{display:block;font-size:24px;margin-top:6px;font-weight:520}.warning{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid #665128;background:#241e10;padding:11px 14px;margin:18px 0}.warning span{color:var(--amber);text-transform:uppercase;letter-spacing:.12em}.warning strong{font-weight:400}.warning strong+strong{border-left:1px solid #806d45;padding-left:10px}
.grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(300px,.6fr);gap:16px;margin-top:16px}.panel{background:rgba(12,24,23,.91);border:1px solid var(--line);padding:19px;overflow:auto}.panel h2{font-size:14px;text-transform:uppercase;letter-spacing:.16em;color:var(--cyan);margin:0 0 16px}.manifest{display:grid;grid-template-columns:140px 1fr;gap:9px 14px}.manifest dt{color:var(--muted)}.manifest dd{margin:0}.prompt{font:18px/1.45 Georgia,serif;color:#f0f4eb}
.transition-list{display:grid;gap:8px}.transition{display:grid;grid-template-columns:46px minmax(220px,1.5fr) repeat(3,minmax(110px,1fr)) auto;gap:14px;align-items:center;background:var(--panel2);border:1px solid var(--line);padding:13px}.transition.partial{border-left:3px solid var(--amber)}.transition.scored{border-left:3px solid var(--green)}.transition-index{font-size:22px;color:var(--cyan)}.track-pair{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.track-pair small{width:100%;color:var(--muted)}.transition-metric span,.transition-metric small{display:block;color:var(--muted);font-size:10px}.transition-metric b{display:block;font-weight:500;margin:2px 0}.evidence{font-size:10px;text-transform:uppercase;letter-spacing:.08em;padding:5px 7px;border:1px solid currentColor}.evidence.complete{color:var(--green)}.evidence.missing{color:var(--amber)}
table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.1em}.danger{color:var(--red)}.event-type{color:var(--cyan)}.empty,.empty-cell{color:var(--muted);padding:28px;border:1px dashed var(--line)}.trace{max-height:540px;overflow:auto}.note{color:var(--muted);margin-top:22px}.footmark{display:inline-block;width:8px;height:8px;background:var(--cyan);box-shadow:0 0 14px var(--cyan);margin-right:9px}
@keyframes enter{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}.hero,.cards,.panel,.warning{animation:enter .45s both}.cards{animation-delay:.05s}.panel{animation-delay:.1s}
@media(max-width:1100px){.cards{grid-template-columns:repeat(3,1fr)}.grid{grid-template-columns:1fr}.transition{grid-template-columns:42px 1fr 1fr}.track-pair{grid-column:2/4}.evidence{grid-column:2/4;justify-self:start}}@media(max-width:700px){main{padding:18px 14px 48px}.topbar,.hero{align-items:flex-start;flex-direction:column}.hero{display:flex}.cards{grid-template-columns:repeat(2,1fr)}.transition{grid-template-columns:36px 1fr}.track-pair,.evidence{grid-column:2}.transition-metric{grid-column:2}.manifest{grid-template-columns:1fr}}
</style>
</head>
<body><main>
<nav class="topbar">
  <a class="back" href="/bench">← All episodes</a>
  <div class="actions">
    <a class="button" href="${artifactBase}/report">Download report.md</a>
    <a class="button" href="${artifactBase}/trace">Download trace.jsonl</a>
    <a class="button" href="${artifactBase}/summary">Download summary.json</a>
    <a class="button" href="${artifactBase}/config">Download config.json</a>
  </div>
</nav>
<header class="hero">
  <div><span class="eyebrow">Episode flight recorder · ${escapeHtml(summary.provider)}/${escapeHtml(summary.model)}</span><h1>${escapeHtml(summary.runId)}</h1></div>
  <div class="verdict ${verdict.toLowerCase()}">${verdict}</div>
</header>
<section class="cards">
  <div class="card"><span>Continuity</span><b>${summary.continuity.status.toUpperCase()}</b></div>
  <div class="card"><span>Transitions</span><b>${summary.acceptedTransitions}/${summary.requestedTransitions}</b></div>
  <div class="card"><span>Coherence</span><b>${coverage.toFixed(0)}%</b></div>
  <div class="card"><span>Tokens</span><b>${summary.tokens.total.toLocaleString("en-US")}</b></div>
  <div class="card"><span>Wall time</span><b>${elapsed(summary.startedAt, summary.finishedAt)}</b></div>
  <div class="card"><span>Simulated set</span><b>${duration(summary.simulatedTimeSec)}</b></div>
</section>
${warningPanel(summary)}
<section class="grid">
  <article class="panel">
    <h2>Run manifest</h2>
    <dl class="manifest">
      <dt>Prompt</dt><dd class="prompt">“${escapeHtml(summary.prompt)}”</dd>
      <dt>Scenario</dt><dd>${escapeHtml(summary.scenario)}</dd>
      <dt>Started</dt><dd>${escapeHtml(summary.startedAt)}</dd>
      <dt>Opening track</dt><dd>${track.id ?? "—"} · ${escapeHtml(track.artist ?? "Unknown artist")} — ${escapeHtml(track.title ?? "Unknown title")} ${track.bpm ? `· ${number(track.bpm)} BPM` : ""}</dd>
      <dt>Planning runway</dt><dd>${summary.planningLeadSec}s</dd>
      <dt>State reads</dt><dd>${summary.stateReads}</dd>
    </dl>
  </article>
  <article class="panel">
    <h2>Contract counters</h2>
    <dl class="manifest">
      <dt>Rejected transitions</dt><dd>${summary.rejectedTransitions}</dd>
      <dt>Impossible schedules</dt><dd>${summary.impossibleScheduleAttempts}</dd>
      <dt>Duplicate tracks</dt><dd>${summary.duplicateAcceptedTracks}</dd>
      <dt>False success claims</dt><dd>${summary.falseSuccessClaims}</dd>
      <dt>Backstage leaks</dt><dd>${summary.backstageNarrationCount}</dd>
      <dt>Validity</dt><dd>${escapeHtml(summary.validity)}</dd>
    </dl>
  </article>
</section>
<section class="panel" style="margin-top:16px">
  <h2>Transition chain</h2>
  <div class="transition-list">${transitionRows(summary)}</div>
</section>
<section class="grid">
  <article class="panel">
    <h2>Tool ledger</h2>
    <table><thead><tr><th>Tool</th><th>Calls</th><th>Failures</th></tr></thead><tbody>${toolRows(summary)}</tbody></table>
  </article>
  <article class="panel">
    <h2>Analysis inventory</h2>
    <dl class="manifest">
      <dt>Analyzed IDs</dt><dd>${escapeHtml(summary.analysisTrackIds.join(", ") || "none")}</dd>
      <dt>Scheduled IDs</dt><dd>${escapeHtml(summary.scheduledTrackIds.join(", ") || "none")}</dd>
      <dt>Accepted IDs</dt><dd>${escapeHtml(summary.acceptedTrackIds.join(", ") || "none")}</dd>
      <dt>Input tokens</dt><dd>${summary.tokens.input.toLocaleString("en-US")}</dd>
      <dt>Output tokens</dt><dd>${summary.tokens.output.toLocaleString("en-US")}</dd>
    </dl>
  </article>
</section>
<section class="panel" style="margin-top:16px">
  <h2>Event timeline · ${events.length} records</h2>
  <div class="trace"><table><thead><tr><th>#</th><th>Wall</th><th>Simulated</th><th>Event</th><th>Focus</th></tr></thead><tbody>${eventRows(events)}</tbody></table></div>
</section>
<p class="note"><span class="footmark"></span>${escapeHtml(summary.claim)} Raw artifacts remain available for debugging, not primary navigation.</p>
</main></body></html>`;
}
