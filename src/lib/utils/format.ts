export function humanizeCategory(category: string): string {
  if (!category) return "";
  const spaced = category.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
