export function hasValidCandidatePreparation(input: {
  preparedOpening: boolean;
  likesCalls: number;
  tracksCalls: number;
}): boolean {
  return input.preparedOpening || (input.likesCalls > 0 && input.tracksCalls > 0);
}

export function benchInvalidReason(input: {
  terminalError: string | null;
  runtimeStarted: boolean;
  outgoingTrackLoaded: boolean;
}): string | null {
  if (input.runtimeStarted && input.outgoingTrackLoaded) return null;
  return input.terminalError
    ? `Infrastructure failed before performance runtime started: ${input.terminalError}`
    : "Infrastructure failed before performance runtime started";
}
