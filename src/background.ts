type ExtensionMessage = Readonly<{
  type: 'OPEN_OPTIONS';
}>;

function isOpenOptionsMessage(message: unknown): message is ExtensionMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'OPEN_OPTIONS'
  );
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!isOpenOptionsMessage(message)) {
    return;
  }

  void chrome.runtime.openOptionsPage();
});
