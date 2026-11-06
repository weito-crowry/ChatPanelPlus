import {
  resolveDefaultUI,
  DEFAULT_BUTTONS,
  DEFAULT_TABS,
  type ButtonAction,
  type ButtonGroupId,
  type ButtonId,
  type CustomButtonDefinition,
  type CustomButtonId,
  type CustomTabId,
  type TabId,
} from '../../src/shared/default-ui.ts';
import { DEFAULT_SETTINGS, type ExtensionSettings } from '../../src/shared/settings.ts';

export type OptionsGroup = Readonly<{ id: ButtonGroupId; label: string }>;
export type PreviewButton = Readonly<{ id: ButtonId; label: string; color: string }>;
export type PreviewTab = Readonly<{ id: TabId; label: string; buttons: readonly PreviewButton[] }>;
export type LayoutPreview = Readonly<{
  alwaysButtons: readonly PreviewButton[];
  tabs: readonly PreviewTab[];
}>;

export type CustomButtonOperation = 'insert' | ButtonAction;

function groupIds(settings: ExtensionSettings): ButtonGroupId[] {
  return ['always', ...resolveDefaultUI(settings).tabs.map(({ id }) => id)];
}

function normalizedButtonOrder(settings: ExtensionSettings, group: ButtonGroupId): ButtonId[] {
  return resolveDefaultUI(settings).buttons
    .filter((button) => button.groupId === group)
    .map(({ id }) => id);
}

function withButtonOrder(
  settings: ExtensionSettings,
  group: ButtonGroupId,
  ids: readonly ButtonId[],
): ExtensionSettings {
  return { ...settings, buttonOrder: { ...(settings.buttonOrder ?? {}), [group]: ids } };
}

function swapItem<T extends string>(ids: T[], id: T, delta: -1 | 1): T[] | undefined {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return undefined;
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  return ids;
}

function moveBefore<T extends string>(ids: T[], draggedId: T, targetId: T): T[] | undefined {
  const from = ids.indexOf(draggedId);
  if (from < 0 || !ids.includes(targetId)) return undefined;
  if (draggedId === targetId) return ids;
  ids.splice(from, 1);
  ids.splice(ids.indexOf(targetId), 0, draggedId);
  return ids;
}

export function getOptionsGroups(settings: ExtensionSettings = DEFAULT_SETTINGS): readonly OptionsGroup[] {
  return [
    { id: 'always', label: '常時表示ボタン' },
    ...resolveDefaultUI(settings).tabs.map(({ id, label }) => ({ id, label })),
  ];
}

export function moveTabOrder(
  settings: ExtensionSettings,
  id: TabId,
  delta: -1 | 1,
): ExtensionSettings {
  const ids = resolveDefaultUI(settings).tabs.map(({ id: tabId }) => tabId);
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return settings;
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  return { ...settings, tabOrder: ids };
}

export function moveButtonOrder(
  settings: ExtensionSettings,
  group: ButtonGroupId,
  id: ButtonId,
  delta: -1 | 1,
): ExtensionSettings {
  const ids = swapItem(normalizedButtonOrder(settings, group), id, delta);
  return ids ? withButtonOrder(settings, group, ids) : settings;
}

export function reorderButtonBefore(
  settings: ExtensionSettings,
  group: ButtonGroupId,
  draggedId: ButtonId,
  targetId: ButtonId,
): ExtensionSettings {
  const ids = moveBefore(normalizedButtonOrder(settings, group), draggedId, targetId);
  return ids ? withButtonOrder(settings, group, ids) : settings;
}

export function createCustomButton(
  settings: ExtensionSettings,
  id: CustomButtonId,
  definition: CustomButtonDefinition,
): ExtensionSettings {
  if (settings.customButtons?.[id]) return settings;
  const ids = normalizedButtonOrder(settings, definition.groupId);
  return {
    ...settings,
    customButtons: { ...(settings.customButtons ?? {}), [id]: definition },
    buttonOrder: { ...(settings.buttonOrder ?? {}), [definition.groupId]: [...ids, id] },
  };
}

export function updateCustomButton(
  settings: ExtensionSettings,
  id: CustomButtonId,
  field: 'visible' | 'label' | 'color' | 'text' | 'insertionMode',
  value: boolean | string,
): ExtensionSettings {
  const definition = settings.customButtons?.[id];
  if (!definition
    || ((field === 'text' || field === 'insertionMode') && definition.kind !== 'insert')
    || (field === 'insertionMode' && value !== 'beginning' && value !== 'caret')) return settings;
  return {
    ...settings,
    customButtons: {
      ...settings.customButtons,
      [id]: { ...definition, [field]: value } as CustomButtonDefinition,
    },
  };
}

