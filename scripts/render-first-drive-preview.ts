import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { PREPARED_FIRST_DRIVE_SCORE } from "../lib/dj/performance/preparedFirstDriveScore.generated";
import { resolveTrackStreamUrl } from "../soundcloud";

const root = resolve(import.meta.dir, "..");
const outputDir = resolve(root, "artifacts/dj-first-drive-preview");
const clipsDir = resolve(outputDir, "clips");
const previewWav = resolve(outputDir, "water-remembers-machine-60s.wav");
const previewMp3 = resolve(outputDir, "water-remembers-machine-60s.mp3");
const previewDurationSec = 60;

type PreviewFragment = {
  fragment: string;
  role: string;
  scoreStartSec: number;
  scoreEndSec: number;
  sourceId: string;
  cueStartSec: number;
  cueEndSec: number;
  gainDb: number;
  scoreSpec: string;
  edit: string;
};

function clockToSeconds(value: string) {
  const [minutes, seconds] = value.split(":");
  return Number(minutes) * 60 + Number(seconds);
}

function frequencyToHz(value: string) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(kHz|Hz)$/i);
  if (!match) throw new Error(`Invalid frequency ${value}`);
  return Number(match[1]) * (match[2].toLowerCase() === "khz" ? 1000 : 1);
}

function parseFragment(row: string): PreviewFragment | null {
  const identity = row.match(/^(F\d{3}) ([^|]+) \|/);
  const score = row.match(/\| @(\d{2}:\d{2}\.\d{3})>(\d{2}:\d{2}\.\d{3}) ([^|]+)/);
  const source = row.match(/\| src (\d+) —/);
  const cue = row.match(/\| cue s\d+ (?:subcue )?(\d+(?:\.\d+)?)–(\d+(?:\.\d+)?) s/);
  const edit = row.match(/\| edit (.+)$/);
  if (!identity || !score || !source || !cue || !edit) {
    throw new Error(`Cannot parse preview fragment: ${row.slice(0, 120)}`);
  }

  const scoreStartSec = clockToSeconds(score[1]);
  if (scoreStartSec >= previewDurationSec) return null;

  const gainMatch = score[3].match(/(-?\d+(?:\.\d+)?) dB/);
  if (!gainMatch) {
    throw new Error(`Missing explicit gain for ${identity[1]}`);
  }

  return {
    fragment: identity[1],
    role: identity[2].trim(),
    scoreStartSec,
    scoreEndSec: clockToSeconds(score[2]),
    sourceId: source[1],
    cueStartSec: Number(cue[1]),
    cueEndSec: Number(cue[2]),
    gainDb: Number(gainMatch[1]),
    scoreSpec: score[3],
    edit: edit[1],
  };
}

function clipFilters(fragment: PreviewFragment) {
  const filters: string[] = [];
  const hp = fragment.scoreSpec.match(/HP (\d+(?:\.\d+)?\s*(?:kHz|Hz))/i);
  const lp = fragment.scoreSpec.match(/LP (\d+(?:\.\d+)?\s*(?:kHz|Hz))/i);
  const bp = fragment.scoreSpec.match(
    /BP (\d+(?:\.\d+)?\s*(?:kHz|Hz))–(\d+(?:\.\d+)?\s*(?:kHz|Hz))/i,
  );

  if (bp) {
    filters.push(`highpass=f=${frequencyToHz(bp[1])}`);
    filters.push(`lowpass=f=${frequencyToHz(bp[2])}`);
  } else {
    if (hp) filters.push(`highpass=f=${frequencyToHz(hp[1])}`);
    if (lp) filters.push(`lowpass=f=${frequencyToHz(lp[1])}`);
  }
  if (fragment.scoreSpec.includes("3 dB low shelf cut")) {
    filters.push("equalizer=f=120:t=q:w=1:g=-3");
  }

  if (/left-channel|left channel/i.test(fragment.edit)) {
    filters.push("pan=stereo|c0=c0|c1=0*c1");
  } else if (/right-channel|right channel/i.test(fragment.edit)) {
    filters.push("pan=stereo|c0=0*c0|c1=c1");
  } else if (/\bmono\b/i.test(fragment.edit)) {
    filters.push("pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1");
  }

  const duration = fragment.cueEndSec - fragment.cueStartSec;
  filters.push(`volume=${fragment.gainDb}dB`);
  filters.push("afade=t=in:st=0:d=0.003");
  filters.push(`afade=t=out:st=${Math.max(0, duration - 0.003).toFixed(6)}:d=0.003`);
  return filters.join(",");
}

