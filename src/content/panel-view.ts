import { resolveDefaultUI, type ResolvedButton, type ResolvedTab, type TabId } from '../shared/default-ui.ts';
import type { ExtensionSettings } from '../shared/settings.ts';
import type { ClipboardPasteResult } from './clipboard.ts';

export interface PanelViewState {
  readonly selectedTabId: TabId | null;
  readonly minimized: boolean;
}

export interface PanelViewModel {
  readonly utilityButtons: readonly ResolvedButton[];
  readonly tabs: readonly ResolvedTab[];
  readonly buttonsByTab: ReadonlyMap<TabId, readonly ResolvedButton[]>;
  readonly selectedTabId: TabId | null;
}

export function pasteResultErrorReason(result: ClipboardPasteResult): string | null {
  return result.kind === 'edit-failed' ? result.reason : null;
}

export function createPanelViewModel(settings?: ExtensionSettings): PanelViewModel {
  const ui = resolveDefaultUI(settings);
  const buttonsByTab = new Map<TabId, readonly ResolvedButton[]>();
  for (const tab of ui.tabs.filter(({ visible }) => visible)) {
    buttonsByTab.set(tab.id, ui.buttons.filter((button) => button.groupId === tab.id && button.visible));
  }
  return {
    utilityButtons: ui.buttons.filter((button) => button.groupId === 'always' && button.visible),
    tabs: ui.tabs.filter((tab) => tab.visible),
    buttonsByTab,
    selectedTabId: ui.selectedTabId,
  };
}

export function createInitialPanelViewState(
  tabs: readonly ResolvedTab[],
  savedState?: Partial<PanelViewState>,
): PanelViewState {
  return {
    selectedTabId: resolveSelectedTab(tabs, savedState?.selectedTabId),
    minimized: savedState?.minimized === true,
  };
}

export function reconcilePanelViewState(
  state: PanelViewState,
  tabs: readonly ResolvedTab[],
): PanelViewState {
  const selectedTabId = resolveSelectedTab(tabs, state.selectedTabId);
  return selectedTabId === state.selectedTabId
    ? state
    : { ...state, selectedTabId };
}

export function selectPanelTab(
  state: PanelViewState,
  tabs: readonly ResolvedTab[],
  tabId: TabId,
): PanelViewState {
  if (!tabs.some((tab) => tab.id === tabId) || state.selectedTabId === tabId) return state;
  return { ...state, selectedTabId: tabId };
}

export function togglePanelMinimized(state: PanelViewState): PanelViewState {
  return { ...state, minimized: !state.minimized };
}

function resolveSelectedTab(tabs: readonly ResolvedTab[], requested: unknown): TabId | null {
  if (tabs.some((tab) => tab.id === requested)) return requested as TabId;
  return tabs[0]?.id ?? null;
}

export function formatJstTimestamp(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `[${value('year')}/${value('month')}/${value('day')} ${value('hour')}:${value('minute')}:${value('second')} JST]`;
}
