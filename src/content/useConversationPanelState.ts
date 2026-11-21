import { useEffect, useRef, useState } from 'react';
import type { ResolvedTab } from '../shared/default-ui.ts';
import {
  createChromeConversationPanelStateRepository,
  type ConversationPanelState,
  type ConversationPanelStatePatch,
  type ConversationPanelWatchSelection,
  type ConversationPanelStateRepository,
} from '../shared/conversation-panel-state-repository.ts';
import { conversationIdFromPath } from '../shared/conversation-route.ts';
import { createInitialPanelViewState, reconcilePanelViewState, selectPanelTab, togglePanelMinimized, type PanelViewState } from './panel-view.ts';
import { createCodexWorkModeRouteObserver } from './codex-work-mode-route.ts';

export interface ConversationPanelStateController {
  readonly conversationId: string | null;
  readonly viewState: PanelViewState;
  readonly bridgeExpanded: boolean;
  readonly bridgeWatchSelection: ConversationPanelWatchSelection | null;
  readonly bridgeEventSelection: string | null;
  readonly error: string;
  readonly onSelectTab: (tabId: ResolvedTab['id']) => void;
  readonly onToggleMinimized: () => void;
  readonly onToggleBridgeExpanded: () => void;
  readonly onSelectBridgeWatch: (selection: ConversationPanelWatchSelection | null) => void;
  readonly onSelectBridgeEvent: (eventId: string | null) => void;
}

