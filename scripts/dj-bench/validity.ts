export function hasValidCandidatePreparation(input: {
  preparedOpening: boolean;
  likesCalls: number;
  tracksCalls: number;
}): boolean {
  return input.preparedOpening || (input.likesCalls > 0 && input.tracksCalls > 0);
}
