export const FRUTIGER_AERO_OPENING_TRACKS = [
  { id: 151178937, title: "Microsound 1", duration: 296_228, bpm: 93.77, genre: "ambient" },
  { id: 442660944, title: "Chilled Vocal Chops", duration: 243_733, bpm: 100.04, genre: "Vocal" },
  { id: 719940274, title: "The Book Of Love", duration: 208_222, bpm: 106.61 },
  { id: 719940358, title: "The Luckiest Guy On The Lower East Side", duration: 151_954, bpm: 116.61 },
  { id: 1455949876, title: "frutiger aero mix", duration: 479_751, bpm: 126.86, genre: "Dance & EDM" },
  { id: 2090688897, title: "Frutiger Aero - Inuyasha", duration: 130_171, bpm: 129.87, genre: "Electronic" },
  { id: 2297410625, title: "Bad News", duration: 185_680, bpm: 126.90, genre: "Dance & EDM" },
  { id: 2043553060, title: "frutiger aero (bitcrushed)", duration: 133_142, bpm: 129.97, genre: "Soundtrack" },
  { id: 2046558748, title: "amirthetrash — frutiger aero", duration: 133_853, bpm: 129.97, genre: "Soundtrack" },
  { id: 2220048569, title: "Vengeance WIP", duration: 246_312, bpm: 140.99, genre: "Dubstep" },
  { id: 719940229, title: "The One You Really Love", duration: 162_508, bpm: 178.21 },
] as const;

export const FRUTIGER_AERO_OPENING_TRACK_IDS = FRUTIGER_AERO_OPENING_TRACKS.map(
  ({ id }) => id,
);

export const FRUTIGER_AERO_PREPARED_OPENER_ANALYSIS = {
  trackId: "151178937",
  durationSec: 296.228,
  warnings: [],
  tempo: {
    bpm: 93.77,
    confidence: 0.23,
    firstDownbeatSec: 0,
    downbeatConfidence: 0.23,
  },
  tonal: {
    camelotKey: "5B",
    confidence: 0.91,
  },
  energy: {
    mean: 0.68,
    peak: 1,
    entry: 0.478,
    exit: 0.4,
  },
  cuePoints: {
    confidence: 0.7,
    mixInSec: 0,
    mixOutSec: 272,
    reason: "prepared full-track Frutiger Aero opener",
  },
} as const;

export const FRUTIGER_AERO_PREPARED_CONTEXT = String.raw`
PREPARED FRUTIGER AERO CRATE

This is researched opening context for the regular two-deck player. Exact
unplayed IDs advertised in CURRENT LIVE DJ STATE
performanceMemory.candidateTrackIds are ready full-track candidates. Choose
from them and call player immediately; do not repeat discovery first.

ORDERED OPENING ARC (about 40 minutes of source audio)
151178937 | Microsound 1 | 296s | 93.77 BPM | 5B | mean energy .68 | water origin
442660944 | Chilled Vocal Chops | 244s | 100.04 BPM | 12B | mean energy .71 | airy human trace
719940274 | The Book Of Love | 208s | 106.61 BPM | 9B | mean energy .76 | whimsical false sun
719940358 | The Luckiest Guy On The Lower East Side | 152s | 116.61 BPM | 1B | mean energy .84 | bright wistful rise
1455949876 | frutiger aero mix | 480s | 126.86 BPM | 7A | mean energy .61 | long-form body
2090688897 | Frutiger Aero - Inuyasha | 130s | 129.87 BPM | 4A | mean energy .63 | aquatic pulse
2297410625 | Bad News | 186s | 126.90 BPM | 4A | mean energy .85 | same-key melodic crest
2043553060 | frutiger aero (bitcrushed) | 133s | 129.97 BPM | 8B | mean energy .68 | digital glint
2046558748 | amirthetrash — frutiger aero | 134s | 129.97 BPM | 8B | mean energy .68 | same-key reflection
2220048569 | Vengeance WIP | 246s | 140.99 BPM | 11B | mean energy .75 | vocal-chop pressure
719940229 | The One You Really Love | 163s | 178.21 BPM | 2A | mean energy .73 | half-time bright release

The order is a composed energy/tempo arc, not a mandate to ignore the outgoing
deck. Prefer the earliest unplayed compatible source. Preserve tempo across
deliberate reset edges; never force more than 8 percent tempo adjustment.

GOOD DECISION SHAPE
When the outgoing evidence supports a steady 4A handoff, a suitable decision is
player id 2090688897 with preserve energy and a short musical reason. In the
prepared-selection turn output only id, energyArc, and reason; runtime hydrates
safe anchors, blend, and tempo mechanics. Adapt the ID and energy arc to the
actual live outgoing deck; the example teaches decisiveness, not a fixed choice.

CONTINUITY CONTRACT
The opening crate avoids cold-start research. After accepting a track, prepare
successor evidence while it plays. Replenish before fewer than four unplayed
candidates remain. Never wait for analysis when ready metadata can support a
credible choice.
`;
