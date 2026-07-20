# Backroom mix transition suggestions

Status: implemented MVP

## Outcome

Given one analyzed SoundCloud track, Backroom ranks analyzed next-track candidates. Picking one shows concrete transition windows on both timelines:

```text
OUTGOING  Track A  3:12-3:28
INCOMING  Track B  0:32-0:48  at +2.1%
BLEND              16.0s / 8 bars
```

User can see where both tracks overlap, why pairing works, and two alternative windows.

## Existing foundation

- `TrackAnalysis.segments` provides four-bar-aligned ranges, entry/exit quality, energy, slope, rhythmic density, vocals, mood, and confidence.
- `scoreSegmentPair` scores outgoing/incoming segment compatibility for `preserve`, `build`, `release`, and `reset` arcs.
- Tempo matcher provides feasibility, target playback rate, phase offset, and confidence.
- Harmonic matcher provides Camelot compatibility.
- Backroom already fetches stored analysis and renders an interactive energy timeline.

Missing piece is not only UI: no pure API currently ranks full transition-window candidates for two arbitrary analyses. Live `compilePerformancePlan` ranks incoming segments only after an outgoing exit and current playback position already exist.

## Entry and URL

Render `Suggested next tracks` automatically after DJ map.

- Rank up to six current-version analyzed tracks by their best transition window.
- Picking candidate keeps current track as outgoing and navigates to `/tracks/:id/backroom?with=:incomingId&arc=preserve`.
- `Swap` reverses outgoing and incoming IDs.
- `arc` accepts `preserve`, `build`, `release`, or `reset`; invalid values fall back to `preserve`.
- URL remains shareable and refresh-safe.
- Specific SoundCloud ID remains secondary fallback under disclosure.

No separate compare route for MVP.

## UI

When `with` is absent, fetch bounded current-version analysis catalog, rank candidates by best window, fetch metadata for top six, and show cards containing track identity, exact outgoing/incoming ranges, BPM, key, score, and reason. First candidate loads into persistent incoming deck automatically. Candidate, energy-arc, and window selection use client state plus `history.replaceState`; no page navigation.

When `with` is present:

1. Fetch metadata and current-version analysis for both tracks in parallel.
2. Render `05 / Mix suggestions` after DJ map.
3. Show paired track headers, `Swap`, and energy-arc selector.
4. Reuse full energy/structure timeline for outgoing and incoming decks. Show DJ segment boundaries in a second ruler below structural sections, highlight selected segment and source-time range, and snap both playheads to their starts.
5. Show exact `m:ss-m:ss` range beside each row, wall-clock blend duration, bars, incoming tempo adjustment, key relationship, and overall score.
6. Show three ranked suggestions total. Selecting alternative snaps both mounted deck playheads without navigation.
7. Show concise reason assembled from strongest score signals, for example `matched energy · safe cues · compatible key`.

Persistent deck transport plays both streams from current suggestion, tempo-adjusts incoming track, and runs an equal-power crossfade for the suggested wall duration. During the blend, both playheads project from one wall clock so their normalized window positions cannot drift. At blend completion, outgoing pauses at zero gain while incoming continues playing to let the user hear the transition resolve.

## Domain function

Add pure module `lib/dj/segments/suggestions.ts`:

```ts
type TransitionSuggestionInput = {
  outgoing: TrackAnalysis;
  incoming: TrackAnalysis;
  energyArc: DJPerformancePlan["energyArc"];
  limit?: number;
};

type TransitionWindow = {
  startSec: number;
  endSec: number;
  segmentId: string;
  section: PhraseType;
};

type TransitionSuggestion = {
  id: string;
  outgoing: TransitionWindow;
  incoming: TransitionWindow;
  wallDurationSec: number;
  bars: number;
  incomingPlaybackRate: number;
  tempo: TempoMatchResult;
  harmonic: HarmonicScore;
  segment: SegmentPairScore;
  score: number;
  reasons: string[];
};

function suggestTransitionWindows(
  input: TransitionSuggestionInput,
): TransitionSuggestion[];
```

