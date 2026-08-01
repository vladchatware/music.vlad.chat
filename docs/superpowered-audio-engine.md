# Superpowered audio engine

## Status

Main music player now uses a Superpowered WebAssembly transport. React, Zustand state, transition
planner, queue behavior, AI tools, diagnostics, and visualization components remain in place.
`HTMLAudioElement`, `MediaElementAudioSourceNode`, browser seeking, browser `playbackRate`, and
main-thread crossfader gain updates are no longer part of the primary player.

Backroom analysis preview tools still use native `<audio>` elements. They are separate preview
surfaces, not the live AI DJ transport.

## Runtime architecture

```text
React / AI state machine
        |
        v
AudioEngine interface
        |
        v
SuperpoweredDJMixerProcessor (AudioWorklet)
   |                         |
AdvancedAudioPlayer A   AdvancedAudioPlayer B
   |                         |
ThreeBandEQ A           ThreeBandEQ B
          \               /
       sample-clock crossfader
                |
           Compressor
                |
             Limiter
                |
 AudioContext.destination + broadcast MediaStream
```

Track download and decode run through `Superpowered.downloadAndDecode`. Decoded
`AudioInMemory` data is opened by one `AdvancedAudioPlayer` per deck. The worklet owns playheads,
seeking, looping, tempo, pitch, deck gain, transition curves, EQ, compression, limiting, and
transition completion.

React receives low-rate telemetry for UI and analysis. Telemetry does not drive audio scheduling.

## Files

- `components/music-player/audio-engine/types.ts` — engine contract
- `components/music-player/audio-engine/superpoweredEngine.ts` — main-thread command bridge
- `public/audio/superpowered/dj-mixer-processor.js` — real-time worklet/DSP
- `public/audio/superpowered/Superpowered.js` — pinned Superpowered 2.7.2 browser helper
- `public/audio/superpowered/superpowered.wasm` — pinned production WASM asset

The package and self-hosted runtime assets must stay on the same Superpowered version.

## Configuration and licensing

Public deployments require:

```env
NEXT_PUBLIC_SUPERPOWERED_LICENSE_KEY=<registered Superpowered JS license>
```

Localhost falls back to Superpowered's evaluation key for private testing. Evaluation licensing
does not allow public release. The engine intentionally fails on non-local hosts when the production
key is absent.

The key is passed to a browser SDK and is therefore public client configuration, despite its name.
Register and restrict it according to the Superpowered account settings.

## Supported commands

The engine contract exposes:

- deck load, play, pause, stop, seek, and cue
- finite or indefinite loops
- independent tempo and pitch
- deck sync and temporary tempo bend
- deck gain and three-band EQ
- clock-based gain/EQ automation
- atomic two-deck transition scheduling
- playback position, beat position, and device latency
- subscription to load, state, end, error, and transition events
- deterministic disposal

Current AI plans still compile into existing transition plans. `scheduleTransition` translates one
plan into one worklet command; audio execution no longer depends on animation frames.

## Browser and deployment requirements

- HTTPS or localhost is required for AudioWorklet.
- Chromium, Firefox, and Safari must serve `.wasm` as `application/wasm`.
- SoundCloud stream redirects must remain fetchable with CORS because Superpowered decodes through
  a worker instead of a media element.
- iOS/Safari still requires a user gesture before `AudioContext.resume()`. `play()` performs resume.
- Tracks are decoded into memory. Very long tracks increase per-deck memory use; progressive decode
  is a later optimization, not part of this migration.

## Verification

Run focused transport and DJ tests:

```bash
bunx vitest run components/music-player/audio-engine components/music-player/engine lib/dj/__tests__
```

Run type checking:

```bash
bunx tsc --noEmit
```

For browser acceptance, verify:

1. First play resumes from a user gesture.
2. Deck A loads, starts, pauses, seeks, and resumes.
3. Deck B loads without interrupting deck A.
4. Tempo matching changes speed without pitch drift.
5. A transition starts once, follows selected curve, and leaves incoming deck at unity.
6. Broadcast output contains the same limited master mix.
7. End-of-track continuity loop and next-track request still fire.
8. Refresh/disposal creates no duplicate output or orphaned audio context.
