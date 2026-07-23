export function createDJToolCallBudget<TInput, TOptions, TOutput>(input: {
  toolName: string;
  maxCalls: number;
  execute: (toolInput: TInput, options: TOptions) => TOutput;
}) {
  let callCount = 0;
  return async (toolInput: TInput, options: TOptions) => {
    if (callCount >= input.maxCalls) {
      return {
        status: "tool_budget_exhausted" as const,
        toolName: input.toolName,
        instruction: "Reuse the results already returned and continue toward one player decision.",
      };
    }
    callCount += 1;
    return await input.execute(toolInput, options) as Awaited<TOutput>;
  };
}
