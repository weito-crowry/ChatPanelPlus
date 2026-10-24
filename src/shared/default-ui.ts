import type { ExtensionSettings } from './settings.ts';

export type DefaultButtonId =
  | 'now-btn' | 'paste-btn' | 'clear-btn' | 'chat-btn'
  | 'full-btn' | 'summary-btn' | 'translate-btn' | 'search-btn'
  | 'zokudake-btn' | 'handover-btn' | 'wall-start-btn' | 'wall-task-btn'
  | 'wall-sum-btn' | 'wall-resume-btn' | 'yes-btn' | 'no-btn'
  | 'a-btn' | 'b-btn' | 'c-btn' | 'd-btn';

export type CustomButtonId = `custom-${string}`;
export type ButtonId = DefaultButtonId | CustomButtonId;

export type TabId = 'directive' | 'control' | 'wall' | 'binary' | 'quad';
export type ButtonGroupId = 'always' | TabId;
export type ButtonAction = 'insert-jst' | 'paste' | 'clear';
export type ButtonKind = 'insert' | 'action';
export type InsertionMode = 'beginning' | 'caret';
export type CustomButtonDefinition = Readonly<{
  groupId: ButtonGroupId;
  label: string;
  color: string;
  visible: boolean;
} & (
  | { kind: 'insert'; text: string; insertionMode?: InsertionMode; action?: never }
  | { kind: 'action'; action: ButtonAction; text?: never; insertionMode?: never }
)>;

export type ButtonDefinition = Readonly<{
  id: ButtonId;
  groupId: ButtonGroupId;
  order: number;
  label: string;
  color: string;
  kind: ButtonKind;
  action?: ButtonAction;
  text?: string;
  insertionMode?: InsertionMode;
}>;

export type TabDefinition = Readonly<{
  id: TabId;
  order: number;
  label: string;
  buttonIds: readonly ButtonId[];
}>;

export type ResolvedButton = ButtonDefinition & Readonly<{ visible: boolean }>;
export type ResolvedTab = TabDefinition & Readonly<{ visible: boolean }>;
export type ResolvedUI = Readonly<{
  buttons: readonly ResolvedButton[];
  tabs: readonly ResolvedTab[];
  selectedTabId: TabId | null;
}>;

export const HANDOVER_TEXT = "あなたの出力は「次スレッド先頭に貼る本文のみ」です。\n前置き・説明・挨拶・注釈・引用符・コードブロックを一切出力してはいけません。\n\n# 目的\n会話の継続に必要な情報の目次のみを提示し、不足情報を指摘できる状態を作る。\n\n# 最適化目標\n・必要情報の網羅性を最大化\n・不要な詳細の持ち込みを最小化\n・後続の追加提供で完全復元可能にする\n・推測せず不足を明示する\n\n# タスク\nこのスレッド全体を解析し、\n「次スレでユーザーが段階的に情報提供できるようにするための目次」を作成する。\n\n# 出力仕様（厳守）\n以下の構造のみ出力すること\n説明文は禁止\n\n【作業の概要】\n\n【現在のゴール】\n\n【必要な資料カテゴリ】\n・コード\n・設定\n・ログ\n・環境\n・仕様\n・外部依存\n・再現手順\n・期待結果\n・実際の結果\n\n【不足の可能性が高い情報】\n推測せず、欠けると作業不能になる情報のみ列挙\n\n【次にユーザーが貼るべき情報】\n最小限で作業再開できる順序\n\n# ルール\n・内容は具体的に書く\n・憶測を書かない\n・冗長説明を書かない\n・第三者が読んでも追加資料を判断できる粒度にする\n\n以上です、生成を開始してください\n";
export const WALL_START_TEXT = "これから壁打ちを行います。\n\nあなたの役割は「思考を邪魔しない低干渉の壁」です。\n相槌に加えて、最小限の知的反射のみを行います。\n以下の制約を厳守してください。\n\n【出力形式】\n- 出力は最大4行まで\n  1行目：必ず短い相槌\n  2〜4行目：以下の「反射」から1種類だけ選択して1〜3行で発話\n- 反射は毎回1種類のみ（混ぜない）\n\n【反射の種類（いずれか1つだけ）】\n1. 感想\n   - 軽い印象のみ\n   - 評価・賛否は禁止\n\n2. 簡単な整理\n   - 言い換えない\n   - 構造化しない\n   - 要約しない\n   - ただし話題の“方向性”だけを1〜3行で言語化\n\n3. 不足している点\n   - 1つだけ指摘\n   - 質問形は禁止\n   - 解決策を出さない\n\n【禁止事項】\n- 要約・整理・再表現\n- 論点抽出・前提整理・分類\n- 評価・同意・否定\n- 助言・提案・誘導\n- 質問\n- 私の発言の言い換え\n- 長文説明\n- 反射を2種類以上混ぜること\n\n【例外ルール】\n私が明示的に\n「整理して」\n「要約して」\n「構造化して」\nと指示した場合のみ通常の応答を開始する\n\n以上を守り、以降の発言に応答してください。";

