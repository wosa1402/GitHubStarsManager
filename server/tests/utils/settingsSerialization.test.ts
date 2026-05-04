import { describe, expect, it } from 'vitest';
import { parseSettingValue, serializeSettingValue } from '../../src/utils/settingsSerialization.js';

describe('settings serialization', () => {
  it('serializes and parses array settings', () => {
    const serialized = serializeSettingValue('sourceUsernames', ['alice', 'bob']);

    expect(serialized).toBe('["alice","bob"]');
    expect(parseSettingValue('sourceUsernames', serialized)).toEqual(['alice', 'bob']);
  });

  it('keeps plain string settings as strings', () => {
    expect(serializeSettingValue('activeAIConfig', 'config-1')).toBe('config-1');
    expect(parseSettingValue('activeAIConfig', 'config-1')).toBe('config-1');
  });

  it('round-trips numeric JSON settings', () => {
    const serialized = serializeSettingValue('collapsedSidebarCategoryCount', 12);

    expect(serialized).toBe('12');
    expect(parseSettingValue('collapsedSidebarCategoryCount', serialized)).toBe(12);
  });
});
