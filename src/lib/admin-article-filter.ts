/** Missing parameter preserves newest-50. Present but invalid never broadens. */
export function parseAdminArticleIds(search: string): string[] | null {
  const values = new URLSearchParams(search).getAll('articleIds');
  if (values.length === 0) return null;
  const invalid = () => new Error('Invalid articleIds filter. Provide 1–50 comma-separated UUIDs.');
  if (values.length !== 1 || values[0].length > 50 * 37 - 1) throw invalid();
  const ids = values[0].split(',');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (ids.length > 50 || ids.some(id => !uuid.test(id))) throw invalid();
  return [...new Set(ids.map(id => id.toLowerCase()))];
}
