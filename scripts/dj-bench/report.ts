import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { BenchConfig } from "./config";

export interface CoherenceEvidence {
  fromTrackId: number;
  toTrackId: number;
  tempo?: {
    outgoingBpm: number;
    incomingBpm: number;
    normalizedDeltaPercent: number;
  };
  harmonic?: {
    outgoingKey: string;
    incomingKey: string;
    sameKey: boolean;
  };
  energy?: {
    outgoingMean: number;
    incomingMean: number;
    delta: number;
  };
  analysisComplete: boolean;
}

export interface ContinuityStep {
  fromTrackId: number;
  toTrackId: number;
  acceptedAtSec: number;
  scheduledAtSec: number;
  blendDurationSec: number;
}

export interface BenchSummary {
  ok: boolean;
  validity: "valid" | "invalid";
  invalidReason: string | null;
  runId: string;
  startedAt: string;
  finishedAt: string;
  model: string;
  provider: string;
  scenario: string;
  prompt: string;
  planningLeadSec: number;
  requestedTransitions: number;
  acceptedTransitions: number;
  acceptedTrackIds: number[];
  outgoingTrack: unknown;
  duplicateAcceptedTracks: number;
  stateReads: number;
  rejectedTransitions: number;
  impossibleScheduleAttempts: number;
  toolCalls: Record<string, number>;
  toolFailures: Record<string, number>;
  scheduledTrackIds: number[];
  analysisTrackIds: number[];
  falseSuccessClaims: number;
  backstageNarrationCount: number;
  analysisBudgetRejections: number;
  discoveryBudgetRejections: number;
  tokens: { input: number; output: number; total: number };
  simulatedTimeSec: number;
  tracePath: string;
  summaryPath: string;
  reportPath: string;
  configPath: string;
  error: string | null;
  continuity: {
    status: "pass" | "fail";
    completedRatio: number;
    noAcceptedTransition: boolean;
    impossibleScheduleAttempts: number;
    steps: ContinuityStep[];
  };
  coherenceEvidence: CoherenceEvidence[];
  agentTranscript: Array<{
    turn: number;
    step: number;
    text: string;
    backstageNarration: boolean;
  }>;
  claim: string;
}

function ensureParent(path: string) {
  mkdirSync(dirname(path), { recursive: true });
}

