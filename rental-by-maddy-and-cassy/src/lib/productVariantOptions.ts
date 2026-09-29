export function getProductColorOptions(specifications: Record<string, unknown>): string[] {
  const raw = specifications.colors ?? specifications.Color ?? "";
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
