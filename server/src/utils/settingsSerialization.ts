const JSON_SETTING_KEYS = new Set([
  'hiddenDefaultCategoryIds',
  'categoryOrder',
  'customCategories',
  'sourceUsernames',
  'assetFilters',
  'collapsedSidebarCategoryCount',
]);

export function serializeSettingValue(key: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (JSON_SETTING_KEYS.has(key)) return JSON.stringify(value);
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function parseSettingValue(key: string, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (!JSON_SETTING_KEYS.has(key) || typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
