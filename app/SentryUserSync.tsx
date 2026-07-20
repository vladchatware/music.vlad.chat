"use client";

import * as Sentry from "@sentry/nextjs";
import { useQuery } from "convex/react";
import { useEffect } from "react";

import { api } from "@/convex/_generated/api";

export function SentryUserSync() {
  const user = useQuery(api.users.viewer);

  useEffect(() => {
    if (user === undefined) return;

    Sentry.setUser(user ? { id: String(user._id) } : null);
  }, [user]);

  return null;
}
