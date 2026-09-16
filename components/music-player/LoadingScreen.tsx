"use client";

import React, { useEffect, useRef, useState } from "react";

import styles from "./LoadingScreen.module.css";

const FADE_OUT_MS = 700;
const TAU = Math.PI * 2;
const DOT_COUNT = 720;
const SWEEP_PERIOD_SEC = 3.4;
// Exponential smoothing rate (per second) for the displayed progress —
// raw progress moves in discrete chunks (per-asset file, engine ready,
// track cued), so the arc and counter are eased toward the target.
const PROGRESS_SMOOTHING_RATE = 3;

// Palette lifted from the BaseDiffusedRing shaders (components/Ring/base.tsx):
// cold/warm temperature mix, ember accents, near-white core.
type RGB = readonly [number, number, number];
const COLD: RGB = [87, 158, 255];
const WARM: RGB = [255, 71, 15];
const EMBER: RGB = [255, 173, 56];
const CORE: RGB = [240, 250, 255];

// Deterministic per-dot noise, mirrors hash21() in the ring shaders.
function hash(n: number) {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function createGlowSprite([r, g, b]: RGB): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = 64;
  const ctx = sprite.getContext("2d");
  if (!ctx) return sprite;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
  gradient.addColorStop(0.28, `rgba(${r},${g},${b},0.5)`);
  gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return sprite;
}

function angularDistance(a: number, b: number) {
  const d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
}

type Dot = {
  baseNorm: number;
  radialJitter: number;
  tangentialJitter: number;
  dust: number;
  size: number;
  phase: number;
};

function createDots(): Dot[] {
  return Array.from({ length: DOT_COUNT }, (_, i) => ({
    baseNorm: i / DOT_COUNT,
    radialJitter: Math.pow(hash(i * 3.7), 2.3) * (hash(i * 9.1) > 0.5 ? 1 : -1),
    tangentialJitter: (hash(i * 13.7) - 0.5) * 0.012,
    dust: 0.42 + 1.2 * hash(i * 5.3),
    size: Math.pow(hash(i * 7.7), 2.0),
    phase: hash(i * 11.3) * TAU,
  }));
}

/**
 * Full-screen boot overlay shown while the WebGL scene, the Superpowered
 * audio engine, and the first track settle. Renders a 2D-canvas homage to
 * the FFT diffused ring (idle white-blue dot cloud, cold sweep glint, warm
 * ember progress arc) and fades out once `visible` drops. Deliberately does
 * not touch WebGL — it must run while the three.js runtime is still booting.
 */
