import type { StreamTextTransform, ToolSet } from "ai";

/**
 * Some OpenAI-compatible reasoning models occasionally emit a delta without
 * the matching start event. AI SDK treats that as a fatal stream error. Repair
 * only the missing envelope; the model's text and tool events remain unchanged.
 */
export function repairMissingStreamPartStarts<
  TOOLS extends ToolSet,
>(): StreamTextTransform<TOOLS> {
  return () => {
    const activeTextIds = new Set<string>();
    const activeReasoningIds = new Set<string>();

    const reset = () => {
      activeTextIds.clear();
      activeReasoningIds.clear();
    };

    return new TransformStream({
      transform(part, controller) {
        if (part.type === "start-step" || part.type === "finish-step") {
          reset();
        }

        if (part.type === "text-start") {
          activeTextIds.add(part.id);
        } else if (part.type === "text-delta" && !activeTextIds.has(part.id)) {
          activeTextIds.add(part.id);
          controller.enqueue({
            type: "text-start",
            id: part.id,
            providerMetadata: part.providerMetadata,
          });
        } else if (part.type === "text-end") {
          if (!activeTextIds.has(part.id)) {
            controller.enqueue({
              type: "text-start",
              id: part.id,
              providerMetadata: part.providerMetadata,
            });
          }
          activeTextIds.delete(part.id);
        }

        if (part.type === "reasoning-start") {
          activeReasoningIds.add(part.id);
        } else if (
          part.type === "reasoning-delta" &&
          !activeReasoningIds.has(part.id)
        ) {
          activeReasoningIds.add(part.id);
          controller.enqueue({
            type: "reasoning-start",
            id: part.id,
            providerMetadata: part.providerMetadata,
          });
        } else if (part.type === "reasoning-end") {
          if (!activeReasoningIds.has(part.id)) {
            controller.enqueue({
              type: "reasoning-start",
              id: part.id,
              providerMetadata: part.providerMetadata,
            });
          }
          activeReasoningIds.delete(part.id);
        }

        controller.enqueue(part);
      },
    });
  };
}
