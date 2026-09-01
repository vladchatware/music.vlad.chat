"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getCrossfaderGains } from "@/lib/dj";
import {
  audibleSegmentsAt,
  segmentSourceTime,
  type BenchAudibleSegment,
  type BenchTimelineEvent,
  type BenchTimelineManifest,
} from "@/scripts/dj-bench/timeline";

import styles from "../bench.module.css";

function time(seconds: number, decimals = false) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const remainder = decimals ? (safe % 60).toFixed(1) : String(Math.floor(safe % 60)).padStart(2, "0");
  return `${minutes}:${decimals ? remainder.padStart(4, "0") : remainder}`;
}

function eventLabel(event: BenchTimelineEvent) {
  if (event.type === "agent.step") return `AI · turn ${event.turn ?? "—"} / step ${event.step ?? "—"}`;
  if (event.type.startsWith("tool.")) {
    const name = typeof event.payload.tool === "string" ? event.payload.tool : event.type.slice(5);
    return `TOOL · ${name}`;
  }
  return event.type.replaceAll(".", " ");
}

function eventKind(event: BenchTimelineEvent) {
  if (/failed|rejected|missed|holding|false_success/.test(event.type)) return "failure";
  if (event.type.startsWith("tool.")) return "tool";
  return "agent";
}

function waitForMetadata(audio: HTMLAudioElement) {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      audio.removeEventListener("loadedmetadata", ready);
      audio.removeEventListener("error", failed);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("Track stream unavailable")); };
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error("Track stream timed out")); }, 12_000);
    audio.addEventListener("loadedmetadata", ready, { once: true });
    audio.addEventListener("error", failed, { once: true });
  });
}

