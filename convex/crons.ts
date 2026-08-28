import { cronJobs } from "convex/server";
import { internal, api } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "Trial messages",
  { hourUTC: 17, minuteUTC: 30 },
  internal.users.resetMessages,
  {}
)

crons.weekly(
  "Trial tokens",
  { hourUTC: 17, minuteUTC: 30, dayOfWeek: 'sunday' },
  internal.users.resetTokens,
  {}
)

// Janitor sweep for the analysis queue: recovers expired leases and pushes
// ready jobs to the worker. Realtime dispatch is push-based (Vercel workflow
// -> worker /analysis/process); this only mops up retries and orphans.
crons.interval(
  "Analysis queue sweep",
  { minutes: 15 },
  internal.trackAnalysis.sweepPush,
  {}
)

export default crons;