export function changeCustomButtonOperation(
  settings: ExtensionSettings,
  id: CustomButtonId,
  operation: CustomButtonOperation,
): ExtensionSettings {
  const definition = settings.customButtons?.[id];
  if (!definition) return settings;
  if (operation === definition.kind || (definition.kind === 'action' && operation === definition.action)) return settings;
  const common = {
    groupId: definition.groupId,
    label: definition.label,
    color: definition.color,
    visible: definition.visible,
  };
  const replacement: CustomButtonDefinition = operation === 'insert'
    ? { ...common, kind: 'insert', text: '' }
    : { ...common, kind: 'action', action: operation };
  return { ...settings, customButtons: { ...settings.customButtons, [id]: replacement } };
}

export function deleteCustomButton(settings: ExtensionSettings, id: CustomButtonId): ExtensionSettings {
  if (!settings.customButtons?.[id]) return settings;
  const customButtons = { ...settings.customButtons };
  delete customButtons[id];
  const buttonOrder = Object.fromEntries(Object.entries(settings.buttonOrder ?? {}).map(([group, ids]) => [
    group,
    ids.filter((buttonId) => buttonId !== id),
  ]));
  return {
    ...settings,
    customButtons,
    ...(Object.keys(buttonOrder).length ? { buttonOrder } : { buttonOrder: undefined }),
  };
}

export function resetSettingsPreservingCustomButtons(settings: ExtensionSettings): ExtensionSettings {
  const customButtons = settings.customButtons ?? {};
  const customTabs = settings.customTabs ?? {};
  const currentOrder = resolveDefaultUI(settings).buttons;
  const buttonOrder = Object.fromEntries(groupIds(settings).map((group) => [
    group,
    [
      ...DEFAULT_BUTTONS.filter((button) => button.groupId === group).map(({ id }) => id),
      ...currentOrder.filter((button) => button.groupId === group && button.id.startsWith('custom-')).map(({ id }) => id),
    ],
  ]));
  return {
    ...DEFAULT_SETTINGS,
    ...(Object.keys(customTabs).length ? { customTabs, tabOrder: [...DEFAULT_TABS.map(({ id }) => id), ...resolveDefaultUI(settings).tabs.filter(({ id }) => id.startsWith('custom-tab-')).map(({ id }) => id)] } : {}),
    ...(Object.keys(customButtons).length ? { customButtons } : {}),
    buttonOrder,
  };
}

export function mergeImportedSettings(
  imported: ExtensionSettings,
  current: ExtensionSettings,
): ExtensionSettings {
  let merged: ExtensionSettings = {
    ...imported,
    ...(!Object.prototype.hasOwnProperty.call(imported, 'customTabs') && current.customTabs ? { customTabs: current.customTabs } : {}),
    ...(!Object.prototype.hasOwnProperty.call(imported, 'builtinButtonGroupOverrides') && current.builtinButtonGroupOverrides
      ? { builtinButtonGroupOverrides: current.builtinButtonGroupOverrides } : {}),
  };
  if (!Object.prototype.hasOwnProperty.call(imported, 'customTabs') && current.customTabs) {
    merged = {
      ...merged,
      tabOrder: [
        ...resolveDefaultUI(imported).tabs.filter(({ id }) => !id.startsWith('custom-tab-')).map(({ id }) => id),
        ...resolveDefaultUI(current).tabs.filter(({ id }) => id.startsWith('custom-tab-')).map(({ id }) => id),
      ],
    };
  }
  if (Object.prototype.hasOwnProperty.call(imported, 'customButtons')) return merged;
  const customButtons = current.customButtons;
  if (!customButtons || Object.keys(customButtons).length === 0) return merged;
  const importedUI = resolveDefaultUI(merged);
  const currentUI = resolveDefaultUI(current);
  const buttonOrder = Object.fromEntries(groupIds(merged).map((group) => [
    group,
    [
      ...importedUI.buttons.filter((button) => button.groupId === group && !button.id.startsWith('custom-')).map(({ id }) => id),
      ...currentUI.buttons.filter((button) => button.groupId === group && button.id.startsWith('custom-')).map(({ id }) => id),
    ],
  ]));
  return { ...merged, customButtons, buttonOrder };
}

export function getCustomButtonImportDeletions(
  current: ExtensionSettings,
  imported: ExtensionSettings,
): CustomButtonId[] {
  if (!Object.prototype.hasOwnProperty.call(imported, 'customButtons')) return [];
  const retained = new Set(Object.keys(imported.customButtons ?? {}));
  return resolveDefaultUI(current).buttons
    .filter((button) => button.id.startsWith('custom-') && !retained.has(button.id))
    .map(({ id }) => id as CustomButtonId);
}

export function getCustomTabImportDeletions(current: ExtensionSettings, imported: ExtensionSettings): Array<{ id: TabId; buttonCount: number }> {
  if (!Object.prototype.hasOwnProperty.call(imported, 'customTabs')) return [];
  const retained = new Set(Object.keys(imported.customTabs ?? {}));
  return Object.keys(current.customTabs ?? {}).filter((id) => !retained.has(id)).map((id) => ({
    id: id as TabId,
    buttonCount: resolveDefaultUI(current).buttons.filter(({ groupId }) => groupId === id).length,
  }));
}

