import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchQuery } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import { rankTransitionCandidates, suggestTransitionWindows, type DJPerformancePlan } from "@/lib/dj";
import { TRACK_ANALYSIS_VERSION, type AnalysisSegment, type TrackAnalysis } from "@/lib/trackAnalysis";

import { refreshUserToken, track } from "@/soundcloud";

// In development with a service user, fetch a user token from the Convex
// HTTP endpoint to avoid rate-limiting the shared client-credentials auth.
let _cachedToken: { token: string; refreshToken: string; expiresAt: number } | undefined;
const SERVICE_TOKEN_CACHE_MS = 5 * 60_000;

async function serviceUserToken(): Promise<string | undefined> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt) return _cachedToken.token;
  if (_cachedToken?.refreshToken) {
    try {
      const refreshed = await refreshUserToken(_cachedToken.refreshToken);
      _cachedToken = {
        token: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: Date.now() + SERVICE_TOKEN_CACHE_MS,
      };
      return _cachedToken.token;
    } catch {
      _cachedToken = undefined;
    }
  }
  const secret = process.env.ANALYSIS_SERVICE_SECRET;
  const siteUrl = process.env.CONVEX_SITE_URL?.replace(/\/+$/, "").replace(/\/api$/, "");
  if (!secret || !siteUrl) return undefined;
  try {
    const res = await fetch(`${siteUrl}/soundcloud/service-credentials`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(
        process.env.SOUNDCLOUD_USER_ID
          ? { soundcloudUserId: process.env.SOUNDCLOUD_USER_ID }
          : {},
      ),
      cache: "no-store",
    });
    if (!res.ok) return undefined;
    const { accessToken, refreshToken } = await res.json() as { accessToken: string; refreshToken?: string | null };
    _cachedToken = {
      token: accessToken,
      refreshToken: refreshToken ?? "",
      expiresAt: Date.now() + SERVICE_TOKEN_CACHE_MS,
    };
    return accessToken;
  } catch {
    return undefined;
  }
}
import ThemeToggle from "../../../ThemeToggle";
import styles from "../../../backroom.module.css";
import PlaybackEnergyChart from "./PlaybackEnergyChart";
import MixSuggestions from "./MixSuggestions";
import MixCandidatePicker from "./MixCandidatePicker";
import { AnalysisEnqueue } from "./AnalysisEnqueue";
import { AnalysisRedoButton } from "./AnalysisRedoButton";

export const metadata: Metadata = { title: "Track Analysis / Revibe" };
const ENERGY_ARCS = ["preserve", "build", "release", "reset"] as const;

const number = (value: number | null | undefined, digits = 2) => value == null ? "—" : value.toFixed(digits);
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const percent = (value: number | null | undefined) => value == null ? "—" : `${Math.round(value * 100)}%`;
const dominantLabel = (values: Record<string, number> | null | undefined) => values
  ? Object.entries(values).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"
  : "—";

