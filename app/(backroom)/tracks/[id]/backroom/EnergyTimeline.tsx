"use client";

import { useId, useState } from "react";

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
  mirexMood?: Record<string, number>;
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

type HoverCard = {
  kind: "section" | "segment";
  key: string;
  title: string;
  subtitle: string;
  metrics: Array<[string, string]>;
  centerPct: number;
};

const dominantLabel = (values: Record<string, number> | undefined) => values
  ? Object.entries(values).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  : null;

// Keep the popover anchored over its step but away from the viewport edges.
const anchorPct = (durationSec: number, startSec: number, endSec: number) =>
  durationSec > 0 ? Math.max(16, Math.min(84, ((startSec + endSec) / 2) / durationSec * 100)) : 50;

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
  const [hoverCard, setHoverCard] = useState<HoverCard | null>(null);
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

  const setCardIfChanged = (card: HoverCard) =>
    setHoverCard((current) => current?.key === card.key ? null : card);

  const sectionCards = sections.map((section, index) => ({
    key: `section-${section.startTime}-${index}`,
    kind: "section" as const,
    title: section.type.toUpperCase(),
    subtitle: `${formatTime(section.startTime)} – ${formatTime(section.endTime)}`,
    metrics: [["Length", formatTime(section.endTime - section.startTime)] as [string, string]],
    centerPct: anchorPct(durationSec, section.startTime, section.endTime),
    section,
  }));

  const segmentCards = segments.map((segment) => {
    const mood = dominantLabel(segment.mirexMood);
    return {
      key: `segment-${segment.id}`,
      kind: "segment" as const,
      title: `${segment.id} · ${segment.section}`,
      subtitle: `${formatTime(segment.startSec)} – ${formatTime(segment.endSec)}`,
      metrics: [
        ["Energy", `${Math.round(segment.energy * 100)}%`],
        ["Entry", `${Math.round(segment.entryQuality * 100)}%`],
        ["Exit", `${Math.round(segment.exitQuality * 100)}%`],
        ...(mood ? [["Mood", mood]] : []),
      ] as Array<[string, string]>,
      centerPct: anchorPct(durationSec, segment.startSec, segment.endSec),
      segment,
    };
  });

  const renderPopover = (card: HoverCard) => (
    <div
      className={styles.hoverCard}
      style={{ "--x": `${card.centerPct}%` } as React.CSSProperties}
      role="presentation"
    >
      <b>{card.title}</b>
      <span>{card.subtitle}</span>
      <dl>
        {card.metrics.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
    </div>
  );

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
    <div className={styles.timeline} aria-label="Track structure">
      {sectionCards.map(({ section, ...card }) => <div
        key={card.key}
        className={styles.sectionBlock}
        style={{ left: `${section.startTime / durationSec * 100}%`, width: `${(section.endTime - section.startTime) / durationSec * 100}%` }}
        aria-label={`${card.title}, ${card.subtitle}`}
        onMouseEnter={() => setHoverCard(card)}
        onMouseLeave={() => setHoverCard((current) => current?.key === card.key ? null : current)}
        onClick={() => setCardIfChanged(card)}
      ><b>{section.type}</b><small>{formatTime(section.startTime)}</small></div>)}
      {hoverCard?.kind === "section" && renderPopover(hoverCard)}
    </div>
    {segments.length > 0 && <div className={timelineStyles.segmentTimeline} aria-label="DJ mix segments">
      <span className={timelineStyles.segmentRailLabel}>DJ SEGMENTS</span>
      {segmentCards.map(({ segment, ...card }, index) => <div
        key={segment.id}
        className={timelineStyles.segmentBlock}
        data-active={segment.id === highlightedWindow?.segmentId || undefined}
        role="img"
        aria-label={`Segment ${index + 1}, ${card.title}, ${card.subtitle}, energy ${card.metrics[0][1]}, entry ${card.metrics[1][1]}, exit ${card.metrics[2][1]}${card.metrics[3] ? `, mood ${card.metrics[3][1]}` : ""}`}
        onMouseEnter={() => setHoverCard(card)}
        onMouseLeave={() => setHoverCard((current) => current?.key === card.key ? null : current)}
        onClick={() => setCardIfChanged(card)}
        style={{
          left: `${segment.startSec / durationSec * 100}%`,
          width: `${(segment.endSec - segment.startSec) / durationSec * 100}%`,
        }}
      ><b>{String(index + 1).padStart(2, "0")}</b><small>{segment.section}</small></div>)}
      {hoverCard?.kind === "segment" && renderPopover(hoverCard)}
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
