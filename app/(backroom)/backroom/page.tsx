import { redirect } from "next/navigation";

import { parseSoundCloudUrl, resolveTrackUrl } from "@/soundcloud";

import ThemeToggle from "../ThemeToggle";
import styles from "../backroom.module.css";

function lookupErrorMessage(error: unknown): string {
  const status = (error as { status?: number }).status;
  const resolvedKind = (error as { resolvedKind?: string }).resolvedKind;
  if (resolvedKind) return `That link points to a SoundCloud ${resolvedKind}, not a track.`;
  if (status === 404) return "No public SoundCloud track lives at that link.";
  if (status === 401 || status === 403) return "SoundCloud refused the lookup. Check the service credentials.";
  if (status === 429) return "SoundCloud rate limit reached. Try again in a minute.";
  return "Couldn't resolve that link. Paste a public SoundCloud track URL.";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  let lookupError: string | undefined;
  let redirectTo: string | undefined;

  if (id && /^\d+$/.test(id)) {
    redirectTo = `/tracks/${id}/backroom`;
  } else if (id) {
    const url = parseSoundCloudUrl(id);
    if (!url) {
      lookupError = "That doesn't look like a SoundCloud link. Paste a track URL (or a numeric track ID).";
    } else {
      try {
        const resolved = await resolveTrackUrl(url);
        redirectTo = `/tracks/${resolved.id}/backroom`;
      } catch (error) {
        lookupError = lookupErrorMessage(error);
      }
    }
  }
  // redirect() throws internally, so it must stay outside the try/catch above.
  if (redirectTo) redirect(redirectTo);

  return (
    <main className={styles.landing}>
      <div className={styles.noise} />
      <div className={styles.landingTheme}><ThemeToggle /></div>
      <a className={styles.libraryLink} href="/me">My records →</a>
      <section className={styles.lookupPanel}>
        <p className={styles.eyebrow}>REVIBE / ANALYSIS DESK</p>
        <h1>Read the record<br />before the room.</h1>
        <p className={styles.lede}>
          Inspect timing, structure, emotion, texture, and DJ-safe entry points from one analyzed SoundCloud track.
        </p>
        <form className={styles.lookup} action="/backroom">
          <label htmlFor="track-id">SoundCloud track URL</label>
          <div>
            <input id="track-id" name="id" type="text" inputMode="url" autoComplete="off" placeholder="https://soundcloud.com/artist/track" required />
            <button type="submit">Open analysis →</button>
          </div>
        </form>
        {lookupError && <p role="alert" style={{ color: "var(--amber)", marginTop: 14 }}>{lookupError}</p>}
      </section>
      <aside className={styles.landingIndex} aria-hidden="true">
        <span>01 / TEMPO</span><span>02 / EMOTION</span><span>03 / TEXTURE</span><span>04 / CUES</span>
      </aside>
    </main>
  );
}
