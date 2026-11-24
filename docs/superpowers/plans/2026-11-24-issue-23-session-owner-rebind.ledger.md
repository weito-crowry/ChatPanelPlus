# SDD ledger — plan: docs/superpowers/plans/2026-11-24-issue-23-session-owner-rebind.md

Pre-flight: Task 1 owner resolver feeds Task 2 event dispatch; event delivery state is persisted through the same thread-monitor storage mutation queue. Task 3 consumes status fields from Task 1 and records the same C54 scope.

Ruling: Existing `ownerTabId` remains a compatibility/delivery hint — `chrome.storage.session` lease is the only runtime ownership authority — because local state survives browser restart while tab IDs do not; if wrong, a same-conversation tab can temporarily fail to claim until rebind logic runs.

Ruling: Audio for ownerless terminal events is skipped, not delayed — the existing notification state and mute guard remain authoritative and past sounds must not replay; if wrong, a user may miss a sound but can see the retained event.

Ruling: A pending event's `requested` marker is durable and never auto-retried — a send outcome can be ambiguous, and avoiding duplicate final-answer insertion takes precedence over automatic retry; if wrong, one event may require manual retrieval.

Ruling: An OFF conversation with no owner-scoped watch/event does not hold a runtime lease — this keeps the lease tied to active work; an explicit ON/manual watch releases a dormant lease before the identity claim, while active records keep their current owner binding.

Ruling: `tabs.onRemoved` cleanup checks whether the tab ID is still open before deleting session leases — a reused ID must not cause the new tab's lease to be removed.

Task 1: complete; Task 2: complete; Task 3: complete except the user-owned C54 Chrome cases, which remain `NOT_RUN`.