async function runFfmpeg(args: string[], label: string) {
  const process = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    const safeError = stderr.replace(/https?:\/\/\S+/g, "[stream-url]");
    throw new Error(`${label} failed (${exitCode}): ${safeError.slice(-1200)}`);
  }
}

async function renderClip(fragment: PreviewFragment) {
  const output = resolve(clipsDir, `${fragment.fragment}.wav`);
  if (await Bun.file(output).exists()) {
    console.log(`${fragment.fragment} cached`);
    return output;
  }
  const streamUrl = await resolveTrackStreamUrl(fragment.sourceId, undefined, 25_000);
  const privateTempDir = await mkdtemp(resolve(tmpdir(), "dj-preview-source-"));
  const sourceAudio = resolve(privateTempDir, "source-audio");
  try {
    const response = await fetch(streamUrl, { signal: AbortSignal.timeout(25_000) });
    if (!response.ok) {
      throw new Error(`${fragment.fragment} source download failed (${response.status})`);
    }
    await Bun.write(sourceAudio, response);
    await runFfmpeg(
      [
        "-ss",
        fragment.cueStartSec.toFixed(6),
        "-i",
        sourceAudio,
        "-t",
        (fragment.cueEndSec - fragment.cueStartSec).toFixed(6),
        "-vn",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-af",
        clipFilters(fragment),
        "-c:a",
        "pcm_s24le",
        output,
      ],
      fragment.fragment,
    );
  } finally {
    await rm(privateTempDir, { recursive: true, force: true });
  }
  console.log(`${fragment.fragment} ${fragment.sourceId} ready`);
  return output;
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  task: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        results[index] = await task(values[index]);
      }
    }),
  );
  return results;
}

async function main() {
  await mkdir(clipsDir, { recursive: true });
  const fragments = PREPARED_FIRST_DRIVE_SCORE.split("\n")
    .map(parseFragment)
    .filter((fragment): fragment is PreviewFragment => fragment !== null);

  console.log(`Rendering ${fragments.length} fragments`);
  const clips = await mapLimit(fragments, 3, renderClip);
  const inputs = clips.flatMap((clip) => ["-i", clip]);
  const delayed = fragments.map(
    (fragment, index) =>
      `[${index}:a]adelay=${Math.round(fragment.scoreStartSec * 1000)}|${Math.round(
        fragment.scoreStartSec * 1000,
      )}[a${index}]`,
  );
  const mixInputs = fragments.map((_, index) => `[a${index}]`).join("");
  const filterComplex = [
    ...delayed,
    `${mixInputs}amix=inputs=${fragments.length}:duration=longest:normalize=0,` +
      `atrim=0:${previewDurationSec},asetpts=N/SR/TB,` +
      "loudnorm=I=-14:TP=-1:LRA=11,aresample=48000," +
      "alimiter=limit=0.95,asplit=2[wav][mp3]",
  ].join(";");

  await runFfmpeg(
    [
      ...inputs,
      "-filter_complex",
      filterComplex,
      "-map",
      "[wav]",
      "-c:a",
      "pcm_s24le",
      previewWav,
      "-map",
      "[mp3]",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "320k",
      previewMp3,
    ],
    "timeline mix",
  );

  console.log(previewWav);
  console.log(previewMp3);
}

await main();