export default function BenchInspector({
  manifest,
  summary,
}: {
  manifest: BenchTimelineManifest;
  summary: { tokens: { total: number } };
}) {
  const duration = Math.max(manifest.targetDurationSec, manifest.achievedDurationSec, 1);
  const [setTimeSec, setSetTimeSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audioMessage, setAudioMessage] = useState("Ready — press play");
  const [selectedEventId, setSelectedEventId] = useState(
    manifest.events.find((event) => event.type === "agent.step")?.id ?? manifest.events[0]?.id ?? "",
  );
  const audioARef = useRef<HTMLAudioElement>(null);
  const audioBRef = useRef<HTMLAudioElement>(null);
  const audioRefs = useMemo(() => [audioARef, audioBRef] as const, []);
  const frameRef = useRef(0);
  const clockRef = useRef({ setTimeSec: 0, wallTimeMs: 0 });
  const activeKeyRef = useRef("");
  const generationRef = useRef(0);
  const selectedEvent = manifest.events.find(({ id }) => id === selectedEventId) ?? manifest.events[0];
  const activeSegments = audibleSegmentsAt(manifest.audibleSegments, setTimeSec);

  const evidenceEvents = useMemo(() => manifest.events.filter((event) =>
    event.type.startsWith("agent.") ||
    event.type.startsWith("playthrough.") ||
    event.type === "turn.started" ||
    event.type.startsWith("tool.") ||
    event.type.startsWith("transition.") ||
    /failed|rejected|missed|holding|false_success/.test(event.type),
  ), [manifest.events]);

  const eventLogRef = useRef<HTMLDivElement>(null);
  const eventRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedIdRef = useRef(selectedEventId);
  selectedIdRef.current = selectedEventId;

  const activeEventAt = useCallback((atSec: number): BenchTimelineEvent | undefined => {
    let active = evidenceEvents[0];
    for (const event of evidenceEvents) {
      if (event.setTimeSec > atSec) break;
      active = event;
    }
    return active;
  }, [evidenceEvents]);

  const gainAt = useCallback((segment: BenchAudibleSegment, atSec: number) => {
    const transition = manifest.transitions.find(
      (item) => atSec >= item.setStartSec && atSec < item.setEndSec &&
        (item.fromTrackId === segment.trackId || item.toTrackId === segment.trackId),
    );
    if (!transition) return 1;
    const progress = Math.max(0, Math.min(1,
      (atSec - transition.setStartSec) / Math.max(.01, transition.blendDurationSec),
    ));
    const gains = getCrossfaderGains(transition.performance.blend.crossfaderCurve, progress);
    return transition.fromTrackId === segment.trackId ? gains.outgoing : gains.incoming;
  }, [manifest.transitions]);

  const syncAudio = useCallback(async (atSec: number, shouldPlay: boolean) => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const segments = audibleSegmentsAt(manifest.audibleSegments, atSec).slice(-2);
    activeKeyRef.current = segments.map(({ id }) => id).join("|");
    setAudioMessage(segments.length ? "Loading SoundCloud streams" : "No audio at this timestamp");
    try {
      await Promise.all(audioRefs.map(async (ref, index) => {
        const audio = ref.current;
        const segment = segments[index];
        if (!audio) return;
        if (!segment) {
          audio.pause();
          audio.removeAttribute("src");
          audio.dataset.segmentId = "";
          return;
        }
        const nextSrc = `/api/tracks/${segment.trackId}/stream`;
        if (audio.dataset.segmentId !== segment.id) {
          audio.pause();
          audio.src = nextSrc;
          audio.dataset.segmentId = segment.id;
          audio.load();
        }
        audio.volume = 0;
        audio.playbackRate = segment.playbackRate;
        const playPromise = shouldPlay ? audio.play() : Promise.resolve();
        await Promise.all([waitForMetadata(audio), playPromise]);
        if (generationRef.current !== generation) return;
        audio.currentTime = Math.min(
          Math.max(0, audio.duration - .05),
          segmentSourceTime(segment, atSec),
        );
        audio.volume = gainAt(segment, atSec);
        if (!shouldPlay) audio.pause();
      }));
      if (generationRef.current === generation) setAudioMessage(segments.length > 1 ? "Two tracks crossfading" : "One track playing");
    } catch (cause) {
      if (generationRef.current === generation) {
        setPlaying(false);
        setAudioMessage(cause instanceof Error ? cause.message : "Audition unavailable");
      }
    }
  }, [audioRefs, gainAt, manifest.audibleSegments]);

  const seek = useCallback((next: number, select?: BenchTimelineEvent) => {
    const bounded = Math.max(0, Math.min(duration, next));
    setSetTimeSec(bounded);
    clockRef.current = { setTimeSec: bounded, wallTimeMs: performance.now() };
    setSelectedEventId(select?.id ?? activeEventAt(bounded)?.id ?? "");
    void syncAudio(bounded, playing);
    const url = new URL(window.location.href);
    url.searchParams.set("t", bounded.toFixed(1));
    if (select) url.searchParams.set("event", select.id);
    window.history.replaceState(null, "", url);
  }, [activeEventAt, duration, playing, syncAudio]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = Number(params.get("t"));
    const requestedEvent = params.get("event");
    if (Number.isFinite(initial) && initial >= 0) {
      const bounded = Math.min(duration, initial);
      setSetTimeSec(bounded);
      if (!requestedEvent) setSelectedEventId(activeEventAt(bounded)?.id ?? "");
    }
    if (requestedEvent && manifest.events.some(({ id }) => id === requestedEvent)) setSelectedEventId(requestedEvent);
  }, [activeEventAt, duration, manifest.events]);

  useEffect(() => {
    if (!playing) return;
    const tick = (now: number) => {
      const next = Math.min(duration,
        clockRef.current.setTimeSec + (now - clockRef.current.wallTimeMs) / 1_000,
      );
      setSetTimeSec(next);
      const active = activeEventAt(next);
      if (active && active.id !== selectedIdRef.current) setSelectedEventId(active.id);
      const segments = audibleSegmentsAt(manifest.audibleSegments, next).slice(-2);
      const key = segments.map(({ id }) => id).join("|");
      if (key !== activeKeyRef.current) void syncAudio(next, true);
      segments.forEach((segment, index) => {
        const audio = audioRefs[index].current;
        if (audio) audio.volume = gainAt(segment, next);
      });
      if (next >= duration) {
        setPlaying(false);
        audioRefs.forEach(({ current }) => current?.pause());
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [activeEventAt, audioRefs, duration, gainAt, manifest.audibleSegments, playing, syncAudio]);

  useEffect(() => () => {
    generationRef.current += 1;
    cancelAnimationFrame(frameRef.current);
    audioRefs.forEach(({ current }) => current?.pause());
  }, [audioRefs]);

  useEffect(() => {
    const list = eventLogRef.current;
    const row = eventRowRefs.current.get(selectedEventId);
    if (!list || !row) return;
    const target = row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2;
    list.scrollTop = Math.max(0, Math.min(list.scrollHeight - list.clientHeight, target));
  }, [selectedEventId]);

  const togglePlayback = async () => {
    if (playing) {
      setPlaying(false);
      audioRefs.forEach(({ current }) => current?.pause());
      return;
    }
    clockRef.current = { setTimeSec, wallTimeMs: performance.now() };
    setPlaying(true);
    await syncAudio(setTimeSec, true);
  };

  const ticks = Array.from({ length: Math.floor(duration / 600) + 1 }, (_, index) => index * 600);
  const payload = selectedEvent ? JSON.stringify(selectedEvent.payload, null, 2) : "No event selected";

  return <section className={styles.inspector}>
    <div className={styles.stage}>
      <div className={styles.transport}>
        <button type="button" onClick={togglePlayback}>{playing ? "Ⅱ Pause" : "▶ Play"}</button>
        <button type="button" onClick={() => seek(setTimeSec - 10)}>−10s</button>
        <button type="button" onClick={() => seek(setTimeSec + 10)}>+10s</button>
        <div className={styles.clock}><strong>{time(setTimeSec, true)}</strong> <span>/ {time(duration)}</span></div>
        <div className={styles.nowPlaying}><small>AUDIBLE NOW</small><b>{activeSegments.map(({ artist, title }) => `${artist ? `${artist} — ` : ""}${title}`).join(" × ") || "Silence / uncovered"}</b></div>
        <div className={styles.audioState}>{audioMessage}</div>
      </div>

      <div className={styles.timelineWrap}>
        <div className={styles.ruler}>{ticks.map((tick) => <span className={styles.tick} style={{ left: `${tick / duration * 100}%` }} key={tick}>{time(tick)}</span>)}</div>
        <div className={styles.timeline}>
          <span className={styles.laneLabel} style={{ top: 8 }}>TRACKS</span>
          <span className={styles.laneLabel} style={{ top: 117 }}>DECISIONS</span>
          {manifest.audibleSegments.map((segment, index) => <button
            className={styles.trackBlock}
            style={{ left: `${segment.setStartSec / duration * 100}%`, width: `${Math.max(.3, (segment.setEndSec - segment.setStartSec) / duration * 100)}%`, top: 25 + index % 2 * 47 }}
            type="button"
            onClick={(event) => { event.stopPropagation(); seek(segment.setStartSec); }}
            title={`${segment.artist ?? "Unknown"} — ${segment.title}`}
            key={segment.id}
          ><b>{segment.title}</b><small>{time(segment.setStartSec)} → {time(segment.setEndSec)}</small></button>)}
          {manifest.transitions.map((transition) => <button
            className={`${styles.marker} ${styles.transitionMarker}`}
            style={{ left: `${transition.setStartSec / duration * 100}%`, top: 106 }}
            type="button"
            title={`Transition ${transition.fromTrackId} → ${transition.toTrackId}`}
            aria-label={`Transition ${transition.fromTrackId} → ${transition.toTrackId}`}
            onClick={(event) => {
              event.stopPropagation();
              const evidence = evidenceEvents
                .filter((item) =>
                  item.type === "transition.accepted" && item.payload.trackId === transition.toTrackId,
                )
                .reduce<BenchTimelineEvent | undefined>((closest, item) =>
                  !closest ||
                  Math.abs(item.setTimeSec - transition.setStartSec) <
                    Math.abs(closest.setTimeSec - transition.setStartSec)
                    ? item
                    : closest,
                undefined);
              seek(Math.max(0, transition.setStartSec - 10), evidence);
            }}
            key={transition.id}
          />)}
          {evidenceEvents.map((event, index) => {
            const kind = eventKind(event);
            return <button
              className={`${styles.marker} ${kind === "failure" ? styles.failureMarker : kind === "tool" ? styles.toolMarker : ""} ${selectedEventId === event.id ? styles.selectedMarker : ""}`}
              style={{ left: `${event.setTimeSec / duration * 100}%`, top: 137 + index % 4 * 18 }}
              type="button"
              title={eventLabel(event)}
              aria-label={eventLabel(event)}
              onClick={(click) => { click.stopPropagation(); seek(event.setTimeSec, event); }}
              key={event.id}
            />;
          })}
          <div className={styles.playhead} style={{ left: `${setTimeSec / duration * 100}%` }} />
          <input className={styles.timelineInput} type="range" min={0} max={duration} step={.1} value={setTimeSec} aria-label="Set timestamp" onChange={(event) => seek(Number(event.target.value))} />
        </div>
      </div>

      <div className={styles.setMeta}>
        <div><small>Coverage</small><b>{time(manifest.achievedDurationSec)}</b></div>
        <div><small>Target</small><b>{time(manifest.targetDurationSec)}</b></div>
        <div><small>Tracks</small><b>{manifest.tracks.length}</b></div>
        <div><small>Transitions</small><b>{manifest.transitions.length}</b></div>
        <div><small>Tokens</small><b>{summary.tokens.total.toLocaleString()}</b></div>
      </div>

      <section className={styles.eventLog}>
        <h2>Timestamped evidence</h2>
        <div className={styles.eventRows} ref={eventLogRef}>{evidenceEvents.map((event) => <button
          className={styles.eventRow}
          type="button"
          aria-pressed={event.id === selectedEventId}
          onClick={() => seek(event.setTimeSec, event)}
          ref={(node) => {
            if (node) eventRowRefs.current.set(event.id, node);
            else eventRowRefs.current.delete(event.id);
          }}
          key={event.id}
        >
          <time>{time(event.setTimeSec, true)}</time><span>{eventLabel(event)}</span><small>{event.turn ? `T${event.turn}.${event.step ?? 0}` : `#${event.sequence}`}</small>
        </button>)}</div>
      </section>

      <audio ref={audioRefs[0]} preload="metadata" />
      <audio ref={audioRefs[1]} preload="metadata" />
    </div>

    <aside className={styles.evidence}>
      <header className={styles.evidenceHeader}><div><span>{selectedEvent ? time(selectedEvent.setTimeSec, true) : "—"}</span><h2>{selectedEvent ? eventLabel(selectedEvent) : "Evidence"}</h2></div><span>{selectedEvent ? `#${selectedEvent.sequence}` : ""}</span></header>
      <section className={styles.evidenceSection}><h3>Model text</h3><pre>{selectedEvent?.text?.trim() || "No model text returned in this step."}</pre></section>
      <section className={styles.evidenceSection}><h3>Provider reasoning</h3>{selectedEvent?.reasoningText?.trim() ? <pre>{selectedEvent.reasoningText}</pre> : <p className={styles.reasoningUnavailable}>Not returned by provider.</p>}</section>
      <section className={styles.evidenceSection}><h3>Messages, tools, results, state</h3><pre>{payload}</pre></section>
    </aside>
  </section>;
}
