import {
  resolveDefaultUI,
  type ButtonGroupId,
  type ButtonId,
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
