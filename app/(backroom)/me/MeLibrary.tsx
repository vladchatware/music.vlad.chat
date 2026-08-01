"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  Disc3,
  Headphones,
  Heart,
  ListMusic,
  LoaderCircle,
  Pause,
  Play,
  Radio,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { streamTrack } from "@/lib/soundcloud";
import type { Playlist, SoundCloudMeLibrary, Track } from "@/soundcloud";

import ThemeToggle from "../ThemeToggle";
import styles from "./me.module.css";

type Section = "history" | "playlists" | "likes";

const sections: Array<{
  id: Section;
  label: string;
  shortLabel: string;
  icon: typeof Headphones;
}> = [
  { id: "history", label: "Recently played", shortLabel: "History", icon: Headphones },
  { id: "playlists", label: "Playlists", shortLabel: "Playlists", icon: ListMusic },
  { id: "likes", label: "Liked tracks", shortLabel: "Likes", icon: Heart },
];

function artwork(url?: string | null) {
  return url?.replace("-large.", "-t300x300.") ?? null;
}

function artist(track: Track) {
  return track.user?.username || track.user?.full_name || "Unknown artist";
}

function duration(value?: number) {
  if (!value) return "—";
  const seconds = Math.round(value / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function CopyIdButton({ id }: { id: number }) {
  const [copied, setCopied] = useState(false);

  async function copyId() {
    await navigator.clipboard.writeText(String(id));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button className={styles.copyButton} type="button" onClick={copyId}>
      {copied ? <Check size={13} /> : <Copy size={13} />}
      <span>{copied ? "Copied" : id}</span>
    </button>
  );
}

function Artwork({ track, index }: { track: Track; index: number }) {
  const source = artwork(track.artwork_url);
  return (
    <div className={styles.trackArt}>
      {source ? <img src={source} alt="" /> : <Disc3 aria-hidden="true" />}
      <span>{String(index + 1).padStart(2, "0")}</span>
    </div>
  );
}

function TrackRow({ track, index, onPlay, playingId }: {
  track: Track;
  index: number;
  onPlay: (id: number) => void;
  playingId: number | null;
}) {
  const isPlaying = playingId === track.id;

  return (
    <article className={styles.trackRow}>
      <Artwork track={track} index={index} />
      <div className={styles.trackIdentity}>
        <h3>{track.title}</h3>
        <p>{artist(track)}</p>
      </div>
      <div className={styles.trackMeta}>
        <span>{track.genre || "Unclassified"}</span>
        <span>{duration(track.duration)}</span>
      </div>
      <CopyIdButton id={track.id} />
      <div className={styles.trackActions}>
        <button type="button" onClick={() => onPlay(track.id)} title={isPlaying ? "Pause" : `Play ${track.title}`}>
          {isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
          <span>{isPlaying ? "Pause" : "Play"}</span>
        </button>
        <Link href={`/tracks/${track.id}/backroom`} title={`Analyze ${track.title}`}>
          <Radio size={14} />
          <span>Analyze</span>
        </Link>
      </div>
    </article>
  );
}

function TrackList({
  tracks,
  empty,
  onPlay,
  playingId,
}: {
  tracks: Track[];
  empty: string;
  onPlay: (id: number) => void;
  playingId: number | null;
}) {
  if (tracks.length === 0) {
    return (
      <div className={styles.emptyState}>
        <Disc3 />
        <p>{empty}</p>
      </div>
    );
  }

  return (
    <div className={styles.trackList}>
      {tracks.map((track, index) => (
        <TrackRow key={`${track.id}-${index}`} track={track} index={index} onPlay={onPlay} playingId={playingId} />
      ))}
    </div>
  );
}

function PlaylistCard({
  playlist,
  index,
  onPlay,
  playingId,
}: {
  playlist: Playlist;
  index: number;
  onPlay: (id: number) => void;
  playingId: number | null;
}) {
  const source = artwork(playlist.artwork_url ?? playlist.tracks?.[0]?.artwork_url);
  return (
    <details className={styles.playlistCard}>
      <summary>
        <div className={styles.playlistArt}>
          {source ? <img src={source} alt="" /> : <ListMusic aria-hidden="true" />}
          <span>{String(index + 1).padStart(2, "0")}</span>
        </div>
        <div className={styles.playlistIdentity}>
          <p>{playlist.type || "playlist"}</p>
          <h3>{playlist.title}</h3>
          <span>
            {playlist.track_count ?? playlist.tracks?.length ?? 0} tracks
            {playlist.duration ? ` · ${Math.round(playlist.duration / 3_600_000)} hr` : ""}
          </span>
        </div>
        <a
          className={styles.soundcloudLink}
          href={playlist.permalink_url}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          SoundCloud <ArrowUpRight size={13} />
        </a>
        <ChevronDown className={styles.chevron} size={18} />
      </summary>
      <div className={styles.playlistTracks}>
        {playlist.tracks?.length ? (
          playlist.tracks.map((track, trackIndex) => (
            <TrackRow
              key={`${playlist.id}-${track.id}-${trackIndex}`}
              track={track}
              index={trackIndex}
              onPlay={onPlay}
              playingId={playingId}
            />
          ))
        ) : (
          <div className={styles.emptyState}>
            <p>Track list unavailable from SoundCloud.</p>
          </div>
        )}
      </div>
    </details>
  );
}

function LibraryError({ retry }: { retry: () => void }) {
  return (
    <div className={styles.errorState}>
      <p className={styles.eyebrow}>SIGNAL LOST</p>
      <h1>Couldn’t read your record shelf.</h1>
      <p>SoundCloud may be rate-limiting requests or your session may need reconnecting.</p>
      <button type="button" onClick={retry}>
        <RefreshCw size={15} /> Try again
      </button>
    </div>
  );
}

export default function MeLibrary() {
  const { signIn } = useAuthActions();
  const [section, setSection] = useState<Section>("history");
  const [library, setLibrary] = useState<SoundCloudMeLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [requestKey, setRequestKey] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);

  function handlePlay(id: number) {
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    const src = streamTrack(id);
    if (!src) return;
    const audio = audioRef.current;
    if (audio) {
      audio.src = src;
      audio.play().catch(() => {});
      setPlayingId(id);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);

    fetch("/api/me/library", { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          await signIn("soundcloud", { redirectTo: "/me" });
          return null;
        }
        if (!response.ok) throw new Error(`Library request failed (${response.status})`);
        return response.json() as Promise<SoundCloudMeLibrary>;
      })
      .then((data) => {
        if (data) setLibrary(data);
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(true);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [requestKey, signIn]);

  const profile = library?.profile;
  const counts = {
    history: library?.historyAvailable === false ? 0 : library?.recentlyPlayed.length ?? 0,
    playlists: library?.playlists.length ?? profile?.playlist_count ?? 0,
    likes: library?.likes.length ?? profile?.likes_count ?? 0,
  };

  return (
    <main className={styles.library}>
      <div className={styles.noise} />
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/">
          MUSIC.VLAD.CHAT <b>●</b>
        </Link>
        <span className={styles.deskLabel}>PERSONAL RECORD INDEX</span>
        <nav>
          <Link href="/backroom">Analysis desk</Link>
          <a href={profile?.permalink_url ?? "https://soundcloud.com/you"} target="_blank" rel="noreferrer">
            SoundCloud <ArrowUpRight size={11} />
          </a>
        </nav>
        <ThemeToggle />
      </header>

      {error ? (
        <LibraryError retry={() => setRequestKey((value) => value + 1)} />
      ) : (
        <>
          <section className={styles.profile}>
            <div className={styles.avatar}>
              {profile?.avatar_url ? <img src={artwork(profile.avatar_url) ?? profile.avatar_url} alt="" /> : <Disc3 />}
            </div>
            <div className={styles.profileCopy}>
              <p className={styles.eyebrow}>
                {library?.source === "service_user"
                  ? "SOUNDCLOUD / DEV SERVICE USER"
                  : "SOUNDCLOUD / CONNECTED"}
              </p>
              <h1>{profile?.username ?? (loading ? "Reading your shelf…" : "Your records")}</h1>
              <div className={styles.profileMeta}>
                <span>{profile?.city || "Location private"}</span>
                <span>{profile?.followers_count?.toLocaleString() ?? "—"} followers</span>
                <span>{profile?.track_count?.toLocaleString() ?? "—"} uploads</span>
              </div>
            </div>
            <div className={styles.shelfMark} aria-hidden="true">
              <span>SC</span>
              <b>{new Date().getFullYear()}</b>
            </div>
          </section>

          <nav
            className={styles.sectionNav}
            aria-label="Your SoundCloud library"
            role="tablist"
          >
            {sections.map(({ id, label, shortLabel, icon: Icon }) => (
              <button
                key={id}
                id={`library-tab-${id}`}
                type="button"
                role="tab"
                aria-controls="library-tabpanel"
                aria-selected={section === id}
                onClick={() => setSection(id)}
              >
                <Icon size={17} />
                <span>{label}</span>
                <i>{shortLabel}</i>
                <b>{loading ? "—" : String(counts[id]).padStart(2, "0")}</b>
              </button>
            ))}
          </nav>

          <section
            id="library-tabpanel"
            className={styles.collection}
            role="tabpanel"
            aria-labelledby={`library-tab-${section}`}
          >
            <header className={styles.collectionHeader}>
              <span>0{sections.findIndex(({ id }) => id === section) + 1}</span>
              <div>
                <p>
                  {section === "history" && library?.historyAvailable !== false && "Last 25 plays, synced from SoundCloud"}
                  {section === "history" && library?.historyAvailable === false && "SoundCloud history requires a connected OAuth session"}
                  {section === "playlists" && "Your SoundCloud sets and their track IDs"}
                  {section === "likes" && "Most recent likes, ready to play or analyze"}
                </p>
                <h2>{sections.find(({ id }) => id === section)?.label}</h2>
              </div>
              <p className={styles.idHint}>
                <Copy size={12} />
                Tap any number to copy track ID
              </p>
            </header>

            {loading && !library ? (
              <div className={styles.loadingState}>
                <LoaderCircle className={styles.spinner} />
                <span>Reading SoundCloud library</span>
              </div>
            ) : null}

            {!loading && library && section === "history" ? (
              <TrackList
                tracks={library.recentlyPlayed}
                empty={
                  library.historyAvailable
                    ? "No recent SoundCloud plays found."
                    : "Play history unavailable with service user ID. Likes and playlists remain available."
                }
                onPlay={handlePlay}
                playingId={playingId}
              />
            ) : null}

            {!loading && library && section === "likes" ? (
              <TrackList tracks={library.likes} empty="No liked tracks found." onPlay={handlePlay} playingId={playingId} />
            ) : null}

            {!loading && library && section === "playlists" ? (
              library.playlists.length ? (
                <div className={styles.playlistList}>
                  {library.playlists.map((playlist, index) => (
                    <PlaylistCard key={`${playlist.id}-${index}`} playlist={playlist} index={index} onPlay={handlePlay} playingId={playingId} />
                  ))}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <ListMusic />
                  <p>No playlists found.</p>
                </div>
              )
            ) : null}
          </section>
        </>
      )}
      <audio ref={audioRef} preload="none" />
    </main>
  );
}
