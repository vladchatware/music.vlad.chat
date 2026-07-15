"use client";

import { useEffect, useId, useRef, useState } from "react";

import styles from "../../dashboard.module.css";

type TrackSection = { startTime: number; endTime: number; type: string };

type Props = {
  trackId: string;
  durationSec: number;
  samples: number[];
  sections: TrackSection[];
  playable: boolean;
};

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
};

export default function PlaybackEnergyChart({ trackId, durationSec, samples, sections, playable }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const gradientId = useId().replaceAll(":", "");
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const points = samples.map((value, index) => `${samples.length <= 1 ? 0 : index / (samples.length - 1) * 100},${100 - value * 100}`).join(" ");
  const progress = durationSec > 0 ? Math.min(1, currentTime / durationSec) : 0;

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const updatePlayhead = () => {
      if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
      frame = requestAnimationFrame(updatePlayhead);
    };
    frame = requestAnimationFrame(updatePlayhead);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !playable) return;
    setError(null);
    if (!audio.paused) {
      audio.pause();
      return;
    }
    setLoading(true);
    try {
      await audio.play();
    } catch {
      setError("Playback unavailable");
    } finally {
      setLoading(false);
    }
  };

  const seek = (value: number) => {
    const nextTime = Math.max(0, Math.min(durationSec, value));
    if (audioRef.current) audioRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  return <div className={styles.analysisPlayer}>
    <div className={styles.transport}>
      <button type="button" onClick={togglePlayback} disabled={!playable || loading} aria-label={playing ? "Pause track" : "Play track"}>
        <span aria-hidden="true">{loading ? "···" : playing ? "Ⅱ" : "▶"}</span>
        {playing ? "Pause" : "Play track"}
      </button>
      <output aria-live="off"><b>{formatTime(currentTime)}</b> / {formatTime(durationSec)}</output>
      <span>{error ?? (playable ? "Click or drag chart to inspect" : "Track is not streamable")}</span>
    </div>

    <div className={styles.interactivePlot} style={{ "--progress": progress } as React.CSSProperties}>
      <svg className={styles.energyPlot} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Track energy over time">
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".55" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
        <polygon points={`0,100 ${points} 100,100`} fill={`url(#${gradientId})`} />
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className={styles.timeline}>{sections.map((section, index) => <div key={`${section.startTime}-${index}`} className={styles.sectionBlock} style={{ left: `${section.startTime / durationSec * 100}%`, width: `${(section.endTime - section.startTime) / durationSec * 100}%` }}><b>{section.type}</b><small>{formatTime(section.startTime)}</small></div>)}</div>
      <div className={styles.playhead} aria-hidden="true"><i /></div>
      <input
        className={styles.timelineScrubber}
        type="range"
        min="0"
        max={durationSec}
        step="0.01"
        value={currentTime}
        onChange={(event) => seek(event.currentTarget.valueAsNumber)}
        aria-label="Track position"
        aria-valuetext={`${formatTime(currentTime)} of ${formatTime(durationSec)}`}
      />
    </div>

    {playable && <audio
      ref={audioRef}
      src={`/api/tracks/${trackId}/stream`}
      preload="metadata"
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
      onEnded={() => setPlaying(false)}
      onError={() => { setLoading(false); setPlaying(false); setError("Playback unavailable"); }}
    />}
  </div>;
}