const buttons = [
  { id: 'now-btn', groupId: 'always', order: 0, label: '現在時刻', color: '#5a9edc', kind: 'action', action: 'insert-jst' },
  { id: 'paste-btn', groupId: 'always', order: 1, label: 'コピペ', color: '#2ca24c', kind: 'action', action: 'paste' },
  { id: 'clear-btn', groupId: 'always', order: 2, label: 'クリア', color: '#888', kind: 'action', action: 'clear' },
  { id: 'chat-btn', groupId: 'always', order: 3, label: '雑談', color: '#8b5cf6', kind: 'insert', text: '雑談モードで対応してください\n' },
  { id: 'full-btn', groupId: 'directive', order: 0, label: '全文', color: '#6e5adb', kind: 'insert', text: '全文出力してください' },
  { id: 'summary-btn', groupId: 'directive', order: 1, label: '要約', color: '#4b5563', kind: 'insert', text: '以下を要約して\n' },
  { id: 'translate-btn', groupId: 'directive', order: 2, label: '翻訳', color: '#e0912d', kind: 'insert', text: '以下の文を日本語に翻訳してください\n' },
  { id: 'search-btn', groupId: 'directive', order: 3, label: '調べて', color: '#1ca3ec', kind: 'insert', text: '以下のものについて詳しく網羅的に調べてください\n' },
  { id: 'zokudake-btn', groupId: 'control', order: 0, label: '続けて', color: '#10a37f', kind: 'insert', text: '続けて' },
  { id: 'handover-btn', groupId: 'control', order: 1, label: '引継ぎ', color: '#0b7285', kind: 'insert', text: HANDOVER_TEXT },
  { id: 'wall-start-btn', groupId: 'wall', order: 0, label: '壁打ち開始', color: '#0ea5e9', kind: 'insert', text: WALL_START_TEXT },
  { id: 'wall-task-btn', groupId: 'wall', order: 1, label: '作業依頼', color: '#0891b2', kind: 'insert', text: '作業依頼\n' },
  { id: 'wall-sum-btn', groupId: 'wall', order: 2, label: 'まとめ', color: '#0f766e', kind: 'insert', text: 'ここまでまとめてください' },
  { id: 'wall-resume-btn', groupId: 'wall', order: 3, label: '壁打ち再開', color: '#2563eb', kind: 'insert', text: '壁打ちモードを再開してください' },
  { id: 'yes-btn', groupId: 'binary', order: 0, label: 'はい', color: '#2069e0', kind: 'insert', text: 'はい' },
  { id: 'no-btn', groupId: 'binary', order: 1, label: 'いいえ', color: '#ea4e43', kind: 'insert', text: 'いいえ' },
  { id: 'a-btn', groupId: 'quad', order: 0, label: 'A案', color: '#10a37f', kind: 'insert', text: 'A案' },
  { id: 'b-btn', groupId: 'quad', order: 1, label: 'B案', color: '#2069e0', kind: 'insert', text: 'B案' },
  { id: 'c-btn', groupId: 'quad', order: 2, label: 'C案', color: '#ea4e43', kind: 'insert', text: 'C案' },
  { id: 'd-btn', groupId: 'quad', order: 3, label: 'D案', color: '#6e5adb', kind: 'insert', text: 'D案' },
] as const satisfies readonly ButtonDefinition[];

export const DEFAULT_BUTTONS: readonly ButtonDefinition[] = Object.freeze(
  buttons.map((button) => Object.freeze(button)),
);

const tabs = [
  { id: 'directive', order: 0, label: '指示', buttonIds: ['full-btn', 'summary-btn', 'translate-btn', 'search-btn'] },
  { id: 'control', order: 1, label: '会話制御', buttonIds: ['zokudake-btn', 'handover-btn'] },
  { id: 'wall', order: 2, label: '壁打ち', buttonIds: ['wall-start-btn', 'wall-task-btn', 'wall-sum-btn', 'wall-resume-btn'] },
  { id: 'binary', order: 3, label: '二択', buttonIds: ['yes-btn', 'no-btn'] },
  { id: 'quad', order: 4, label: '四択', buttonIds: ['a-btn', 'b-btn', 'c-btn', 'd-btn'] },
] as const satisfies readonly TabDefinition[];