function display(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

function toolRows(summary: BenchSummary): string {
  const names = new Set([
    ...Object.keys(summary.toolCalls),
    ...Object.keys(summary.toolFailures),
  ]);
  if (names.size === 0) return "_No agent tool calls recorded._";
  return [
    "| Tool | Calls | Failures |",
    "| --- | ---: | ---: |",
    ...[...names].sort().map(
      (name) =>
        `| ${name} | ${summary.toolCalls[name] ?? 0} | ${summary.toolFailures[name] ?? 0} |`,
    ),
  ].join("\n");
}

function coherenceRows(summary: BenchSummary): string {
  if (summary.coherenceEvidence.length === 0) {
    return "_No accepted transition. No coherence evidence available._";
  }
  return [
    "| Transition | Analysis | Tempo | Key | Energy Δ |",
    "| --- | --- | --- | --- | ---: |",
    ...summary.coherenceEvidence.map((item) => {
      const tempo = item.tempo
        ? `${item.tempo.outgoingBpm.toFixed(1)} → ${item.tempo.incomingBpm.toFixed(1)} (${item.tempo.normalizedDeltaPercent.toFixed(1)}%)`
        : "unscorable";
      const harmonic = item.harmonic
        ? `${mermaidText(item.harmonic.outgoingKey)} → ${mermaidText(item.harmonic.incomingKey)}${item.harmonic.sameKey ? " (same)" : ""}`
        : "unscorable";
      return `| ${item.fromTrackId} → ${item.toTrackId} | ${item.analysisComplete ? "complete" : "partial"} | ${tempo} | ${harmonic} | ${display(item.energy?.delta)} |`;
    }),
  ].join("\n");
}

function transcriptRows(summary: BenchSummary): string {
  const transcript = summary.agentTranscript ?? [];
  if (transcript.length === 0) return "_No agent text emitted._";
  return transcript.map((entry) =>
    `**Turn ${entry.turn}, step ${entry.step}${entry.backstageNarration ? " — BACKSTAGE LEAK" : ""}**\n\n> ${entry.text.replace(/\n/g, "\n> ")}`,
  ).join("\n\n");
}

function mermaidText(value: unknown, maximumLength = 80): string {
  return String(value ?? "")
    .replace(/["<>{}|`]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, maximumLength);
}

function outgoingTrackId(summary: BenchSummary): number | undefined {
  if (!summary.outgoingTrack || typeof summary.outgoingTrack !== "object") return undefined;
  const id = (summary.outgoingTrack as Record<string, unknown>).id;
  return typeof id === "number" ? id : undefined;
}

export function continuityGraph(summary: BenchSummary): string {
  const lines = [
    "```mermaid",
    "flowchart LR",
    '  classDef pass fill:#173f35,stroke:#57d69a,color:#fff',
    '  classDef fail fill:#4a2028,stroke:#ff6b7a,color:#fff',
    '  classDef track fill:#17314a,stroke:#67b7ff,color:#fff',
  ];
  const initialId = outgoingTrackId(summary);
  if (initialId) {
    lines.push(`  T0["${initialId}<br/>outgoing"]:::track`);
  } else {
    lines.push('  T0["Run start"]:::track');
  }
  summary.continuity.steps.forEach((step, index) => {
    const next = index + 1;
    lines.push(
      `  T${index} -->|"T${next} accepted<br/>cue ${step.scheduledAtSec.toFixed(1)}s<br/>blend ${step.blendDurationSec.toFixed(1)}s"| T${next}["${step.toTrackId}"]:::track`,
    );
  });
  if (summary.continuity.status === "pass") {
    const last = summary.continuity.steps.length;
    lines.push(`  T${last} --> P["CONTINUITY PASS<br/>${summary.acceptedTransitions}/${summary.requestedTransitions} transitions"]:::pass`);
  } else {
    const last = summary.continuity.steps.length;
    const reason = mermaidText(summary.error ?? "Transition contract failed");
    lines.push(`  T${last} -.-> F["CONTINUITY FAIL<br/>${reason}"]:::fail`);
  }
  if (summary.rejectedTransitions > 0) {
    lines.push(`  R["${summary.rejectedTransitions} rejected attempt(s)"]:::fail`);
    lines.push("  R -.-> F");
  }
  return [...lines, "```"].join("\n");
}

export function coherenceGraph(summary: BenchSummary): string {
  const lines = [
    "```mermaid",
    "flowchart LR",
    '  classDef scored fill:#263b31,stroke:#74d99f,color:#fff',
    '  classDef partial fill:#473d22,stroke:#e9c46a,color:#fff',
    '  classDef missing fill:#4a2028,stroke:#ff6b7a,color:#fff',
  ];
  if (summary.coherenceEvidence.length === 0) {
    const reason = summary.acceptedTransitions === 0
      ? "No accepted transition"
      : "No paired analysis";
    lines.push(`  U["COHERENCE UNSCORABLE<br/>${reason}"]:::missing`);
    return [...lines, "```"].join("\n");
  }
  summary.coherenceEvidence.forEach((item, index) => {
    const tempo = item.tempo
      ? `tempo Δ ${item.tempo.normalizedDeltaPercent.toFixed(1)}%`
      : "tempo unscorable";
    const key = item.harmonic
      ? `${mermaidText(item.harmonic.outgoingKey)} → ${mermaidText(item.harmonic.incomingKey)}`
      : "key unscorable";
    const energy = item.energy
      ? `energy Δ ${item.energy.delta >= 0 ? "+" : ""}${item.energy.delta.toFixed(2)}`
      : "energy unscorable";
    const style = item.analysisComplete ? "scored" : "partial";
    lines.push(`  C${index}A["${item.fromTrackId}"]:::${style}`);
    lines.push(`  C${index}B["${item.toTrackId}"]:::${style}`);
    lines.push(
      `  C${index}A -->|"${tempo}<br/>${key}<br/>${energy}"| C${index}B`,
    );
  });
  return [...lines, "```"].join("\n");
}

export function writeRunConfig(config: BenchConfig) {
  ensureParent(config.configPath);
  const sanitized = {
    runId: config.runId,
    provider: config.provider,
    model: config.model,
    transitions: config.transitions,
    timeoutMs: config.timeoutMs,
    maxSteps: config.maxSteps,
    clockSpeed: config.clockSpeed,
    planningLeadSec: config.planningLeadSec,
    failures: [...config.failures],
    mcpUrl: publicMcpUrl(config.mcpUrl),
    outgoingTrackId: config.outgoingTrackId,
    prompt: config.prompt,
    scenario: config.scenario,
    tracePath: config.tracePath,
    summaryPath: config.summaryPath,
    reportPath: config.reportPath,
    hasCookie: Boolean(config.cookie),
    hasOpenCodeApiKey: Boolean(config.opencodeApiKey),
  };
  writeFileSync(config.configPath, `${JSON.stringify(sanitized, null, 2)}\n`);
}

export function publicMcpUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "<invalid MCP URL>";
  }
}

export function writeRunArtifacts(config: BenchConfig, summary: BenchSummary) {
  ensureParent(config.summaryPath);
  writeFileSync(config.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  const report = `# DJ Bench Report

## Verdict

**${summary.validity === "invalid" ? "INVALID" : summary.ok ? "PASS" : "FAIL"}** — continuity ${summary.continuity.status}.

${summary.invalidReason ? `Invalidated: \`${summary.invalidReason}\`\n` : ""}
${summary.error ? `Failure: \`${summary.error}\`\n` : ""}
- Run: \`${summary.runId}\`
- Model: \`${summary.provider}/${summary.model}\`
- Scenario: \`${summary.scenario}\`
- Started: ${summary.startedAt}
- Finished: ${summary.finishedAt}
- Prompt: ${summary.prompt}
- Planning runway: ${summary.planningLeadSec}s

## Continuity

${continuityGraph(summary)}

- Accepted transitions: ${summary.acceptedTransitions}/${summary.requestedTransitions}
- Completion: ${(summary.continuity.completedRatio * 100).toFixed(0)}%
- Rejected transitions: ${summary.rejectedTransitions}
- Impossible schedules: ${summary.impossibleScheduleAttempts}
- False success claims: ${summary.falseSuccessClaims}
- Backstage narration leaks: ${summary.backstageNarrationCount}
- Analysis calls rejected by turn budget: ${summary.analysisBudgetRejections}
- Discovery calls rejected by turn budget: ${summary.discoveryBudgetRejections}
- Accepted track IDs: ${summary.acceptedTrackIds.join(", ") || "none"}

## Coherence evidence

Evidence only. No musical-quality claim.

${coherenceGraph(summary)}

${coherenceRows(summary)}

## Tools

${toolRows(summary)}

## Debug model transcript

Not audience dialogue. Text emitted alongside tool calls is marked as backstage leakage.

${transcriptRows(summary)}

## Cost and time

- Tokens: ${summary.tokens.total} total (${summary.tokens.input} input, ${summary.tokens.output} output)
- Simulated time: ${summary.simulatedTimeSec.toFixed(1)}s
- State reads: ${summary.stateReads}
- Analysis IDs: ${summary.analysisTrackIds.join(", ") || "none"}
- Scheduled IDs: ${summary.scheduledTrackIds.join(", ") || "none"}

## Files

- Trace: \`${summary.tracePath}\`
- Summary: \`${summary.summaryPath}\`
- Config: \`${summary.configPath}\`

> ${summary.claim}
`;
  writeFileSync(config.reportPath, report);
}
