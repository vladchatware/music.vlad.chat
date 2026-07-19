type PlayerEntryAction =
  | "continue"
  | "ignore"
  | "loadAndPlay"
  | "signInAndContinue"
  | "togglePlayback";

type PlayerEntryContext = {
  isAutoRequest: boolean;
  isAuthenticated: boolean | undefined;
  needsUserInteraction: boolean;
  hasTrack: boolean;
};

export function getPlayerEntryAction({
  isAutoRequest,
  isAuthenticated,
  needsUserInteraction,
  hasTrack,
}: PlayerEntryContext): PlayerEntryAction {
  if (needsUserInteraction) {
    if (isAutoRequest) return "ignore";
    return hasTrack ? "togglePlayback" : "loadAndPlay";
  }

  if (isAuthenticated === false) {
    return isAutoRequest ? "ignore" : "signInAndContinue";
  }

  return "continue";
}
