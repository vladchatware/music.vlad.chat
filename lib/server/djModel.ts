export const DEFAULT_DJ_MODEL = "deepseek/deepseek-v4-flash";

export function resolveDJModel(value: string | undefined): string {
  const configured = value?.trim();
  return configured || DEFAULT_DJ_MODEL;
}
