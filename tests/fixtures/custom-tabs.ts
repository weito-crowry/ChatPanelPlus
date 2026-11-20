import type { ExtensionSettings } from '../../src/shared/settings.ts';

export const CUSTOM_TAB_ID = 'custom-tab-123e4567-e89b-42d3-a456-426614174001';
export const CUSTOM_BUTTON_IDS = Array.from({ length: 10 }, (_, index) =>
  `custom-123e4567-e89b-42d3-a456-4266141740${String(index + 10).padStart(2, '0')}`);

export function customTabSettings(): ExtensionSettings {
  const customButtons = Object.fromEntries(CUSTOM_BUTTON_IDS.map((id, index) => [id, index < 7
    ? { groupId: CUSTOM_TAB_ID, label: `Synthetic ${index + 1}`, color: '#123456', visible: true, kind: 'insert', text: `Synthetic text ${index + 1}` }
    : { groupId: index === 7 ? 'always' : 'directive', label: `Standard ${index + 1}`, color: '#654321', visible: true, kind: 'insert', text: `Standard text ${index + 1}` }])) as ExtensionSettings['customButtons'];
  const customOrder = CUSTOM_BUTTON_IDS.slice(0, 7);
  return {
    schemaVersion: 1,
    customTabs: {
      [CUSTOM_TAB_ID]: { label: 'Synthetic tab', visible: true, futureField: { retained: true } },
    },
    customButtons,
    buttonOrder: {
      [CUSTOM_TAB_ID]: customOrder,
      always: [CUSTOM_BUTTON_IDS[7]!],
      directive: [CUSTOM_BUTTON_IDS[8]!, CUSTOM_BUTTON_IDS[9]!],
    },
    tabOrder: ['directive', CUSTOM_TAB_ID, 'wall'],
    tabOverrides: { directive: { visible: false }, [CUSTOM_TAB_ID]: { visible: false, futureFlag: true } },
  };
}