export const DEFAULT_TABS: readonly TabDefinition[] = Object.freeze(
  tabs.map((tab) => Object.freeze({ ...tab, buttonIds: Object.freeze([...tab.buttonIds]) })),
);

function orderedIds<T extends string>(
  defaults: readonly T[],
  requested: readonly string[] | undefined,
): T[] {
  const known = new Set(defaults);
  const seen = new Set<T>();
  const result: T[] = [];
  for (const id of requested ?? []) {
    if (known.has(id as T) && !seen.has(id as T)) {
      seen.add(id as T);
      result.push(id as T);
    }
  }
  for (const id of defaults) {
    if (!seen.has(id)) result.push(id);
  }
  return result;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;
}

function colorValue(value: unknown): value is string {
  return typeof value === 'string' && /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value);
}

function orderedButtonIds(
  defaults: readonly ButtonId[],
  customIds: readonly CustomButtonId[],
  requested: readonly string[] | undefined,
): ButtonId[] {
  const known = new Set<ButtonId>([...defaults, ...customIds]);
  const seen = new Set<ButtonId>();
  const result: ButtonId[] = [];
  for (const id of requested ?? []) {
    if (known.has(id as ButtonId) && !seen.has(id as ButtonId)) {
      seen.add(id as ButtonId);
      result.push(id as ButtonId);
    }
  }
  for (const id of defaults) if (!seen.has(id)) result.push(id);
  for (const id of [...customIds].sort()) if (!seen.has(id)) result.push(id);
  return result;
}

export function resolveDefaultUI(settings: ExtensionSettings = { schemaVersion: 1 }): ResolvedUI {
  const source = record(settings);
  const buttonOverrides = record(source.buttonOverrides);
  const customButtons = record(source.customButtons) as Record<string, CustomButtonDefinition>;
  const tabOverrides = record(source.tabOverrides);
  const buttonOrder = record(source.buttonOrder);
  const tabIds = orderedIds(DEFAULT_TABS.map(({ id }) => id), stringArray(source.tabOrder));
  const tabById = new Map(DEFAULT_TABS.map((tab) => [tab.id, tab]));
  const resolvedTabs = tabIds.map((id, order) => {
    const base = tabById.get(id)!;
    const override = record(tabOverrides[id]);
    return Object.freeze({ ...base, order, visible: typeof override.visible === 'boolean' ? override.visible : true });
  });
  const buttonById = new Map<ButtonId, ButtonDefinition>(DEFAULT_BUTTONS.map((button) => [button.id, button]));
  const customIdsByGroup = new Map<ButtonGroupId, CustomButtonId[]>();
  for (const [id, definition] of Object.entries(customButtons)) {
    const customId = id as CustomButtonId;
    const customButton: ButtonDefinition = { id: customId, order: 0, ...definition };
    buttonById.set(customId, customButton);
    const group = customIdsByGroup.get(definition.groupId) ?? [];
    group.push(customId);
    customIdsByGroup.set(definition.groupId, group);
  }
  const groups: ButtonGroupId[] = ['always', ...tabIds];
  const resolvedButtons: ResolvedButton[] = [];
  for (const groupId of groups) {
    const defaults = DEFAULT_BUTTONS.filter((button) => button.groupId === groupId);
    const ids = orderedButtonIds(
      defaults.map(({ id }) => id),
      customIdsByGroup.get(groupId) ?? [],
      stringArray(buttonOrder[groupId]),
    );
    for (const [order, id] of ids.entries()) {
      const base = buttonById.get(id)!;
      const override = record(buttonOverrides[id]);
      const custom = customButtons[id];
      const resolved: ResolvedButton = {
        ...base,
        order,
        visible: custom?.visible ?? (typeof override.visible === 'boolean' ? override.visible : true),
        label: custom?.label ?? (typeof override.label === 'string' ? override.label : base.label),
        color: custom?.color ?? (colorValue(override.color) ? override.color : base.color),
        ...(base.kind === 'insert'
          ? { text: custom?.kind === 'insert' ? custom.text : typeof override.text === 'string' ? override.text : base.text }
          : {}),
      };
      resolvedButtons.push(Object.freeze(resolved));
    }
  }
  const visibleTabs = resolvedTabs.filter(({ visible }) => visible);
  return Object.freeze({
    buttons: Object.freeze(resolvedButtons),
    tabs: Object.freeze(resolvedTabs),
    selectedTabId: visibleTabs[0]?.id ?? null,
  });
}
