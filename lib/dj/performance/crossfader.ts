import type { DJPerformancePlan } from "./types";

export function getCrossfaderGains(
  curve: DJPerformancePlan["blend"]["crossfaderCurve"],
  rawProgress: number,
): { outgoing: number; incoming: number } {
  const progress = Math.max(0, Math.min(1, rawProgress));
  if (curve === "cut") {
    return progress < 0.5
      ? { outgoing: 1, incoming: 0 }
      : { outgoing: 0, incoming: 1 };
  }
  if (curve === "equal_power") {
    return {
      outgoing: Math.cos(progress * Math.PI * 0.5),
      incoming: Math.sin(progress * Math.PI * 0.5),
    };
  }
  return { outgoing: 1 - progress, incoming: progress };
}
