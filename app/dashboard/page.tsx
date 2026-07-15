import { redirect } from "next/navigation";

import ThemeToggle from "./ThemeToggle";
import styles from "./dashboard.module.css";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  if (id && /^\d+$/.test(id)) redirect(`/dashboard/tracks/${id}`);

  return (
    <main className={styles.landing}>
      <div className={styles.noise} />
      <div className={styles.landingTheme}><ThemeToggle /></div>
      <section className={styles.lookupPanel}>
        <p className={styles.eyebrow}>REVIBE / ANALYSIS DESK</p>
        <h1>Read the record<br />before the room.</h1>
        <p className={styles.lede}>
          Inspect timing, structure, emotion, texture, and DJ-safe entry points from one analyzed SoundCloud track.
        </p>
        <form className={styles.lookup} action="/dashboard">
          <label htmlFor="track-id">SoundCloud track ID</label>
          <div>
            <input id="track-id" name="id" inputMode="numeric" pattern="[0-9]+" placeholder="2248709558" required />
            <button type="submit">Open analysis →</button>
          </div>
        </form>
      </section>
      <aside className={styles.landingIndex} aria-hidden="true">
        <span>01 / TEMPO</span><span>02 / EMOTION</span><span>03 / TEXTURE</span><span>04 / CUES</span>
      </aside>
    </main>
  );
}
