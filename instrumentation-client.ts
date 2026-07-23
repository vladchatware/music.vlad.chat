import * as Sentry from "@sentry/nextjs";
import { addPlaybackTelemetrySink } from "@/lib/playbackDebug";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  enableLogs: true,
  enableMetrics: true,
});

const playbackGlobal = globalThis as typeof globalThis & {
  __musicPlaybackSentrySinkInstalled?: boolean;
};

const metricNumber = (payload: Record<string, unknown> | undefined, key: string) => {
  const value = payload?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const metricString = (payload: Record<string, unknown> | undefined, key: string) => {
  const value = payload?.[key];
  return typeof value === "string" && value.length > 0 ? value : "unknown";
};

const recordPlaybackMetrics = (event: string, payload?: Record<string, unknown>) => {
  if (event === "engine.transition.outcome") {
    const outcome = metricString(payload, "transitionOutcome");
    const abrupt = payload?.isAbruptTransition === true;
    const executedEnergyArc = metricString(payload, "executedEnergyArc");
    const arcContradiction = payload?.arcContradiction === true;
    Sentry.metrics.count("playback.transition", 1, {
      attributes: { outcome, abrupt, executed_energy_arc: executedEnergyArc, arc_contradiction: arcContradiction },
    });
    const mismatch = metricNumber(payload, "handoffEnergyMismatch");
    if (mismatch !== undefined) {
      Sentry.metrics.distribution("playback.transition.energy_mismatch", mismatch, {
        attributes: { outcome },
      });
    }
    const energyDelta = metricNumber(payload, "executedEnergyDelta");
    if (energyDelta !== undefined) {
      Sentry.metrics.distribution("playback.transition.energy_delta", energyDelta, {
        attributes: { outcome, executed_energy_arc: executedEnergyArc },
      });
    }
    const incomingEnergyRise = metricNumber(payload, "incomingEnergyRise");
    if (incomingEnergyRise !== undefined) {
      Sentry.metrics.distribution("playback.transition.incoming_energy_rise", incomingEnergyRise, {
        attributes: { outcome },
      });
    }
    return;
  }

  if (event === "engine.crossfade.starting") {
    const timingDrift = metricNumber(payload, "timingDriftSec");
    const duration = metricNumber(payload, "effectiveCrossfadeDurationSec");
    if (timingDrift !== undefined) {
      Sentry.metrics.distribution("playback.transition.timing_drift", timingDrift, {
        unit: "second",
      });
    }
    if (duration !== undefined) {
      Sentry.metrics.distribution("playback.transition.crossfade_duration", duration, {
        unit: "second",
      });
    }
    return;
  }

  if (event === "engine.listening.segment") {
    const duration = metricNumber(payload, "durationSec");
    if (duration !== undefined) {
      Sentry.metrics.distribution("playback.listening_segment.duration", duration, {
        unit: "second",
      });
    }
    return;
  }

  if (event === "client.fetch_track.response") {
    const duration = metricNumber(payload, "elapsedMs");
    const status = metricNumber(payload, "status") ?? 0;
    const statusClass = status > 0 ? `${Math.floor(status / 100)}xx` : "unknown";
    Sentry.metrics.count("playback.track_fetch", 1, {
      attributes: { status_class: statusClass, ok: payload?.ok === true },
    });
    if (duration !== undefined) {
      Sentry.metrics.distribution("playback.track_fetch.duration", duration, {
        unit: "millisecond",
        attributes: { status_class: statusClass },
      });
    }
    return;
  }

  if (event === "engine.deck.stalled" || event === "engine.deck.waiting") {
    Sentry.metrics.count("playback.buffer_event", 1, {
      attributes: { type: event.endsWith("stalled") ? "stalled" : "waiting" },
    });
    return;
  }

  if (event === "engine.stream.preview_suspected") {
    Sentry.metrics.count("playback.preview_suspected", 1);
    return;
  }

  if (event === "engine.deck.hold_loop" || event === "engine.performance.loop") {
    Sentry.metrics.count("ai.dj.loop_event", 1, {
      attributes: {
        type: event === "engine.deck.hold_loop" ? "emergency_hold" : "model_performance_loop",
        outcome: "failed_handoff",
      },
    });
    return;
  }

  if (event === "chat.tool_call.player_outcome") {
    Sentry.metrics.count("ai.dj.player_outcome", 1, {
      attributes: { outcome: metricString(payload, "outcome") },
    });
    return;
  }

  if (event === "dj.agent_session.closed" || event === "dj.agent_session.failed") {
    Sentry.metrics.count("ai.dj.session_outcome", 1, {
      attributes: {
        outcome:
          metricString(payload, "terminal") !== "unknown"
            ? metricString(payload, "terminal")
            : metricString(payload, "reason"),
      },
    });
  }
};

if (!playbackGlobal.__musicPlaybackSentrySinkInstalled) {
  addPlaybackTelemetrySink((entry) => {
    const attributes = {
      event: entry.event,
      session_id: entry.sessionId,
      sequence: entry.sequence,
      ...(entry.elapsedMs === undefined ? {} : { elapsed_ms: entry.elapsedMs }),
      ...(entry.chatSessionId ? { conversation_id: entry.chatSessionId } : {}),
      ...(entry.turnId ? { turn_id: entry.turnId } : {}),
      ...(entry.payload ? { payload: JSON.stringify(entry.payload).slice(0, 8_000) } : {}),
    };
    const isFailure = /error|failed|rejected|unhandled|hold_loop|performance\.loop/i.test(entry.event);
    if (isFailure) Sentry.logger.error(`Playback: ${entry.event}`, attributes);
    else Sentry.logger.info(`Playback: ${entry.event}`, attributes);
    recordPlaybackMetrics(entry.event, entry.payload);
  });
  playbackGlobal.__musicPlaybackSentrySinkInstalled = true;
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