export function LoadingScreen({
  visible,
  progress,
  label,
}: {
  visible: boolean;
  progress: number;
  label: string;
}) {
  const [mounted, setMounted] = useState(visible);
  const [fading, setFading] = useState(!visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setFading(false);
      return;
    }
    setFading(true);
    const timeout = setTimeout(() => setMounted(false), FADE_OUT_MS);
    return () => clearTimeout(timeout);
  }, [visible]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(progress);
  const percentRef = useRef<HTMLSpanElement>(null);
  const redrawRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    if (!mounted) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const idleSprite = createGlowSprite(CORE);
    const coldSprite = createGlowSprite(COLD);
    const warmSprite = createGlowSprite(WARM);
    const emberSprite = createGlowSprite(EMBER);
    const dots = createDots();
    const start = performance.now();
    let raf = 0;
    let disposed = false;
    let smoothedProgress = 0;
    let lastFrameMs = start;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };

    const draw = (nowMs: number) => {
      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;
      const ringRadius = Math.min(width, height) * 0.3;
      const spriteScale = ringRadius / 170;
      const t = (nowMs - start) / 1000;

      // Ease the displayed progress toward the raw target (frame-rate
      // independent), snapping once it is close enough to settle.
      const targetProgress = clamp01(progressRef.current / 100);
      if (reducedMotion) {
        smoothedProgress = targetProgress;
      } else {
        smoothedProgress +=
          (targetProgress - smoothedProgress) *
          (1 - Math.exp(-((nowMs - lastFrameMs) / 1000) * PROGRESS_SMOOTHING_RATE));
        if (Math.abs(targetProgress - smoothedProgress) < 0.0008) {
          smoothedProgress = targetProgress;
        }
      }
      lastFrameMs = nowMs;
      if (percentRef.current) {
        percentRef.current.textContent = `${Math.round(smoothedProgress * 100)}%`;
      }
      const arcSpan = smoothedProgress * TAU;

      // Idle breathing, lifted from the ring's idle envelope.
      const idleEnvelope =
        0.042 +
        (Math.sin(t * 0.42) * 0.5 + 0.5) * 0.02 +
        (Math.sin(t * 1.07 + 0.8) * 0.5 + 0.5) * 0.016;
      const sweepAngle = ((t / SWEEP_PERIOD_SEC) % 1) * TAU;

      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";

      for (const dot of dots) {
        const theta = (dot.baseNorm * TAU + TAU * 1.25) % TAU; // start at top, clockwise
        const angle =
          dot.baseNorm * TAU +
          dot.tangentialJitter +
          idleEnvelope *
            0.05 *
            (Math.sin(t * 1.0 + dot.phase * 0.8) +
              0.65 * Math.sin(t * 1.9 + dot.phase * 0.6));

        // Warm arc (filled progress) with a hot ember head at the frontier.
        const filled = theta <= arcSpan ? 0.5 : 0;
        const headDistance = angularDistance(theta, arcSpan);
        const head = Math.exp(-Math.pow(headDistance / 0.14, 2)) * 0.9;
        // Cold radar sweep glint circling the ring.
        const sweepDistance = angularDistance(dot.baseNorm * TAU, sweepAngle);
        const sweep =
          Math.exp(-Math.pow(sweepDistance / 0.3, 2)) *
          (0.4 + 0.2 * Math.sin(t * 2.1 + dot.phase));

        const energy = clamp01(filled + head + sweep);
        const temperature = clamp01(filled * 1.4 + head);
        const sprite =
          energy < 0.04
            ? idleSprite
            : temperature > 0.6
              ? emberSprite
              : temperature > 0.2
                ? warmSprite
                : coldSprite;

        const radius =
          ringRadius *
          (1 +
            dot.radialJitter * (0.6 + idleEnvelope) +
            energy * 0.1 * (0.65 + 0.35 * Math.sin(t * 2.7 + dot.baseNorm * 28 + dot.phase)));
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        const sizePx =
          (1.2 + dot.size * 2.6) *
          spriteScale *
          (1 + energy * 0.8 + idleEnvelope * 0.6 * Math.sin(t * 5.4 + dot.phase * 1.2));

        ctx.globalAlpha = Math.min(1, dot.dust * (0.2 + energy * 0.8));
        ctx.drawImage(sprite, x - sizePx / 2, y - sizePx / 2, sizePx, sizePx);
        if (head > 0.45) {
          const corePx = sizePx * 0.55;
          ctx.globalAlpha = head * 0.9;
          ctx.drawImage(idleSprite, x - corePx / 2, y - corePx / 2, corePx, corePx);
        }
      }
      ctx.globalAlpha = 1;
    };

    redrawRef.current = () => draw(performance.now());
    resize();
    if (reducedMotion) {
      draw(start);
    } else {
      const loop = (nowMs: number) => {
        if (disposed) return;
        draw(nowMs);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    const observer = new ResizeObserver(() => {
      resize();
      if (reducedMotion) draw(start);
    });
    observer.observe(canvas);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      redrawRef.current = null;
    };
  }, [mounted]);

  // Redraw on progress changes (keeps the ring synced in reduced-motion mode).
  useEffect(() => {
    redrawRef.current?.();
  }, [progress]);

  if (!mounted) return null;

  return (
    <div
      className={`${styles.overlay} ${fading ? styles.overlayHidden : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className={styles.ringWrap}>
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
        <div className={styles.center}>
          <span ref={percentRef} className={styles.percent} aria-hidden="true" />
        </div>
      </div>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
