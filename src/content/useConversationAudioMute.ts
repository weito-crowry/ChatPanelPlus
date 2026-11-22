import { useEffect, useRef, useState } from 'react';
import { createChromeConversationAudioMuteClient, type ConversationAudioMuteClient } from '../shared/conversation-audio-mute-client.ts';

function loadFailureMessage(reason: string): string {
  if (reason === 'sender-unverified') return '会話URLとChromeタブ情報が一致しないため、ミュート状態を読み込めません。遷移完了後にページを再読み込みしてください。';
  if (reason === 'runtime-unavailable') return '拡張機能から応答がありません。拡張機能とChatGPTタブを再読み込みしてください。';
  if (reason === 'invalid-response') return 'ミュート状態の応答を確認できません。拡張機能とChatGPTタブを再読み込みしてください。';
  return '保存領域からミュート状態を読み込めませんでした。';
}

export interface ConversationAudioMuteController {
  readonly muted: boolean;
  readonly loaded: boolean;
  readonly pending: boolean;
  readonly error: string;
  readonly revision: number;
  readonly getSnapshot: () => { readonly muted: boolean; readonly revision: number };
  readonly onToggle: (muted: boolean) => Promise<void>;
}

export function useConversationAudioMute(conversationId: string | null): ConversationAudioMuteController {
  const client = useRef<ConversationAudioMuteClient | null>(null);
  if (!client.current) client.current = createChromeConversationAudioMuteClient();
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const generation = useRef(0);
  const revision = useRef(0);
  const mutedRef = useRef(false);
  const pendingRef = useRef(false);
  const [muted, setMuted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const currentGeneration = ++generation.current;
    revision.current += 1;
    mutedRef.current = false;
    pendingRef.current = false;
    setMuted(false);
    setLoaded(false);
    setPending(false);
    setError('');
    if (!conversationId) return;
    void client.current!.load(conversationId).then((result) => {
      if (generation.current !== currentGeneration || conversationIdRef.current !== conversationId) return;
      if (!result.ok) { setError(loadFailureMessage(result.reason)); return; }
      revision.current += 1;
      mutedRef.current = result.value.muted;
      setMuted(result.value.muted);
      setLoaded(true);
    });
    return () => { generation.current += 1; };
  }, [conversationId]);

  async function onToggle(nextMuted: boolean): Promise<void> {
    const id = conversationIdRef.current;
    if (!id || !loaded || pendingRef.current || mutedRef.current === nextMuted) return;
    const currentGeneration = generation.current;
    const previous = mutedRef.current;
    revision.current += 1;
    mutedRef.current = nextMuted;
    pendingRef.current = true;
    setMuted(nextMuted);
    setPending(true);
    setError('');
    const result = await client.current!.setMuted(id, nextMuted);
    if (generation.current !== currentGeneration || conversationIdRef.current !== id) return;
    pendingRef.current = false;
    setPending(false);
    if (!result.ok) {
      revision.current += 1;
      mutedRef.current = previous;
      setMuted(previous);
      setError(result.reason === 'sender-unverified'
        ? '会話URLとChromeタブ情報が一致しないため、ミュート状態を保存できません。'
        : result.reason === 'runtime-unavailable'
          ? '拡張機能から応答がありません。ミュート設定は変更されていません。'
          : 'ミュート状態を保存できませんでした。');
      return;
    }
    revision.current += 1;
    mutedRef.current = result.value.muted;
    setMuted(result.value.muted);
  }

  return {
    muted,
    loaded,
    pending,
    error,
    revision: revision.current,
    getSnapshot: () => ({ muted: mutedRef.current, revision: revision.current }),
    onToggle,
  };
}
