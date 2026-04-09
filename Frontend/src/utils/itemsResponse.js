/**
 * GET /api/items kabhi direct array, kabhi { items: [] } de sakta hai;
 * error body par bhi safe rehna chahiye.
 */
export function itemsArrayFromApiResponse(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray(data.items)) return data.items;
  return [];
}
