export function benchInvalidReason(options: {
  terminalError: string | null;
  mcpFailures: number;
}): string | null {
  if (options.mcpFailures > 0) {
    return `${options.mcpFailures} MCP tool failure(s)`;
  }
  if (!options.terminalError) return null;
  if (/^Turn \d+ ended without accepted transition$/.test(options.terminalError)) {
    return null;
  }
  return options.terminalError;
}
