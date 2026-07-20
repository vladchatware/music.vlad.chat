import { fetchMutation } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import { stripe } from "@/lib/stripe";

type DJUser = {
  isAnonymous?: boolean;
  stripeId?: string;
  email?: string;
  trialMessages?: number;
  trialTokens?: number;
  tokens?: number;
};

type Usage = {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

export async function checkDJAccess(user: DJUser, token: string | undefined) {
  if (process.env.NODE_ENV === "development") return null;
  if (user.isAnonymous) {
    return (user.trialMessages ?? 0) > 0
      ? null
      : { message: "no more messages left", status: 429 };
  }

  if (!user.stripeId) {
    const customer = await stripe.customers.create({ email: user.email });
    await fetchMutation(api.users.connect, { stripeId: customer.id }, { token });
  }
  return (user.trialTokens ?? 0) > 0 || (user.tokens ?? 0) > 0
    ? null
    : { message: "out of tokens", status: 429 };
}

export async function recordDJUsage(
  user: DJUser,
  token: string | undefined,
  model: string,
  usage: Usage,
): Promise<void> {
  if (user.isAnonymous) {
    await fetchMutation(api.users.messages, {}, { token });
    return;
  }
  await fetchMutation(api.users.usage, {
    usage,
    model: model.replace(/^openai\//, ""),
    provider: "AI Gateway",
  }, { token });
}
