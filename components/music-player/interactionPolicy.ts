type PlayerEntryAction =
  | "continue"
  | "ignore"
  | "loadAndPlay"
  | "loadPlayAndSignIn"
  | "signInAndContinue"
  | "togglePlayback"
  | "togglePlaybackAndSignIn";

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
    if (isAuthenticated === false) {
      return hasTrack ? "togglePlaybackAndSignIn" : "loadPlayAndSignIn";
    }
    return hasTrack ? "togglePlayback" : "loadAndPlay";
  }

  if (isAuthenticated === false) {
    return "signInAndContinue";
  }

  return "continue";
}
