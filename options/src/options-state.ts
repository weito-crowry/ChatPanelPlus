import {
  resolveDefaultUI,
  DEFAULT_BUTTONS,
  DEFAULT_TABS,
  type ButtonAction,
  type ButtonGroupId,
  type ButtonId,
  type CustomButtonDefinition,
  type CustomButtonId,
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

const GROUP_IDS: readonly ButtonGroupId[] = ['always', ...DEFAULT_TABS.map(({ id }) => id)];

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
  field: 'visible' | 'label' | 'color' | 'text',
  value: boolean | string,
): ExtensionSettings {
  const definition = settings.customButtons?.[id];
  if (!definition || (field === 'text' && definition.kind !== 'insert')) return settings;
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
  const currentOrder = resolveDefaultUI(settings).buttons;
  const buttonOrder = Object.fromEntries(GROUP_IDS.map((group) => [
    group,
    [
      ...DEFAULT_BUTTONS.filter((button) => button.groupId === group).map(({ id }) => id),
      ...currentOrder.filter((button) => button.groupId === group && button.id.startsWith('custom-')).map(({ id }) => id),
    ],
  ]));
  return {
    ...DEFAULT_SETTINGS,
    ...(Object.keys(customButtons).length ? { customButtons } : {}),
    buttonOrder,
  };
}

export function mergeImportedSettings(
  imported: ExtensionSettings,
  current: ExtensionSettings,
): ExtensionSettings {
  if (Object.prototype.hasOwnProperty.call(imported, 'customButtons')) return imported;
  const customButtons = current.customButtons;
  if (!customButtons || Object.keys(customButtons).length === 0) return imported;
  const importedUI = resolveDefaultUI(imported);
  const currentUI = resolveDefaultUI(current);
  const buttonOrder = Object.fromEntries(GROUP_IDS.map((group) => [
    group,
    [
      ...importedUI.buttons.filter((button) => button.groupId === group && !button.id.startsWith('custom-')).map(({ id }) => id),
      ...currentUI.buttons.filter((button) => button.groupId === group && button.id.startsWith('custom-')).map(({ id }) => id),
    ],
  ]));
  return { ...imported, customButtons, buttonOrder };
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

export function reorderTabBefore(
  settings: ExtensionSettings,
  draggedId: TabId,
  targetId: TabId,
): ExtensionSettings {
  const ids = moveBefore(resolveDefaultUI(settings).tabs.map(({ id }) => id), draggedId, targetId);
  return ids ? { ...settings, tabOrder: ids } : settings;
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
