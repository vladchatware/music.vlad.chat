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

export default crons;
