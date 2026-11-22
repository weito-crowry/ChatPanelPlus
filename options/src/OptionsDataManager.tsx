import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY,
} from '../../src/shared/codexbridge-mcp-protocol.ts';
import { ConversationPanelStateRepository, type ConversationPanelState } from '../../src/shared/conversation-panel-state-repository.ts';
import { ConversationStatisticsRepository } from '../../src/shared/conversation-statistics-repository.ts';
import type { StoredConversationStatistics } from '../../src/shared/conversation-statistics.ts';
import { ProjectFolderPatternsRepository } from '../../src/shared/project-folder-patterns.ts';
import { ProjectNamesRepository } from '../../src/shared/project-names-repository.ts';
import {
  beginSavedDataRefresh, finishSavedDataRefresh, initialSavedDataRefreshState,
  isSavedDataDeletionAllowed, noteSavedDataChanged, setSavedDataBusy,
} from './saved-data-refresh-state.ts';
import {
  createSavedDataSnapshot, getOldEventCandidates, hasSavedTokenKey, KNOWN_LOCAL_DATA_KEYS,
  isKnownLocalStorageChange,
  type SavedDataSnapshot,
} from './saved-data-manager.ts';

type Props = Readonly<{ active: boolean }>;
type PendingDelete = Readonly<{ key: string; id: string; label: string; summary: string; impact: string }>;
type DeleteSnapshots = {
  panel: Record<string, ConversationPanelState>;
  statistics: Record<string, StoredConversationStatistics>;
  folders: Record<string, readonly string[]>;
  names: Record<string, string>;
};
const EMPTY: SavedDataSnapshot = { categories: [], session: { tokenPresent: false } };
const EMPTY_DELETE_SNAPSHOTS: DeleteSnapshots = { panel: {}, statistics: {}, folders: {}, names: {} };
const LABELS: Record<string, string> = {
  'chatPanelPlus.config': '共通設定', 'chatPanelPlus.viewState': '共有パネル状態',
  'chatPanelPlus.projectNames': '保存済みプロジェクト名', 'chatPanelPlus.projectFolderPatterns.v1': 'プロジェクト別フォルダ',
  'chatPanelPlus.panelStateByConversation.v1': '会話別パネル状態', 'chatPanelPlus.statistics': '会話統計',
  'chatPanelPlus.codexBridgeThreadMonitor.v1': 'Bridge監視・終了イベント',
  'chatPanelPlus.answerCompletionSoundAssets': '登録済み音源',
  'chatPanelPlus.answerCompletionOutputDevice': '音声出力先',
};
const makeLocks = () => navigator.locks
  ? { request: <T,>(name: string, callback: () => Promise<T>) => navigator.locks.request(name, callback) }
  : undefined;

