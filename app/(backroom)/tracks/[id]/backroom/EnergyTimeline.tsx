"use client";

import { useId } from "react";

import styles from "../../../backroom.module.css";
import timelineStyles from "./EnergyTimeline.module.css";

export type TrackSection = { startTime: number; endTime: number; type: string };
export type TimelineSegment = {
  id: string;
  startSec: number;
  endSec: number;
  section: string;
  entryQuality: number;
  exitQuality: number;
  energy: number;
};
export type TimelineWindow = { startSec: number; endSec: number; segmentId?: string };

type Props = {
  durationSec: number;
  samples: number[];
  sections: TrackSection[];
  segments?: TimelineSegment[];
  currentTime: number;
  onSeek: (seconds: number) => void;
  ariaLabel: string;
  highlightedWindow?: TimelineWindow;
  deck?: "outgoing" | "incoming";
};

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
};

export default function EnergyTimeline({
  durationSec,
  samples,
  sections,
  segments = [],
  currentTime,
  onSeek,
  ariaLabel,
  highlightedWindow,
  deck,
}: Props) {
  const gradientId = useId().replaceAll(":", "");
  const points = samples.map((value, index) =>
    `${samples.length <= 1 ? 0 : index / (samples.length - 1) * 100},${100 - value * 100}`
  ).join(" ");
  const progress = durationSec > 0 ? Math.max(0, Math.min(1, currentTime / durationSec)) : 0;
  const windowLeft = highlightedWindow && durationSec > 0
    ? highlightedWindow.startSec / durationSec * 100
    : 0;
  const windowWidth = highlightedWindow && durationSec > 0
    ? (highlightedWindow.endSec - highlightedWindow.startSec) / durationSec * 100
    : 0;

  return <div
    className={styles.interactivePlot}
    data-deck={deck}
    style={{ "--progress": progress } as React.CSSProperties}
  >
    <div className={timelineStyles.chartArea}>
      <svg className={`${styles.energyPlot} ${timelineStyles.energySvg}`} style={{ borderBottomColor: "var(--plot-line)" }} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={ariaLabel}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".55" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
        <polygon points={`0,100 ${points} 100,100`} fill={`url(#${gradientId})`} />
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
      </svg>
      {highlightedWindow && <div
        className={styles.transitionWindow}
        style={{ left: `${windowLeft}%`, width: `${Math.max(.35, windowWidth)}%`, bottom: 1 }}
        aria-hidden="true"
      ><span>{formatTime(highlightedWindow.startSec)}–{formatTime(highlightedWindow.endSec)}</span></div>}
    </div>
    <div className={styles.timeline} aria-label="Track structure">{sections.map((section, index) => <div key={`${section.startTime}-${index}`} className={styles.sectionBlock} style={{ left: `${section.startTime / durationSec * 100}%`, width: `${(section.endTime - section.startTime) / durationSec * 100}%` }}><b>{section.type}</b><small>{formatTime(section.startTime)}</small></div>)}</div>
    {segments.length > 0 && <div className={timelineStyles.segmentTimeline} aria-label="DJ mix segments">
      <span className={timelineStyles.segmentRailLabel}>DJ SEGMENTS</span>
      {segments.map((segment, index) => <div
        key={segment.id}
        className={timelineStyles.segmentBlock}
        data-active={segment.id === highlightedWindow?.segmentId || undefined}
        role="img"
        aria-label={`Segment ${index + 1}, ${segment.section}, ${formatTime(segment.startSec)} to ${formatTime(segment.endSec)}`}
        style={{
          left: `${segment.startSec / durationSec * 100}%`,
          width: `${(segment.endSec - segment.startSec) / durationSec * 100}%`,
        }}
        title={`${segment.id} · ${segment.section} · ${formatTime(segment.startSec)}–${formatTime(segment.endSec)} · entry ${Math.round(segment.entryQuality * 100)} · exit ${Math.round(segment.exitQuality * 100)}`}
      ><b>{String(index + 1).padStart(2, "0")}</b><small>{segment.section}</small></div>)}
    </div>}
    <div className={styles.playhead} style={{ bottom: segments.length ? 0 : undefined }} aria-hidden="true"><i /></div>
    <input
      className={styles.timelineScrubber}
      type="range"
      min="0"
      max={durationSec}
      step="0.01"
      value={currentTime}
      onChange={(event) => onSeek(event.currentTarget.valueAsNumber)}
      aria-label={`${ariaLabel} position`}
      aria-valuetext={`${formatTime(currentTime)} of ${formatTime(durationSec)}`}
    />
  </div>;
}