export function useConversationPanelState(tabs: readonly ResolvedTab[]): ConversationPanelStateController {
  const repository = useRef<ConversationPanelStateRepository | null>(null);
  if (!repository.current) repository.current = createChromeConversationPanelStateRepository();
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const [conversationId, setConversationId] = useState<string | null>(() => conversationIdFromPath(window.location.pathname));
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const [viewState, setViewState] = useState(() => createInitialPanelViewState(tabs));
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;
  const [bridgeExpanded, setBridgeExpanded] = useState(false);
  const bridgeExpandedRef = useRef(bridgeExpanded);
  bridgeExpandedRef.current = bridgeExpanded;
  const [bridgeWatchSelection, setBridgeWatchSelection] = useState<ConversationPanelWatchSelection | null>(null);
  const bridgeWatchSelectionRef = useRef(bridgeWatchSelection);
  bridgeWatchSelectionRef.current = bridgeWatchSelection;
  const [bridgeEventSelection, setBridgeEventSelection] = useState<string | null>(null);
  const bridgeEventSelectionRef = useRef(bridgeEventSelection);
  bridgeEventSelectionRef.current = bridgeEventSelection;
  const loadedForRef = useRef<string | null>(null);
  const [error, setError] = useState('');
  const routeGeneration = useRef(0);
  const editRevision = useRef(0);

  function applyStoredState(id: string, state: ConversationPanelState) {
    if (conversationIdRef.current !== id || conversationIdFromPath(window.location.pathname) !== id) return;
    const next = createInitialPanelViewState(tabsRef.current, state);
    viewStateRef.current = next;
    bridgeExpandedRef.current = state.bridgeExpanded;
    setViewState(next);
    setBridgeExpanded(state.bridgeExpanded);
    bridgeWatchSelectionRef.current = state.bridgeWatchSelection;
    bridgeEventSelectionRef.current = state.bridgeEventSelection;
    setBridgeWatchSelection(state.bridgeWatchSelection);
    setBridgeEventSelection(state.bridgeEventSelection);
    loadedForRef.current = id;
  }

  function persist(id: string, patch: ConversationPanelStatePatch) {
    if (conversationIdFromPath(window.location.pathname) !== id) return;
    void repository.current?.update(id, patch).then((result) => {
      if (!result.ok && conversationIdRef.current === id) setError('会話別パネル状態を保存できませんでした。');
    });
  }

  function updateViewState(next: PanelViewState) {
    const previous = viewStateRef.current;
    if (next === previous) return;
    viewStateRef.current = next;
    setViewState(next);
    editRevision.current += 1;
    const id = conversationIdRef.current;
    if (id && loadedForRef.current === id) {
      const patch: ConversationPanelStatePatch = {
        ...(next.selectedTabId !== previous.selectedTabId ? { selectedTabId: next.selectedTabId } : {}),
        ...(next.minimized !== previous.minimized ? { minimized: next.minimized } : {}),
      };
      if (Object.keys(patch).length) persist(id, patch);
    }
  }

  function updateBridgeExpanded(next: boolean) {
    if (next === bridgeExpandedRef.current) return;
    bridgeExpandedRef.current = next;
    setBridgeExpanded(next);
    editRevision.current += 1;
    const id = conversationIdRef.current;
    if (id && loadedForRef.current === id) persist(id, { bridgeExpanded: next });
  }

  function updateBridgeSelection(patch: Pick<ConversationPanelStatePatch, 'bridgeWatchSelection' | 'bridgeEventSelection'>) {
    const nextWatch = patch.bridgeWatchSelection === undefined ? bridgeWatchSelectionRef.current : patch.bridgeWatchSelection;
    const nextEvent = patch.bridgeEventSelection === undefined ? bridgeEventSelectionRef.current : patch.bridgeEventSelection;
    if (JSON.stringify(nextWatch) === JSON.stringify(bridgeWatchSelectionRef.current)
      && nextEvent === bridgeEventSelectionRef.current) return;
    bridgeWatchSelectionRef.current = nextWatch;
    bridgeEventSelectionRef.current = nextEvent;
    setBridgeWatchSelection(nextWatch);
    setBridgeEventSelection(nextEvent);
    editRevision.current += 1;
    const id = conversationIdRef.current;
    if (id && loadedForRef.current === id) persist(id, patch);
  }

  useEffect(() => {
    const route = createCodexWorkModeRouteObserver(window);
    let seenInitialRoute = false;
    let unsubscribeState = () => {};
    const unsubscribeRoute = route.subscribe((nextId) => {
      if (seenInitialRoute && nextId === conversationIdRef.current) return;
      seenInitialRoute = true;
      const generation = ++routeGeneration.current;
      conversationIdRef.current = nextId;
      setConversationId(nextId);
      loadedForRef.current = null;
      editRevision.current = 0;
      setError('');
      const initial = createInitialPanelViewState(tabsRef.current);
      viewStateRef.current = initial;
      setViewState(initial);
      bridgeExpandedRef.current = false;
      setBridgeExpanded(false);
      bridgeWatchSelectionRef.current = null;
      setBridgeWatchSelection(null);
      bridgeEventSelectionRef.current = null;
      setBridgeEventSelection(null);
      unsubscribeState();
      unsubscribeState = () => {};
      if (!nextId) return;

      let storageRevision = 0;
      const loadEditRevision = editRevision.current;
      unsubscribeState = repository.current!.subscribe(nextId, (result) => {
        if (routeGeneration.current !== generation || conversationIdRef.current !== nextId) return;
        storageRevision += 1;
        if (!result.ok) { setError('会話別パネル状態を読み込めませんでした。'); return; }
        applyStoredState(nextId, result.state);
      });
      const revisionAtLoad = storageRevision;
      void repository.current!.load(nextId).then((result) => {
        if (routeGeneration.current !== generation || conversationIdRef.current !== nextId || storageRevision !== revisionAtLoad) return;
        if (!result.ok) { setError('会話別パネル状態を読み込めませんでした。'); return; }
        const editedDuringLoad = editRevision.current !== loadEditRevision;
        if (!editedDuringLoad) applyStoredState(nextId, result.state);
        else {
          loadedForRef.current = nextId;
          persist(nextId, {
            selectedTabId: viewStateRef.current.selectedTabId,
            minimized: viewStateRef.current.minimized,
            bridgeExpanded: bridgeExpandedRef.current,
            bridgeWatchSelection: bridgeWatchSelectionRef.current,
            bridgeEventSelection: bridgeEventSelectionRef.current,
          });
        }
      });
    });
    return () => {
      routeGeneration.current += 1;
      unsubscribeState();
      unsubscribeRoute();
    };
  }, []);

  const visibleTabKey = tabs.map(({ id }) => id).join('|');
  useEffect(() => {
    const normalized = reconcilePanelViewState(viewStateRef.current, tabs);
    if (normalized.selectedTabId !== viewStateRef.current.selectedTabId) updateViewState(normalized);
  }, [visibleTabKey]);

  return {
    conversationId,
    viewState,
    bridgeExpanded,
    bridgeWatchSelection,
    bridgeEventSelection,
    error,
    onSelectTab: (tabId) => updateViewState(selectPanelTab(viewStateRef.current, tabsRef.current, tabId)),
    onToggleMinimized: () => updateViewState(togglePanelMinimized(reconcilePanelViewState(viewStateRef.current, tabsRef.current))),
    onToggleBridgeExpanded: () => updateBridgeExpanded(!bridgeExpandedRef.current),
    onSelectBridgeWatch: (selection) => updateBridgeSelection({ bridgeWatchSelection: selection }),
    onSelectBridgeEvent: (eventId) => updateBridgeSelection({ bridgeEventSelection: eventId }),
  };
}
