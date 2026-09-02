import type { EQCurvePreset } from "../eq/types";
import type { DeckSnapshot } from "../engine/types";
import type { TransitionPlan } from "../types";
import type { DJPerformancePlan } from "./schema";

export type {
  DJPerformancePlan,
  DJTimelinePatch,
  PerformanceSection,
  PlayerToolInput,
} from "./schema";

export type PerformanceLoop = {
  deck: "outgoing" | "incoming";
  startSec: number;
  endSec: number;
  durationSec: number;
  repetitions: number;
};

export type CompiledPerformance = {
  source: "agent";
  energyArc: DJPerformancePlan["energyArc"];
  incomingStartSec: number;
  crossfaderCurve: DJPerformancePlan["blend"]["crossfaderCurve"];
  eqPreset: Exclude<EQCurvePreset, "custom">;
  bassSwapAt: number;
  loop?: PerformanceLoop;
  reason: string;
};

export type PerformanceCompilationDiagnostics = {
  accepted: string[];
  adjustments: string[];
  ignored: string[];
  fallbackReasons: string[];
  confidence: number;
};

export type CompiledPerformancePlan = {
  plan: TransitionPlan;
  performance: CompiledPerformance;
  diagnostics: PerformanceCompilationDiagnostics;
};

export type PerformanceLiveState = {
  outgoingDeck: DeckSnapshot;
  incomingDeck: DeckSnapshot;
  currentTimeSec: number;
};
