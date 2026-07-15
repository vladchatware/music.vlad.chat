import type { UIMessage } from "ai";

export function compactDJMessages(messages: UIMessage[]): UIMessage[] {
  let start = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      start = index;
      break;
    }
  }

  return messages.slice(start).map((message) => ({
    ...message,
    parts: message.parts.filter((part) =>
      part.type !== "reasoning" &&
      part.type !== "source-url" &&
      part.type !== "source-document"
    ),
  }));
}
