"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";

import ThemeToggle from "../(backroom)/ThemeToggle";
import styles from "../(backroom)/backroom.module.css";

export default function SignInGateway({ returnTo }: { returnTo: string }) {
  const { signIn } = useAuthActions();
  const [signingIn, setSigningIn] = useState(false);

  async function connectSoundCloud() {
    setSigningIn(true);
    try {
      await signIn("soundcloud", { redirectTo: returnTo });
    } finally {
      setSigningIn(false);
    }
  }

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
        <button
          className={styles.authButton}
          type="button"
          disabled={signingIn}
          onClick={connectSoundCloud}
        >
          {signingIn ? "Connecting…" : "Continue with SoundCloud →"}
        </button>
      </section>
    </main>
  );
}
