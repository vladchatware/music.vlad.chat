"use client";

import { useEffect, useRef, useState } from "react";

import styles from "../../../backroom.module.css";
import EnergyTimeline, { type TimelineSegment, type TrackSection } from "./EnergyTimeline";


type Props = {
  trackId: string;
  durationSec: number;
  samples: number[];
  sections: TrackSection[];
  segments: TimelineSegment[];
  playable: boolean;
};

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
};

export default function PlaybackEnergyChart({ trackId, durationSec, samples, sections, segments, playable }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    <EnergyTimeline durationSec={durationSec} samples={samples} sections={sections} segments={segments} currentTime={currentTime} onSeek={seek} ariaLabel="Track energy over time" />

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