export function reorderTabBefore(
  settings: ExtensionSettings,
  draggedId: TabId,
  targetId: TabId,
): ExtensionSettings {
  const ids = moveBefore(resolveDefaultUI(settings).tabs.map(({ id }) => id), draggedId, targetId);
  return ids ? { ...settings, tabOrder: ids } : settings;
}

export function createCustomTab(settings: ExtensionSettings, id: TabId, label: string): ExtensionSettings {
  const normalized = label.trim();
  if (!/^custom-tab-[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id)
    || normalized.length < 1 || normalized.length > 40 || settings.customTabs?.[id as CustomTabId]) return settings;
  return {
    ...settings,
    customTabs: { ...(settings.customTabs ?? {}), [id]: { label: normalized, visible: true } },
    tabOrder: [...resolveDefaultUI(settings).tabs.map(({ id: tabId }) => tabId), id],
    buttonOrder: { ...(settings.buttonOrder ?? {}), [id]: [] },
  };
}

export function renameTab(settings: ExtensionSettings, id: TabId, label: string): ExtensionSettings {
  const normalized = label.trim();
  if (normalized.length < 1 || normalized.length > 40) return settings;
  if (id.startsWith('custom-tab-')) {
    const customId = id as CustomTabId;
    const tab = settings.customTabs?.[customId];
    return tab ? { ...settings, customTabs: { ...settings.customTabs, [customId]: { ...tab, label: normalized } } } : settings;
  }
  return { ...settings, tabOverrides: { ...(settings.tabOverrides ?? {}), [id]: { ...(settings.tabOverrides?.[id] ?? {}), label: normalized } } };
}

export function setTabVisibility(settings: ExtensionSettings, id: TabId, visible: boolean): ExtensionSettings {
  if (id.startsWith('custom-tab-')) {
    const customId = id as CustomTabId;
    const tab = settings.customTabs?.[customId];
    return tab ? { ...settings, customTabs: { ...settings.customTabs, [customId]: { ...tab, visible } } } : settings;
  }
  return { ...settings, tabOverrides: { ...(settings.tabOverrides ?? {}), [id]: { ...(settings.tabOverrides?.[id] ?? {}), visible } } };
}

export function moveButtonGroup(settings: ExtensionSettings, id: ButtonId, destination: ButtonGroupId): ExtensionSettings {
  if (!groupIds(settings).includes(destination)) return settings;
  const button = resolveDefaultUI(settings).buttons.find(({ id: buttonId }) => buttonId === id);
  if (!button || button.groupId === destination) return settings;
  const source = button.groupId;
  const buttonOrder = { ...(settings.buttonOrder ?? {}), [source]: normalizedButtonOrder(settings, source).filter((buttonId) => buttonId !== id), [destination]: [...normalizedButtonOrder(settings, destination), id] };
  if (id.startsWith('custom-')) {
    return { ...settings, customButtons: { ...settings.customButtons, [id as CustomButtonId]: { ...settings.customButtons![id as CustomButtonId]!, groupId: destination } }, buttonOrder };
  }
  const builtinButtonGroupOverrides = { ...(settings.builtinButtonGroupOverrides ?? {}) };
  const base = DEFAULT_BUTTONS.find(({ id: buttonId }) => buttonId === id)!;
  if (destination === base.groupId) delete builtinButtonGroupOverrides[id];
  else builtinButtonGroupOverrides[id] = destination;
  return { ...settings, builtinButtonGroupOverrides, buttonOrder };
}

export function deleteCustomTab(settings: ExtensionSettings, id: TabId, destination?: ButtonGroupId): ExtensionSettings {
  const customId = id as CustomTabId;
  const tab = settings.customTabs?.[customId];
  if (!tab || !destination || destination === id || !groupIds(settings).includes(destination)) return settings;
  const buttons = resolveDefaultUI(settings).buttons.filter(({ groupId }) => groupId === id);
  let result = settings;
  for (const button of buttons) result = moveButtonGroup(result, button.id, destination);
  const customTabs = { ...(result.customTabs ?? {}) };
  delete customTabs[customId];
  const buttonOrder = { ...(result.buttonOrder ?? {}) };
  delete buttonOrder[id];
  return { ...result, customTabs, buttonOrder, tabOrder: resolveDefaultUI(result).tabs.filter(({ id: tabId }) => tabId !== id).map(({ id: tabId }) => tabId) };
}

export function getLayoutPreview(settings: ExtensionSettings = DEFAULT_SETTINGS): LayoutPreview {
  const ui = resolveDefaultUI(settings);
  const previewButton = ({ id, label, color }: PreviewButton): PreviewButton => ({ id, label, color });
  return {
    alwaysButtons: ui.buttons
      .filter(({ groupId, visible }) => groupId === 'always' && visible)
      .map(previewButton),
    tabs: ui.tabs.filter(({ visible }) => visible).map((tab) => ({
      id: tab.id,
      label: tab.label,
      buttons: ui.buttons
        .filter(({ groupId, visible }) => groupId === tab.id && visible)
        .map(previewButton),
    })),
  };
}
