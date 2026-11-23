# C46 owner tab identity design

## Intent

Fix C46's failed answer-completion auto-registration when the stored owner tab cannot be confirmed. Keep the existing rule that a watch is created only for a live Bridge thread ID that exactly appears in the completed answer.

## Evidence and uncertainty

The candidate lookup and registration paths call `ownerTabMatchesConversation()`. It currently reads `chrome.tabs.get(tabId).url` and returns false when the URL is absent. The manifest has no `tabs` permission or fixed `chatgpt.com` host permission. Chrome documents that sensitive tab URL properties require `tabs` or a matching host permission. The reported 22:35 runtime value was not captured, so missing URL permission is a code-supported cause, not a proven observation from that run. A stale or reused tab ID also fails the same owner check. `getStatus()` currently selects by conversation ID alone, which can show ON for an entry tied to a different tab.

## Goals and non-goals

- Confirm the owner tab's current conversation without adding `tabs` or host permissions.
- Fail closed for another route, a closed tab, an unavailable content script, an invalid reply, or a timeout.
- Make auto-registration status specific to the calling tab and let an explicit ON action rebind a same-conversation setting only when the old tab returns a valid different route identity or its tab ID is confirmed closed. An open tab with no responder, a timeout, or an invalid reply remains a conflict.
- Keep existing watch items, terminal events, notification state, and mute checks intact.
- Do not restore periodic automatic discovery or broaden automatic registration beyond answer text IDs matching Bridge live IDs.

## Approaches

- Add `tabs` or fixed ChatGPT host permission: Chrome can then expose tab URL, but this widens extension access and changes the permission surface.
- Ask the existing ChatGPT content script in frame 0 for its current conversation ID: this uses the already injected script, needs no new manifest permission, and preserves a strict identity check. **Selected** because it addresses the missing-URL path with the smallest permission footprint.

## Design

The content script responds only to an exact identity-ping message from this extension, only on `https://chatgpt.com` without URL credentials, and only when the route contains a valid conversation ID. The background sends a fresh nonce to frame 0, applies a bounded timeout, validates the exact response shape and nonce, and compares the returned ID with the saved owner conversation. Every failure remains false.

The auto-watch status request also carries the trusted caller tab ID. A stored entry is shown enabled only when its owner tab is the caller and that tab confirms the same conversation. A same-conversation entry can be rebound only by the user's explicit ON action and only when the previous owner tab returns a valid different route identity or `tabs.get` confirms its ID is closed. A timeout, malformed response, or open tab without a responder remains a conflict. A live owner in another tab and an owner in another conversation remain conflicts. Rebinding changes only the auto-registration entry; existing watch and event records remain untouched.

After the owner identity is confirmed again, the status response clears a previously stored `owner-tab-unavailable` diagnostic for display without rewriting storage. A later successful registration clears the stored diagnostic through the existing result path.

The owner-tab error text will describe the failed auto-registration and preserved records without claiming that notification sound was stopped.

## Acceptance

- Tests cover a URL-less `tabs.get` result, exact-route identity ping, wrong route/origin/credentials, unknown and malformed responses, closed tabs, timeout, and nonce mismatch.
- Tests cover stale owner status and explicit same-conversation re-enable while preserving watch/event records; active, open-but-unresponsive, and different-conversation owners remain rejected.
- A previously stored owner-tab failure is no longer shown after the current owner tab confirms successfully.
- Existing completion ID matching, manual watch, polling, terminal notification, mute guard, and owner isolation regressions remain green.
- No manifest permission changes; build, typecheck, lint/size, test suite, and `git diff --check` pass before commit.
- Real Chrome acceptance remains user-run and is reported separately.
