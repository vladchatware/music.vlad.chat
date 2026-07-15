export async function closeAudioContextSafely(
  close: () => Promise<void>,
): Promise<void> {
  try {
    await close();
  } catch {
    // Safari may reject duplicate/StrictMode cleanup with AbortError.
  }
}

export function runDetached(
  task: Promise<unknown>,
  onRejected: (error: unknown) => void,
): void {
  void task.catch(onRejected);
}
