import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createChromeProjectNamesRepository } from '../../src/shared/project-names-repository.ts';
import { PROJECT_NAMES_STORAGE_KEY } from '../../src/shared/project-names-repository.ts';
import {
  createChromeProjectFolderPatternsRepository,
  PROJECT_FOLDER_PATTERNS_STORAGE_KEY,
  PROJECT_FOLDER_PATTERNS_PER_PROJECT_LIMIT,
} from '../../src/shared/project-folder-patterns.ts';

function samePatterns(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function ProjectFolderPatternsSettings() {
  const repositories = useMemo(() => ({
    names: createChromeProjectNamesRepository(),
    folders: createChromeProjectFolderPatternsRepository(),
  }), []);
  const [projectNames, setProjectNames] = useState<Readonly<Record<string, string>>>({});
  const [basePatterns, setBasePatterns] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [draftPatterns, setDraftPatterns] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [externalChange, setExternalChange] = useState(false);
  const [status, setStatus] = useState('プロジェクト設定を読み込んでいます。');
  const generation = useRef(0);
  const dirty = selectedProjectId !== '' && !samePatterns(
    basePatterns[selectedProjectId] ?? [], draftPatterns[selectedProjectId] ?? basePatterns[selectedProjectId] ?? [],
  );
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const reload = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    const [names, folders] = await Promise.all([repositories.names.loadNames(), repositories.folders.loadPatterns()]);
    if (request !== generation.current) return;
    if (!names.ok || !folders.ok) {
      setReady(false);
      setLoading(false);
      setStatus((!names.ok && names.reason === 'corrupt-data') || (!folders.ok && folders.reason === 'corrupt-data')
        ? '保存済みプロジェクト設定が破損しています。既存値を保護するため編集を停止しました。'
        : '保存済みプロジェクト設定を読み込めませんでした。');
      return;
    }
    const patterns = folders.patternsByProject;
    const ids = [...new Set([...Object.keys(names.names), ...Object.keys(patterns)])].sort();
    setProjectNames(names.names);
    setBasePatterns(patterns);
    setDraftPatterns(patterns);
    setSelectedProjectId((current) => current && ids.includes(current) ? current : ids[0] ?? '');
    setExternalChange(false);
    setReady(true);
    setLoading(false);
    setStatus(ids.length ? 'プロジェクト別フォルダパターンを読み込みました。' : '保存済みプロジェクト名がありません。プロジェクト会話を開くと登録されます。');
  }, [repositories]);

  useEffect(() => {
    void reload();
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local' || !(PROJECT_NAMES_STORAGE_KEY in changes)
        && !(PROJECT_FOLDER_PATTERNS_STORAGE_KEY in changes)) return;
      if (dirtyRef.current) {
        setExternalChange(true);
        setStatus('別のOptions画面で保存値が変わりました。再読み込みして競合を確認してください。');
        return;
      }
      void reload();
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => {
      generation.current += 1;
      chrome.storage.onChanged.removeListener(onStorageChanged);
    };
  }, [reload]);

  const projectIds = [...new Set([...Object.keys(projectNames), ...Object.keys(basePatterns)])].sort();
  const selectedDraft = draftPatterns[selectedProjectId] ?? basePatterns[selectedProjectId] ?? [];
  const selectedBase = basePatterns[selectedProjectId] ?? [];

  function updateDraft(update: (current: readonly string[]) => readonly string[]) {
    setDraftPatterns((current) => ({
      ...current,
      [selectedProjectId]: update(current[selectedProjectId] ?? basePatterns[selectedProjectId] ?? []),
    }));
    setStatus('未保存のフォルダ設定があります。');
  }

  async function saveSelectedProject() {
    if (!ready || saving || !selectedProjectId || !dirty) return;
    setSaving(true);
    const result = await repositories.folders.savePatterns(selectedProjectId, selectedBase, selectedDraft);
    setSaving(false);
    if (!result.ok) {
      if (result.reason === 'conflict') setExternalChange(true);
      const labels = {
        conflict: '同じプロジェクトの設定が別のOptionsで変更されました。再読み込みして確認してください。',
        'corrupt-data': '保存済み設定が破損しているため、上書きしていません。',
        'invalid-pattern': '絶対パスとワイルドカードを確認してください。空欄や不正なパスは保存できません。',
        'invalid-project': 'プロジェクトIDを確認できません。',
        'storage-failed': '保存に失敗しました。ドラフトは保持されています。',
      } satisfies Record<typeof result.reason, string>;
      setStatus(labels[result.reason]);
      return;
    }
    setBasePatterns((current) => ({ ...current, [selectedProjectId]: [...selectedDraft] }));
    setDraftPatterns((current) => ({ ...current, [selectedProjectId]: [...selectedDraft] }));
    setExternalChange(false);
    setStatus('選択したプロジェクトのフォルダパターンを保存しました。');
  }

  function reloadAfterConfirmation() {
    if (dirty && !window.confirm('未保存のフォルダ設定を破棄して保存値を読み込み直しますか？')) return;
    void reload();
  }

  return (
    <section className="settings-card project-folder-settings" aria-labelledby="project-folder-settings-title">
      <h2 id="project-folder-settings-title">プロジェクト別スレッド絞り込み</h2>
      <p>プロジェクトIDごとにcwdのフォルダパターンを複数登録します。登録パターンに一致するフォルダと配下が対象です。</p>
      <p><code>*</code>は同じ階層、<code>?</code>は1文字、<code>**</code>は0階層以上に一致します。例: <code>D:\Projects\FX-*</code>、<code>D:\Work\**\src</code>、UNCパス。</p>
      <p>設定は既存のプロジェクト名・ボタン設定とは別のブラウザ共通キーに保存します。既存設定JSONの読込・書出には含めません。</p>
      {projectIds.length > 0 && <label className="project-folder-project-label">
        プロジェクト
        <select value={selectedProjectId} disabled={!ready || loading || saving} onChange={(event) => setSelectedProjectId(event.currentTarget.value)}>
          {projectIds.map((projectId) => <option key={projectId} value={projectId}>
            {projectNames[projectId]?.trim() || `名称未記録（${projectId}）`}
          </option>)}
        </select>
      </label>}
      {!loading && projectIds.length === 0 && <p>プロジェクト名は訪問時にprojectIdとともに保存されます。通常会話や未訪問プロジェクトはここに表示されません。</p>}
      {selectedProjectId && <div className="project-folder-pattern-list" aria-label="フォルダパターン">
        {selectedDraft.map((pattern, index) => <div className="project-folder-pattern-row" key={`${selectedProjectId}:${index}`}>
          <label className="field-label">
            フォルダパターン {index + 1}
            <input type="text" maxLength={512} value={pattern} placeholder="D:\Projects\FX-*" disabled={!ready || saving}
              onChange={(event) => {
                const value = event.currentTarget.value;
                updateDraft((current) => current.map((entry, itemIndex) => itemIndex === index ? value : entry));
              }} />
          </label>
          <button type="button" aria-label={`フォルダパターン ${index + 1}を削除`} disabled={!ready || saving}
            onClick={() => updateDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))}>パターンを削除</button>
        </div>)}
        <button type="button" disabled={!ready || saving || selectedDraft.length >= PROJECT_FOLDER_PATTERNS_PER_PROJECT_LIMIT}
          onClick={() => updateDraft((current) => [...current, ''])}>パターンを追加</button>
        <div className="project-folder-settings-actions">
          <button type="button" disabled={!ready || loading || saving} onClick={reloadAfterConfirmation}>保存値を再読み込み</button>
          <button type="button" className="save-button" disabled={!ready || saving || !dirty} onClick={() => void saveSelectedProject()}>
            {saving ? '保存中…' : 'プロジェクト設定を保存'}
          </button>
        </div>
        {externalChange && <p className="project-folder-conflict" role="status">別のOptions画面の更新を検知しました。再読み込みで最新値を確認できます。</p>}
      </div>}
      <p className="project-folder-status" role="status">{status}</p>
    </section>
  );
}
