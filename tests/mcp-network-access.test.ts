import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyMcpNetworkTarget,
  probeMcpLocalNetwork,
  readMcpLnaPermissionState,
} from '../options/src/mcp-network-access.ts';
import { requestMcpHostPermission } from '../options/src/mcp-permissions.ts';

test('LNA target classification keeps loopback, private LAN, external, and uncertain hosts distinct', () => {
  for (const endpoint of [
    'http://127.0.0.1:18000/mcp',
    'http://127.255.255.254/mcp',
    'http://localhost:18000/mcp',
    'http://[::1]:18000/mcp',
  ]) assert.equal(classifyMcpNetworkTarget(endpoint), 'loopback', endpoint);

  for (const endpoint of [
    'http://10.2.3.4/mcp',
    'http://172.16.0.4/mcp',
    'http://192.168.0.5/mcp',
    'http://169.254.10.2/mcp',
    'http://[fd12::1]:18000/mcp',
    'http://[fe80::1]:18000/mcp',
    'http://bridge.local/mcp',
  ]) assert.equal(classifyMcpNetworkTarget(endpoint), 'local', endpoint);

  assert.equal(classifyMcpNetworkTarget('https://bridge.example/mcp'), 'unknown');
  assert.equal(classifyMcpNetworkTarget('http://8.8.8.8/mcp'), 'external');
  assert.equal(classifyMcpNetworkTarget('https://8.8.8.8/mcp'), 'external');
  assert.equal(classifyMcpNetworkTarget('http://[2001:4860:4860::8888]/mcp'), 'external');
  assert.equal(classifyMcpNetworkTarget('http://bridge.internal/mcp'), 'unknown');
  assert.equal(classifyMcpNetworkTarget('not a URL'), 'unknown');
});

test('granular LNA permission query handles granted, prompt, denied, unsupported, and avoids non-local targets', async () => {
  for (const state of ['granted', 'prompt', 'denied'] as const) {
    const names: string[] = [];
    const result = await readMcpLnaPermissionState('loopback', async (name) => {
      names.push(name);
      return { state };
    });
    assert.equal(result, state);
    assert.deepEqual(names, ['loopback-network']);
  }

  const privateNames: string[] = [];
  assert.equal(await readMcpLnaPermissionState('local', async (name) => {
    privateNames.push(name);
    return { state: 'granted' };
  }), 'granted');
  assert.deepEqual(privateNames, ['local-network']);
  assert.equal(await readMcpLnaPermissionState('loopback', undefined), 'unavailable');
  assert.equal(await readMcpLnaPermissionState('local', async () => { throw new TypeError('private detail'); }), 'unavailable');

  let nonLocalQueries = 0;
  assert.equal(await readMcpLnaPermissionState('external', async () => {
    nonLocalQueries += 1;
    return { state: 'granted' };
  }), 'not-required');
  assert.equal(await readMcpLnaPermissionState('unknown', undefined), 'not-required');
  assert.equal(nonLocalQueries, 0);
});

test('Chrome host permission request handles granted, denied, and rejected outcomes', async () => {
  const requestedOrigins: string[][] = [];
  assert.equal(await requestMcpHostPermission('http://127.0.0.1/*', async ({ origins }) => {
    requestedOrigins.push(origins);
    return true;
  }), true);
  assert.equal(await requestMcpHostPermission('https://bridge.example/*', async () => false), false);
  assert.equal(await requestMcpHostPermission('https://bridge.example/*', async () => {
    throw new TypeError('private permission failure detail');
  }), false);
  assert.deepEqual(requestedOrigins, [['http://127.0.0.1/*']]);
});

test('explicit local probe uses a credential-free GET, treats HTTP 404 as reached, and never reads the body', async () => {
  let requestUrl = '';
  let requestInit: RequestInit & { targetAddressSpace?: string } = {};
  const response = {
    status: 404,
    get text() { throw new Error('response body must not be read'); },
  } as unknown as Response;

  const result = await probeMcpLocalNetwork('http://127.0.0.1:18000/mcp?private=query', async (input, init) => {
    requestUrl = String(input);
    requestInit = init as typeof requestInit;
    return response;
  });

  assert.deepEqual(result, { status: 'reached', httpStatus: 404 });
  assert.equal(requestUrl, 'http://127.0.0.1:18000/__cpp_lna_probe__');
  assert.equal(requestInit.method, 'GET');
  assert.equal(requestInit.mode, 'cors');
  assert.equal(requestInit.credentials, 'omit');
  assert.equal(requestInit.cache, 'no-store');
  assert.equal(requestInit.targetAddressSpace, 'loopback');
  assert.equal('body' in requestInit, false);
});

test('local target probe uses targetAddressSpace local and hides raw fetch messages', async () => {
  let requestInit: (RequestInit & { targetAddressSpace?: string }) | undefined;
  const result = await probeMcpLocalNetwork('http://192.168.1.8:18000/mcp', async (_input, init) => {
    requestInit = init as RequestInit & { targetAddressSpace?: string };
    throw new TypeError('private network and token detail');
  });

  assert.deepEqual(result, { status: 'failed', failureStage: 'request', errorName: 'TypeError' });
  assert.equal(requestInit?.targetAddressSpace, 'local');
  assert.equal(JSON.stringify(result).includes('private network'), false);
});

test('external or uncertain targets never send the LNA probe', async () => {
  let fetchCount = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCount += 1;
    return new Response(null, { status: 404 });
  };
  assert.deepEqual(await probeMcpLocalNetwork('https://bridge.example/mcp', fetchImpl), { status: 'not-applicable' });
  assert.deepEqual(await probeMcpLocalNetwork('http://bridge.internal/mcp', fetchImpl), { status: 'not-applicable' });
  assert.equal(fetchCount, 0);
});
