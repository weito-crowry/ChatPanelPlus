import { useEffect, useMemo, useRef, useState } from 'react';
import { ProjectNamesRepository, createChromeProjectNamesRepository } from '../shared/project-names-repository.ts';
import {
  createChromeProjectFolderPatternsRepository,
  filterThreadsByFolderPatterns,
  ProjectFolderPatternsRepository,
} from '../shared/project-folder-patterns.ts';
import type { CodexBridgeThread } from '../shared/codexbridge-mcp-protocol.ts';
import { isProjectId } from '../shared/project-route.ts';
import { classifyCodexBridgeThreadActivity } from './codexbridge-thread-order.ts';

type ProjectChoice = Readonly<{ id: string; label: string }>;

export function CodexBridgeProjectFolderFilter({
  threads,
  selected,
  currentProjectId,
  onSelectThread,
}: Readonly<{
  threads: readonly CodexBridgeThread[];
  selected: CodexBridgeThread | null;
  currentProjectId?: string | null;
  onSelectThread: (thread: CodexBridgeThread) => void;
}>) {
  const [projectNames, setProjectNames] = useState<Readonly<Record<string, string>>>({});
  const [patternsByProject, setPatternsByProject] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [loadError, setLoadError] = useState('');
  const [projectId, setProjectId] = useState('');
  const generation = useRef(0);
  const namesRepository = useRef<ProjectNamesRepository | null>(null);
  const patternsRepository = useRef<ProjectFolderPatternsRepository | null>(null);
  if (!namesRepository.current) namesRepository.current = createChromeProjectNamesRepository();
  if (!patternsRepository.current) patternsRepository.current = createChromeProjectFolderPatternsRepository();

  useEffect(() => {
    let active = true;
    const load = async () => {
      const request = ++generation.current;
      const [names, patterns] = await Promise.all([
        namesRepository.current!.loadNames(), patternsRepository.current!.loadPatterns(),
      ]);
      if (!active || generation.current !== request) return;
      if (!names.ok || !patterns.ok) {
        setProjectNames({});
        setPatternsByProject({});
        setLoadError('保存済みプロジェクト設定を読み込めません。');
        return;
      }
      setProjectNames(names.names);
      setPatternsByProject(patterns.patternsByProject);
      setLoadError('');
    };
    void load();
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && ('chatPanelPlus.projectNames' in changes
        || 'chatPanelPlus.projectFolderPatterns.v1' in changes)) void load();
    };
    chrome.storage.onChanged.addListener(changed);
    return () => { active = false; generation.current += 1; chrome.storage.onChanged.removeListener(changed); };
  }, []);

  const choices = useMemo<readonly ProjectChoice[]>(() => {
    const ids = new Set([...Object.keys(projectNames), ...Object.keys(patternsByProject)]);
    if (isProjectId(currentProjectId)) ids.add(currentProjectId.toLowerCase());
    return [...ids].sort().map((id) => ({
      id,
      label: projectNames[id]?.trim() || `名称未記録 (${id})`,
    }));
  }, [currentProjectId, patternsByProject, projectNames]);
  const selectedProject = choices.find((choice) => choice.id === projectId);
  const patterns = projectId ? patternsByProject[projectId] ?? [] : [];
  const visibleThreads = projectId ? filterThreadsByFolderPatterns(threads, patterns) : threads;

  return (
    <>
      <div className="codex-bridge-project-filter">
        <label>
          プロジェクト
          <select aria-label="プロジェクト別スレッド絞り込み" value={projectId} onChange={(event) => setProjectId(event.currentTarget.value)}>
            <option value="">すべて</option>
            {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
          </select>
        </label>
        {isProjectId(currentProjectId) && currentProjectId !== projectId && (
          <button type="button" className="codex-bridge-button" onClick={() => setProjectId(currentProjectId.toLowerCase())}>
            現在のプロジェクト
          </button>
        )}
        {projectId && <small>{patterns.length === 0 ? 'パターン未登録' : '取得済みスレッドだけを絞り込み'}
          {' · '}一致 {visibleThreads.length}件 / 取得済み {threads.length}件</small>}
      </div>
      {loadError && <p className="codex-bridge-error" role="status">{loadError}</p>}
      {visibleThreads.length === 0 && threads.length > 0 && projectId && (
        <p className="codex-bridge-empty">{patterns.length === 0 ? 'このプロジェクトにフォルダパターンはありません。' : '一致する取得済みスレッドはありません。'}</p>
      )}
      {visibleThreads.length > 0 && (
        <ul className="codex-bridge-thread-list" aria-label="thread一覧">
          {visibleThreads.map((thread, index) => {
            const isSelected = selected?.targetId === thread.targetId && selected.id === thread.id;
            const activity = classifyCodexBridgeThreadActivity(thread);
            const rawState = thread.currentExecution?.state;
            const label = activity === 'running' ? '実行中' : activity === 'estimated' ? '実行中の推定'
              : rawState === 'not_loaded' ? '未読込' : rawState === 'unknown' ? '不明'
                : rawState || '不明（未取得）';
            const idDescription = `project-filter-thread-id-${index}`;
            return (
              <li key={`${thread.targetId}:${thread.id}`}>
                <button type="button" title={thread.id} aria-describedby={idDescription}
                  className={`codex-bridge-thread${isSelected ? ' is-selected' : ''}`} onClick={() => onSelectThread(thread)}>
                  <span className="phase6-thread-label">{thread.title?.trim() || thread.preview?.trim() || 'タイトル未取得'}</span>
                  <small className={`phase6-thread-state is-${activity}`}>
                    <span aria-hidden="true">{activity === 'running' ? '●' : activity === 'estimated' ? '◌' : '○'}</span> {label}
                  </small>
                </button>
                <span id={idDescription} className="phase6-sr-only">スレッドID：{thread.id}</span>
              </li>
            );
          })}
        </ul>
      )}
      {selectedProject && patterns.length === 0 && <span className="phase6-sr-only">{selectedProject.label}はフォルダパターン未登録です。</span>}
    </>
  );
}
