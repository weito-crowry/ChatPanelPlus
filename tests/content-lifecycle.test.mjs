import assert from 'node:assert/strict';
import test from 'node:test';
import { startPanelLifecycle } from '../src/content/lifecycle.ts';

class Parent {
  children = [];
  insertions = 0;
  insertBefore(node, before) {
    if (node.parentNode) node.parentNode.remove(node);
    const index = before ? this.children.indexOf(before) : -1;
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
    node.parentNode = this;
    this.insertions += 1;
    return node;
  }
  remove(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentNode = null;
  }
}

class Host {
  parentNode = null;
  get nextSibling() {
    if (!this.parentNode) return null;
    return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] ?? null;
  }
  remove() { this.parentNode?.remove(this); }
}

function harness(initialTarget = null) {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const timers = new Map();
  const intervals = new Map();
  let timerId = 0;
  let intervalId = 0;
  let observerCallback;
  let disconnected = false;
  const document = {
    documentElement: {},
    visibilityState: 'visible',
    addEventListener: (type, listener) => documentListeners.set(type, listener),
    removeEventListener: (type) => documentListeners.delete(type),
  };
  const window = {
    addEventListener: (type, listener) => windowListeners.set(type, listener),
    removeEventListener: (type) => windowListeners.delete(type),
  };
  let target = initialTarget;
  const createdHosts = [];
  let mounts = 0;
  const lifecycle = startPanelLifecycle({
    document,
    window,
    findTarget: () => target,
    createHost: () => {
      const host = new Host();
      createdHosts.push(host);
      mounts += 1;
      return host;
    },
    observe: (callback) => {
      observerCallback = callback;
      return { disconnect: () => { disconnected = true; } };
    },
    setTimeout: (callback) => {
      const id = ++timerId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback) => {
      const id = ++intervalId;
      intervals.set(id, callback);
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
  });
  return {
    lifecycle,
    document,
    documentListeners,
    windowListeners,
    timers,
    intervals,
    createdHosts,
    get mounts() { return mounts; },
    setTarget(value) { target = value; },
    notifyMutation() { observerCallback(); },
    flushTimers() {
      const pending = [...timers.values()];
      timers.clear();
      for (const callback of pending) callback();
    },
    get disconnected() { return disconnected; },
  };
}

function target(parent, form) {
  return { parent, before: form };
}

test('初回にComposer form直前へ置き、同一hostを別Composerへ再配置してReact rootを再利用する', () => {
  const firstParent = new Parent();
  const firstForm = {};
  firstParent.children.push(firstForm);
  const h = harness(target(firstParent, firstForm));
  const host = h.createdHosts[0];
  assert.equal(firstParent.children[0], host);
  assert.equal(firstParent.children[1], firstForm);
  assert.equal(h.mounts, 1);

  const replacementParent = new Parent();
  const replacementForm = {};
  replacementParent.children.push(replacementForm);
  h.setTarget(target(replacementParent, replacementForm));
  h.notifyMutation();
  h.flushTimers();

  assert.equal(replacementParent.children[0], host);
  assert.equal(h.createdHosts.length, 1);
  assert.equal(h.mounts, 1);
});

test('Composerがない間はhostを外し、後から出現したComposerの直前へ同じhostを戻す', () => {
  const h = harness();
  const host = h.createdHosts[0];
  assert.equal(host.parentNode, null);
  const parent = new Parent();
  const form = {};
  parent.children.push(form);
  h.setTarget(target(parent, form));
  h.notifyMutation();
  h.flushTimers();
  assert.equal(parent.children[0], host);
  h.setTarget(null);
  h.notifyMutation();
  h.flushTimers();
  assert.equal(host.parentNode, null);
  assert.equal(h.createdHosts.length, 1);
  assert.equal(h.mounts, 1);
});

test('MutationObserver通知をcoalesceし、同位置はno-op、pagehideで全監視を解放する', () => {
  const parent = new Parent();
  const form = {};
  parent.children.push(form);
  const h = harness(target(parent, form));
  const host = h.createdHosts[0];
  const insertions = parent.insertions;
  h.notifyMutation();
  h.notifyMutation();
  h.notifyMutation();
  assert.equal(h.timers.size, 1);
  h.flushTimers();
  assert.equal(parent.insertions, insertions);

  h.windowListeners.get('pagehide')({ persisted: false });
  assert.equal(h.disconnected, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.documentListeners.size, 0);
  assert.equal(h.windowListeners.size, 0);
  assert.equal(host.parentNode, parent);
});

test('BFCache pagehideでは監視を維持し、pageshowで同じhostを移動後のComposerへ戻す', () => {
  const oldParent = new Parent();
  const oldForm = {};
  oldParent.children.push(oldForm);
  const h = harness(target(oldParent, oldForm));
  const host = h.createdHosts[0];

  h.windowListeners.get('pagehide')({ persisted: true });
  assert.equal(h.disconnected, false);
  assert.equal(h.intervals.size, 1);
  assert.equal(h.windowListeners.has('pageshow'), true);

  const newParent = new Parent();
  const newForm = {};
  newParent.children.push(newForm);
  h.setTarget(target(newParent, newForm));
  h.windowListeners.get('pageshow')({ persisted: true });
  h.flushTimers();

  assert.equal(newParent.children[0], host);
  assert.equal(h.createdHosts.length, 1);
  assert.equal(h.disconnected, false);
});
