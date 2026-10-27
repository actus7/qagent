/**
 * Inserts the item, or replaces the stored item with the same id. A new item is refused once the list holds `limit`.
 */
export function upsertById<T extends { id: string }>(items: T[], item: T, limit: number, limitError: string): T[] {
  if (items.some(existing => existing.id === item.id)) {
    return items.map(existing => (existing.id === item.id ? item : existing));
  }
  if (items.length >= limit) {
    throw new Error(limitError);
  }
  return [...items, item];
}