function average(segments: AnalysisSegment[], key: "energy" | "danceability" | "approachability" | "engagement" | "valence" | "arousal" | "vocalProbability") {
  const values = segments.map((segment) => segment[key]).filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function topLabels(segments: AnalysisSegment[], key: "mirexMood" | "themes" | "instruments" | "genres" | "timbre", limit = 6) {
  const totals = new Map<string, { total: number; count: number }>();
  for (const segment of segments) for (const [label, score] of Object.entries(segment[key] ?? {})) {
    const current = totals.get(label) ?? { total: 0, count: 0 };
    totals.set(label, { total: current.total + score, count: current.count + 1 });
  }
  return [...totals].map(([label, value]) => ({ label, score: value.total / value.count }))
    .sort((a, b) => b.score - a.score).slice(0, limit);
}

function Score({ label, value }: { label: string; value: number | null }) {
  return <div className={styles.score}>
    <div><span>{label}</span><strong>{percent(value)}</strong></div>
    <i style={{ "--score": value ?? 0 } as React.CSSProperties} />
  </div>;
}

function Labels({ title, labels }: { title: string; labels: Array<{ label: string; score: number }> }) {
  return <section className={styles.labelGroup}>
    <h3>{title}</h3>
    <div>{labels.length ? labels.map(({ label, score }) => <span key={label}>{label}<small>{Math.round(score * 100)}</small></span>) : <em>Not available</em>}</div>
  </section>;
}

export default async function TrackBackroom({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ with?: string; arc?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const incomingId = typeof query.with === "string" && /^\d+$/.test(query.with) && query.with !== id
    ? query.with
    : null;
  const energyArc: DJPerformancePlan["energyArc"] = ENERGY_ARCS.includes(query.arc as typeof ENERGY_ARCS[number])
    ? query.arc as DJPerformancePlan["energyArc"]
    : "preserve";
  const userToken = await serviceUserToken();
  const [soundcloudTrack, analysis, incomingTrack, incomingAnalysis, candidateAnalyses] = await Promise.all([
    track(id, userToken).catch(() => null),
    fetchQuery(api.trackAnalysis.getBySoundCloudId, { trackId: id, analysisVersion: TRACK_ANALYSIS_VERSION }).catch(() => null),
    incomingId ? track(incomingId, userToken).catch(() => null) : Promise.resolve(null),
    incomingId
      ? fetchQuery(api.trackAnalysis.getBySoundCloudId, { trackId: incomingId, analysisVersion: TRACK_ANALYSIS_VERSION }).catch(() => null)
      : Promise.resolve(null),
    fetchQuery(api.trackAnalysis.listCandidates, {
      excludeTrackId: id,
      analysisVersion: TRACK_ANALYSIS_VERSION,
      limit: 20,
    }).catch(() => []),
  ]);
  if (!soundcloudTrack && !analysis) notFound();

  const artwork = soundcloudTrack
    ? soundcloudTrack.artwork_url?.replace("-large", "-t500x500") ?? soundcloudTrack.user.avatar_url
    : null;
  const segments = analysis?.segments ?? [];
  const sections = analysis?.structure.sections ?? [];
  const suggestions = analysis && incomingAnalysis
    ? suggestTransitionWindows({ outgoing: analysis, incoming: incomingAnalysis, energyArc })
    : [];
  const validCandidates = candidateAnalyses.filter((candidate): candidate is TrackAnalysis => Array.isArray(candidate.segments));
  const rankedByArc = Object.fromEntries(ENERGY_ARCS.map((arc) => [arc, analysis
    ? rankTransitionCandidates({ outgoing: analysis, candidates: validCandidates, energyArc: arc, limit: 6 })
    : []
  ])) as Record<typeof ENERGY_ARCS[number], ReturnType<typeof rankTransitionCandidates>>;
  const candidateIds = [...new Set(ENERGY_ARCS.flatMap((arc) => rankedByArc[arc].map(({ analysis: candidate }) => candidate.sourceTrackId)))];
  const candidateMetadata = new Map(await Promise.all(candidateIds.map(async (candidateId) => [
    candidateId,
    await track(candidateId, userToken).catch(() => null),
  ] as const)));
  const candidatesByArc = Object.fromEntries(ENERGY_ARCS.map((arc) => [arc, rankedByArc[arc].map(({ analysis: candidate, suggestions: candidateSuggestions }) => {
    const metadata = candidateMetadata.get(candidate.sourceTrackId);
    return {
      track: {
        id: candidate.sourceTrackId,
        title: metadata?.title ?? `Track ${candidate.sourceTrackId}`,
        artist: metadata?.user.username ?? "SoundCloud archive",
        durationSec: candidate.durationSec,
        samples: candidate.energy.samples,
        sections: candidate.structure.sections,
        segments: candidate.segments,
      },
      artworkUrl: metadata
        ? metadata.artwork_url?.replace("-large", "-t500x500") ?? metadata.user.avatar_url
        : null,
      bpm: candidate.tempo.bpm,
      camelotKey: candidate.tonal.camelotKey ?? candidate.tonal.key,
      suggestions: candidateSuggestions,
    };
  })])) as Record<typeof ENERGY_ARCS[number], Array<{
    track: { id: string; title: string; artist: string; durationSec: number; samples: number[]; sections: TrackAnalysis["structure"]["sections"]; segments: TrackAnalysis["segments"] };
    artworkUrl: string | null;
    bpm: number;
    camelotKey: string;
    suggestions: ReturnType<typeof suggestTransitionWindows>;
  }>>;

  return <main className={styles.dashboard}>
    <div className={styles.noise} />
    <header className={styles.topbar}>
      <a href="/backroom" className={styles.brand}>REVIBE <b>ANALYSIS DESK</b></a>
      <form action="/backroom" className={styles.miniLookup}><input name="id" inputMode="numeric" placeholder="Track ID" /><button>Inspect</button></form>
      <ThemeToggle />
      <span className={analysis ? styles.ready : styles.pending}>{analysis ? analysis.analysisVersion : "analysis pending"}</span>
      {analysis && <AnalysisRedoButton trackId={id} />}
    </header>

    <section className={styles.hero}>
      <div className={styles.artwork}>
        {artwork ? <img src={artwork} alt="" /> : <div className={styles.artworkFallback} aria-hidden="true">SC</div>}
        <span>SC / {id}</span>
      </div>
      <div className={styles.identity}>
        <p>{soundcloudTrack ? `${soundcloudTrack.user.username} · ${soundcloudTrack.genre || "unclassified"}` : "SoundCloud archive · metadata unavailable"}</p>
        <h1>{soundcloudTrack?.title ?? `Track ${id}`}</h1>
        <div className={styles.sourceMeta}>
          {soundcloudTrack && <span>uploaded <b>{new Date(soundcloudTrack.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</b></span>}
          <span>duration <b>{time(soundcloudTrack ? soundcloudTrack.duration / 1000 : analysis!.durationSec)}</b></span>
          <span>streamable <b>{soundcloudTrack ? (soundcloudTrack.streamable ? "yes" : "no") : "unknown"}</b></span>
          {soundcloudTrack
            ? <a href={soundcloudTrack.permalink_url} target="_blank" rel="noreferrer">SoundCloud ↗</a>
            : <span className={styles.metadataUnavailable}>Live metadata could not be loaded</span>}
        </div>
      </div>
    </section>

    {!analysis ? <AnalysisEnqueue trackId={id} scheduled={false} /> : <>
      <section className={styles.metrics}>
        <article><small>TEMPO</small><strong>{number(analysis.tempo.bpm, 1)}</strong><span>BPM · {percent(analysis.tempo.confidence)} confidence</span></article>
        <article><small>TONAL CENTER</small><strong>{analysis.tonal.camelotKey ?? analysis.tonal.key}</strong><span>{analysis.tonal.key} {analysis.tonal.scale} · {percent(analysis.tonal.confidence)}</span></article>
        <article><small>DURATION</small><strong>{time(analysis.durationSec)}</strong><span>{analysis.tempo.beatsSec.length} beats · {analysis.tempo.downbeatsSec.length} downbeats</span></article>
        <article><small>MEAN ENERGY</small><strong>{percent(average(segments, "energy"))}</strong><span>{sections.length} sections · {segments.length} mix segments</span></article>
      </section>

      <section className={styles.plotSection}>
        <div className={styles.sectionHeading}><span>01</span><h2>Energy, structure & DJ map</h2><p>One clock for movement, phrase boundaries, and scored mix segments.</p></div>
        <PlaybackEnergyChart trackId={id} durationSec={analysis.durationSec} samples={analysis.energy.samples} sections={sections} segments={segments} playable={soundcloudTrack?.streamable !== false} />
        <div className={styles.cueSummary} style={{ marginTop: 28 }}>
          <div><small>MIX IN</small><strong>{time(analysis.cuePoints.mixInSec)}</strong></div>
          <div><small>MIX OUT</small><strong>{time(analysis.cuePoints.mixOutSec)}</strong></div>
          <p>{analysis.cuePoints.reason}<b>{percent(analysis.cuePoints.confidence)} confidence</b></p>
        </div>
        <div className={styles.segmentTable} role="table">
          <div className={styles.segmentHeader} role="row"><span>segment</span><span>time</span><span>energy</span><span>entry</span><span>exit</span><span>emotion</span></div>
          {segments.map((segment) => <div className={styles.segmentRow} role="row" key={segment.id}>
            <span><b>{segment.id}</b><small>{segment.section}</small></span>
            <span>{time(segment.startSec)}—{time(segment.endSec)}</span>
            <span>{percent(segment.energy)} <i className={segment.energySlope >= 0 ? styles.up : styles.down}>{segment.energySlope >= 0 ? "↗" : "↘"}</i></span>
            <span>{percent(segment.entryQuality)}</span>
            <span>{percent(segment.exitQuality)}</span>
            <span>{dominantLabel(segment.mirexMood)}</span>
          </div>)}
        </div>
      </section>

      <section className={styles.semanticSection}>
        <div className={styles.sectionHeading}><span>02</span><h2>Behavioral profile</h2><p>Movement, emotional position, and crowd-facing character.</p></div>
        <div className={styles.scoreGrid}>
          <Score label="danceability" value={average(segments, "danceability")} />
          <Score label="approachability" value={average(segments, "approachability")} />
          <Score label="engagement" value={average(segments, "engagement")} />
          <Score label="valence" value={average(segments, "valence")} />
          <Score label="arousal" value={average(segments, "arousal")} />
          <Score label="vocal presence" value={average(segments, "vocalProbability")} />
        </div>
      </section>

      <section className={styles.taxonomySection}>
        <div className={styles.sectionHeading}><span>03</span><h2>Semantic fingerprint</h2><p>Dominant evidence only. Low-signal classifier noise omitted.</p></div>
        <div className={styles.taxonomyGrid}>
          <Labels title="MIREX mood" labels={topLabels(segments, "mirexMood", 5)} />
          <Labels title="Mood / theme" labels={topLabels(segments, "themes")} />
          <Labels title="Genre / style" labels={topLabels(segments, "genres")} />
          <Labels title="Instruments" labels={topLabels(segments, "instruments")} />
          <Labels title="Timbre" labels={topLabels(segments, "timbre", 2)} />
        </div>
      </section>

      <section className={styles.mixSection}>
        <div className={styles.sectionHeading}><span>04</span><h2>{incomingId ? "Mix suggestions" : "Suggested next tracks"}</h2><p>{incomingId ? "Two source clocks. One shared transition window." : "Ranked by best available transition from this track."}</p></div>
        {!incomingId
          ? <MixCandidatePicker
              outgoing={{
                id,
                title: soundcloudTrack?.title ?? `Track ${id}`,
                artist: soundcloudTrack?.user.username ?? "SoundCloud archive",
                durationSec: analysis.durationSec,
                samples: analysis.energy.samples,
                sections: analysis.structure.sections,
                segments: analysis.segments,
              }}
              initialEnergyArc={energyArc}
              candidatesByArc={candidatesByArc}
            />
          : !incomingTrack && !incomingAnalysis
          ? <div className={styles.mixUnavailable}><b>TRACK NOT FOUND</b><p>Could not load incoming SoundCloud track {incomingId}.</p></div>
          : !incomingAnalysis
            ? <div className={styles.mixUnavailable}><b>INCOMING ANALYSIS PENDING</b><p><a href={`/tracks/${incomingId}/backroom`} style={{color: 'inherit'}}>Visit the incoming track's backroom</a> to analyze it.</p></div>
            : <MixSuggestions
                outgoing={{
                  id,
                  title: soundcloudTrack?.title ?? `Track ${id}`,
                  artist: soundcloudTrack?.user.username ?? "SoundCloud archive",
                  durationSec: analysis.durationSec,
                  samples: analysis.energy.samples,
                  sections: analysis.structure.sections,
                  segments: analysis.segments,
                }}
                incoming={{
                  id: incomingId,
                  title: incomingTrack?.title ?? `Track ${incomingId}`,
                  artist: incomingTrack?.user.username ?? "SoundCloud archive",
                  durationSec: incomingAnalysis.durationSec,
                  samples: incomingAnalysis.energy.samples,
                  sections: incomingAnalysis.structure.sections,
                  segments: incomingAnalysis.segments,
                }}
                energyArc={energyArc}
                suggestions={suggestions}
                candidatesByArc={candidatesByArc}
              />}
      </section>

      {(analysis.warnings.length > 0 || soundcloudTrack?.tag_list || !soundcloudTrack) && <footer className={styles.notes}>
        <div><small>WARNINGS</small>{analysis.warnings.length ? analysis.warnings.map((warning) => <p key={warning}>△ {warning}</p>) : <p>None</p>}</div>
        <div><small>SOUNDCLOUD SOURCE</small><p>{soundcloudTrack?.tag_list || (soundcloudTrack ? "No tags" : "Live metadata unavailable; showing stored analysis.")}</p></div>
        <div><small>PROCESSING</small><p>{(analysis.processingTimeMs / 1000).toFixed(1)}s · {analysis.semantic?.models.length ?? 0} models</p></div>
      </footer>}
    </>}
  </main>;
}