Export from existing DJ barrel.

## Candidate generation

- Treat every outgoing segment start as possible crossfade start and every incoming segment start as possible entry.
- Segments already start on analyzed four-bar boundaries. Use their stored boundaries; do not resnap and introduce drift.
- Run `matchTempo` once per track pair using analysis beat grids.
- Exclude tempo-infeasible pairs.
- Exclude windows shorter than one bar after media-bound clamping.
- Requested overlap is four outgoing bars for MVP. `wallDurationSec = min(outgoing four-bar duration, incoming available duration / incomingPlaybackRate, 32)`.
- Outgoing source window is `[outStart, outStart + wallDurationSec]`.
- Incoming source window is `[inStart, inStart + wallDurationSec * incomingPlaybackRate]`.
- Clamp both ends to track duration. Reject candidate if clamping makes either side shorter than one outgoing bar of wall time.
- Score each pair with `scoreSegmentPair(outgoing, incoming, energyArc)`.
- Overall score: `segment.overall * 0.60 + harmonic.compatibility * 0.20 + tempo.confidence * 0.20`.
- Sort descending. Tie-break by higher cue quality, then higher confidence, then earlier incoming start, then later outgoing start.
- Return at most `limit ?? 3` candidates. Avoid duplicates with identical outgoing and incoming segment IDs.

Track-level cue points remain fallback evidence, not forced windows. Segment pairing is more specific.

## Data/loading states

- Both ready: compute and render suggestions server-side; interactive selection stays client-side.
- Incoming metadata missing: show `Track not found`; preserve outgoing analysis.
- Incoming analysis missing: enqueue at high priority, show `Analysis scheduled`, and offer refresh. Do not synthesize a low-confidence suggestion.
- No feasible pair: show reason category: tempo incompatible, analysis incomplete, or no usable runway.
- Warnings remain visible per track when they affect confidence.

No new database table or API route needed. Bounded `listCandidates` Convex query uses analysis-version index. Suggestions are deterministic derived data.

## Accessibility and responsive behavior

- Timeline choices are buttons with full range and score in accessible name.
- Color is not sole distinction: label rows `OUT` and `IN`, use different fill patterns/borders.
- Mobile stacks track rows but keeps range labels visible.
- Score details use native disclosure control or button with `aria-expanded`.

## Tests

Unit tests for `suggestTransitionWindows`:

- ranks energy-preserving pair above mismatched pair;
- changes ranking for `build`, `release`, and `reset`;
- incorporates harmonic and tempo quality;
- rejects infeasible tempo match;
- converts incoming wall duration to source duration using playback rate;
- clamps media bounds and rejects sub-bar runway;
- returns deterministic ordering and limit;
- handles absent semantic values through existing neutral scoring.

Component tests:

- ranks candidate tracks and excludes current track;
- lists only current analysis version from catalog;
- parses and validates `with` and `arc`;
- renders exact two-track ranges and tempo adjustment;
- switches among three suggestions;
- swaps direction;
- shows pending, missing, and no-feasible-pair states.

## Acceptance criteria

- Opening single-track Backroom shows up to six ranked next-track suggestions without requesting another ID.
- Picking candidate opens up to three deterministic windows for that pair.
- Each suggestion shows outgoing range, incoming range, blend duration/bars, tempo adjustment, harmonic relationship, score, and reason.
- Highlighted timeline regions match displayed source-time ranges within 0.1 seconds.
- Both playheads remain synchronized to the same normalized blend progress.
- Incoming playback continues after the crossfade until the user stops it or the track ends.
- Reversing tracks recomputes results; it does not relabel same suggestion.
- Existing single-track Backroom behavior and playback remain unchanged.
- No suggestion renders unless both analyses use current `TRACK_ANALYSIS_VERSION`.
- Unit and component suites pass under `bun run test:run`.

## Later, not MVP

- choose 4/8/16-bar blend length;
- drag window boundaries;
- save/share selected suggestion independently from query URL;
- open selected suggestion in live player as compiled performance intent.
