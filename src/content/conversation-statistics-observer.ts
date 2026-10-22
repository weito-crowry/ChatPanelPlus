export function observeConversationMutations(
  root: HTMLElement,
  onMutations: (records: readonly MutationRecord[]) => void,
): MutationObserver {
  const observer = new MutationObserver((records) => onMutations(records));
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'data-turn-key',
      'data-chatgpt-selection-message-id',
      'data-dil-message-id',
      'data-talvt-turn-state',
      'data-user-message-bubble',
    ],
  });
  return observer;
}
