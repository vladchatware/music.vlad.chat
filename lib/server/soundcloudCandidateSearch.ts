type SearchQuery = {
  q: string;
  genres?: string;
  tags?: string;
  [key: string]: unknown;
};

type Candidate = { id: number };

function splitDescriptors(value?: string) {
  return (value ?? "")
    .split(/[,;/|]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

const GENERIC_SEARCH_WORDS = new Set([
  "find",
  "gem",
  "gems",
  "hidden",
  "matching",
  "music",
  "similar",
  "song",
  "songs",
  "track",
  "tracks",
]);

function descriptorsFromQuery(value: string) {
  const words = value
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((word) => word.length >= 3 && !GENERIC_SEARCH_WORDS.has(word)) ?? [];
  const cleanedPhrase = words.join(" ");
  const originalPhrase = value.toLowerCase().trim().replace(/\s+/g, " ");
  return [
    ...(cleanedPhrase && cleanedPhrase !== originalPhrase ? [cleanedPhrase] : []),
    ...words,
  ];
}

export function buildRelaxedTrackQueries(query: SearchQuery): SearchQuery[] {
  const explicitDescriptors = [
    ...splitDescriptors(query.tags),
    ...splitDescriptors(query.genres),
  ];
  const descriptors = explicitDescriptors.length > 0
    ? explicitDescriptors
    : descriptorsFromQuery(query.q);
  const unique = [...new Set(descriptors.map((value) => value.toLowerCase()))].slice(0, 5);
  return [
    { q: query.q },
    ...unique.map((q) => ({ q })),
  ];
}

function isBadRequest(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error && error.status === 400;
}

export async function searchTrackCandidates<T extends Candidate>(opts: {
  query: SearchQuery;
  search: (query: SearchQuery) => Promise<T[]>;
  isPlayable: (candidate: T) => boolean;
  excludeIds?: readonly number[];
  desiredCount: number;
}) {
  const excluded = new Set(opts.excludeIds ?? []);
  const candidates = new Map<number, T>();
  const add = (items: T[]) => {
    for (const item of items) {
      if (!excluded.has(item.id) && opts.isPlayable(item)) candidates.set(item.id, item);
    }
  };

  try {
    add(await opts.search(opts.query));
  } catch (error) {
    if (!isBadRequest(error)) throw error;
  }
  if (candidates.size >= opts.desiredCount) return [...candidates.values()];

  const fallbackResults = await Promise.all(
    buildRelaxedTrackQueries(opts.query).map((query) => opts.search(query)),
  );
  for (const result of fallbackResults) add(result);
  return [...candidates.values()];
}
