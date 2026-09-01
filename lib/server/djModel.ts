export const DEFAULT_DJ_MODEL = "zai/glm-5.3-flash";

export function resolveDJModel(value: string | undefined): string {
  const configured = value?.trim();
  return configured || DEFAULT_DJ_MODEL;
}