export function OptionsDataManager({ active }: Props) {
  const [snapshot, setSnapshot] = useState<SavedDataSnapshot>(EMPTY);
  const [refreshState, setRefreshState] = useState(initialSavedDataRefreshState);
  const refreshStateRef = useRef(initialSavedDataRefreshState);
  const { loaded, loading } = refreshState;
  const [status, setStatus] = useState('保存データを開くと、既知の保存領域を読み込みます。');
  const [page, setPage] = useState(0);
  const [categoryKey, setCategoryKey] = useState<string>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<readonly PendingDelete[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const deletionSnapshots = useRef<DeleteSnapshots>({ panel: {}, statistics: {}, folders: {}, names: {} });
  const locks = useMemo(makeLocks, []);

  function updateRefreshState(next: typeof initialSavedDataRefreshState) {
    refreshStateRef.current = next;
    setRefreshState(next);
  }

  async function refresh() {
    const request = beginSavedDataRefresh(refreshStateRef.current);
    updateRefreshState(request.state);
    setStatus('保存データを読み込んでいます。');
    try {
      const [local, session] = await Promise.all([
        chrome.storage.local.get([...KNOWN_LOCAL_DATA_KEYS]),
        chrome.storage.session.get([CODEX_BRIDGE_MCP_TOKEN_SESSION_KEY]),
      ]);
      const nextSnapshots = buildDeleteSnapshots(local);
      const nextSnapshot = createSavedDataSnapshot(local, { tokenPresent: hasSavedTokenKey(session) });
      const completion = finishSavedDataRefresh(
        refreshStateRef.current, request.generation, request.changeGenerationAtStart, true,
      );
      if (completion.outcome === 'superseded') return;
      deletionSnapshots.current = nextSnapshots;
      setSnapshot(nextSnapshot);
      updateRefreshState(completion.state);
      setSelected(new Set()); setPreview(null); setPage(0);
      setStatus(completion.outcome === 'changed-during-read'
        ? '読込中に保存データが変わりました。もう一度更新してください。' : '既知の保存データを読み込みました。');
    } catch {
      const completion = finishSavedDataRefresh(
        refreshStateRef.current, request.generation, request.changeGenerationAtStart, false,
      );
      if (completion.outcome === 'failed') {
        deletionSnapshots.current = EMPTY_DELETE_SNAPSHOTS;
        updateRefreshState(completion.state);
        setSelected(new Set()); setPreview(null);
        setStatus('保存データを読み込めませんでした。削除操作はできません。');
      }
    }
  }

  useEffect(() => { if (active && !loaded) void refresh(); }, [active, loaded]);
  useEffect(() => {
    const listener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, areaName) => {
      if (isKnownLocalStorageChange(changes, areaName)) {
        updateRefreshState(noteSavedDataChanged(refreshStateRef.current));
        setPreview(null); setStatus('保存データが別の操作で変わりました。削除前に再読み込みしてください。');
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const categories = snapshot.categories;
  const current = categories.find((item) => item.key === categoryKey) ?? categories[0];
  useEffect(() => { if (current && !categoryKey) setCategoryKey(current.key); }, [current, categoryKey]);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil((current?.records.length ?? 0) / pageSize));
  const visibleRecords = current?.records.slice(page * pageSize, (page + 1) * pageSize) ?? [];
  const oldCandidates = useMemo(() => {
    const events = categories.find((item) => item.key.endsWith('codexBridgeThreadMonitor.v1'))?.records ?? [];
    return getOldEventCandidates(events.map((record) => ({ record, detectedAt: record.details?.detectedAt })))
      .map(({ record }) => record);
  }, [categories]);

  function toggle(key: string) {
    if (!isSavedDataDeletionAllowed(refreshStateRef.current) || !current?.deletable) return;
    setSelected((items) => { const next = new Set(items); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    setPreview(null);
  }
  function prepareDelete() {
    if (!isSavedDataDeletionAllowed(refreshStateRef.current) || !current) return;
    const targets = current.records.filter((record) => record.deletable && selected.has(`${current.key}\u0000${record.id}`))
      .map((record) => ({ key: current.key, id: record.id, label: LABELS[current.key] ?? current.key,
        summary: record.summary, impact: deletionImpact(current.key) }));
    if (!targets.length) return;
    setPreview(targets);
  }
  async function executeDelete() {
    if (!preview || !isSavedDataDeletionAllowed(refreshStateRef.current)) return;
    const targets = [...preview];
    const approved = window.confirm(`選択した${targets.length}件を削除します。\n\n${targets.map((item) => `${item.label}: ${item.id}（${item.impact}）`).join('\n')}\n\nこの操作を続けますか？`);
    if (!approved || !isSavedDataDeletionAllowed(refreshStateRef.current)) return;
    updateRefreshState(setSavedDataBusy(refreshStateRef.current, true)); setPreview(null);
    const results: string[] = [];
    try {
      const panelRepo = new ConversationPanelStateRepository(chrome.storage.local, chrome.storage.onChanged, locks);
      const statsRepo = new ConversationStatisticsRepository(chrome.storage.local, locks);
      const foldersRepo = new ProjectFolderPatternsRepository(chrome.storage.local, locks);
      const namesRepo = new ProjectNamesRepository(chrome.storage.local, locks);
      for (const target of targets) {
        let result: { ok: boolean; reason?: string };
        if (target.key.endsWith('panelStateByConversation.v1')) {
          const expected = deletionSnapshots.current.panel[target.id];
          result = expected ? await panelRepo.deleteConversationState(target.id, expected) : { ok: false, reason: 'missing-snapshot' };
        } else if (target.key.endsWith('.statistics')) {
          const expected = deletionSnapshots.current.statistics[target.id];
          result = expected ? await statsRepo.deleteConversation(target.id, expected) : { ok: false, reason: 'missing-snapshot' };
        } else if (target.key.endsWith('projectFolderPatterns.v1')) {
          const expected = deletionSnapshots.current.folders[target.id];
          result = expected ? await foldersRepo.deleteProjectPatterns(target.id, expected) : { ok: false, reason: 'missing-snapshot' };
        } else {
          const expected = deletionSnapshots.current.names[target.id];
          result = expected ? await namesRepo.deleteName(target.id, expected) : { ok: false, reason: 'missing-snapshot' };
        }
        results.push(result.ok ? `${target.label}/${target.id}: 削除済み` : `${target.label}/${target.id}: 未削除（${result.reason ?? '競合'}）`);
      }
    } catch { results.push('保存データの削除処理に失敗しました。'); }
    finally {
      updateRefreshState(setSavedDataBusy(refreshStateRef.current, false)); await refresh();
      if (results.length) setStatus(results.join(' / '));
    }
  }

  return <section className="settings-card saved-data-manager" aria-labelledby="saved-data-title">
    <div className="saved-data-heading"><div><h2 id="saved-data-title">保存データ</h2><p>既知の拡張保存領域を閲覧します。自動削除はありません。</p></div>
      <button type="button" disabled={loading} onClick={() => void refresh()}>{loaded ? '保存データを更新' : '読み込む'}</button></div>
    <p role="status" aria-live="polite">{status}</p>
    {loaded && <>
      <div className="data-category-grid" aria-label="保存データの目次">{categories.map((item) => <button type="button" key={item.key}
        className={item.key === current?.key ? 'data-category active' : 'data-category'} aria-pressed={item.key === current?.key}
        onClick={() => { setCategoryKey(item.key); setPage(0); setSelected(new Set()); setPreview(null); }}>
        <strong>{LABELS[item.key] ?? item.label}</strong><span>{item.count}件 · {item.status}</span>
      </button>)}</div>
      <p className="data-note">MCP接続token: {snapshot.session.tokenPresent ? '保存あり' : '保存なし'}（値・長さは表示しません）。
        会話別ミュートやCodex作業中状態など、他のsessionデータはここでは読み出しません。</p>
      {current && <div className="data-category-detail">
        <h3>{LABELS[current.key] ?? current.label}</h3>
        <p>{current.count}件 / 概算{current.approximateBytes === null ? '不明' : `${current.approximateBytes.toLocaleString()} bytes`} / 最終更新: {current.lastUpdated}</p>
        <p>一覧は最大500件、1ページ50件です。日時がない保存データの更新時刻は「不明」です。</p>
        {current.key.endsWith('codexBridgeThreadMonitor.v1') && <div className="old-event-preview">
          <strong>90日以上前の終了イベント候補（閲覧のみ）: {oldCandidates.length}件</strong>
          <p>日時なし・不正日時のイベントは候補に含めません。通知履歴の削除はここでは行わず、必要な通知はパネルの「通知をクリア」を利用してください。</p>
          {oldCandidates.slice(0, 50).map((record) => <p key={record.id}>{record.details?.detectedAt ?? '不明'} · {record.summary}</p>)}
        </div>}
        <ul className="saved-data-records">{visibleRecords.map((record) => {
          const selectionKey = `${current.key}\u0000${record.id}`;
          return <li key={selectionKey}><div className="saved-record-row">
            {current.deletable && record.deletable && <label><input type="checkbox" checked={selected.has(selectionKey)} disabled={!isSavedDataDeletionAllowed(refreshState)}
              onChange={() => toggle(selectionKey)} />削除対象</label>}
            <button type="button" className="saved-record-detail" aria-expanded={expanded === selectionKey}
              onClick={() => setExpanded(expanded === selectionKey ? null : selectionKey)}><strong>{record.id}</strong><span>{record.summary}</span></button>
          </div>{expanded === selectionKey && record.details && <dl>{Object.entries(record.details).map(([key, value]) =>
            <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>}</li>;
        })}</ul>
        <div className="data-pagination"><button type="button" disabled={page <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>前へ</button>
          <span>{page + 1} / {pageCount}</span><button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>次へ</button></div>
        {current.deletable && <div className="data-delete-actions"><button type="button" disabled={!isSavedDataDeletionAllowed(refreshState) || selected.size === 0} onClick={prepareDelete}>削除内容を確認</button>
          {preview && <div className="delete-preview" role="group" aria-label="削除プレビュー">
            <strong>{preview.length}件の対象と影響を確認してください。</strong>
            <ul>{preview.map((item) => <li key={`${item.key}:${item.id}`}>{item.label}: {item.id} — {item.impact}</li>)}</ul>
            <button type="button" disabled={!isSavedDataDeletionAllowed(refreshState)} onClick={() => void executeDelete()}>確認して削除</button>
            <button type="button" onClick={() => setPreview(null)}>取り消す</button>
          </div>}
        </div>}
      </div>}
    </>}
    <p className="data-note">chatpanelplus-settings.jsonはタブ・ボタン等の設定ファイルです。全保存領域のバックアップではなく、プロジェクト別フォルダ設定やMCP tokenを含みません。</p>
  </section>;
}

function buildDeleteSnapshots(data: Record<string, unknown>): DeleteSnapshots {
  const panel: DeleteSnapshots['panel'] = {};
  const statistics: DeleteSnapshots['statistics'] = {};
  const folders: DeleteSnapshots['folders'] = {};
  const names: DeleteSnapshots['names'] = {};
  const panelValue = data['chatPanelPlus.panelStateByConversation.v1'];
  if (isRecord(panelValue) && isRecord(panelValue.conversations)) for (const [id, state] of Object.entries(panelValue.conversations)) {
    if (isRecord(state) && typeof state.minimized === 'boolean') panel[id] = state as unknown as ConversationPanelState;
  }
  const statsValue = data['chatPanelPlus.statistics'];
  if (isRecord(statsValue) && isRecord(statsValue.conversations)) for (const [id, value] of Object.entries(statsValue.conversations)) {
    if (isRecord(value) && Array.isArray(value.turnOrder) && isRecord(value.turns)) statistics[id] = value as unknown as StoredConversationStatistics;
  }
  const folderValue = data['chatPanelPlus.projectFolderPatterns.v1'];
  if (isRecord(folderValue) && folderValue.version === 1 && isRecord(folderValue.projects)) for (const [id, list] of Object.entries(folderValue.projects)) {
    if (Array.isArray(list) && list.every((item) => typeof item === 'string')) folders[id] = list as string[];
  }
  const nameValue = data['chatPanelPlus.projectNames'];
  if (isRecord(nameValue)) for (const [id, value] of Object.entries(nameValue)) if (typeof value === 'string') names[id] = value;
  return { panel, statistics, folders, names };
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function deletionImpact(key: string): string {
  if (key.endsWith('panelStateByConversation.v1')) return 'この会話1件のパネル表示状態を削除します。統計・Bridge通知は残ります。';
  if (key.endsWith('.statistics')) return 'この会話1件の保存済み統計を削除します。パネル状態・Bridge通知は残ります。';
  if (key.endsWith('projectFolderPatterns.v1')) return 'このプロジェクトIDのフォルダパターン登録だけを削除します。';
  return 'このプロジェクトIDに保存された表示名だけを削除します。';
}
