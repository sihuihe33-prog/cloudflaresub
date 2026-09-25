import assert from 'node:assert/strict';
import YAML from 'yaml';
import worker from '../src/worker.js';

const id = 'Existing443';
const oldNode = { type: 'vless', name: 'Old node', server: '192.0.2.10', port: 443, uuid: '00000000-0000-4000-8000-000000000001', network: 'ws', tls: true, sni: 'example.org', host: 'example.org', path: '/ws' };
const store = new Map([[`sub:${id}`, JSON.stringify({ version: 1, nodes: [oldNode] })]]);
const env = { SUB_ACCESS_TOKEN: 'test-secret', SUB_STORE: { get: async key => store.get(key) ?? null, put: async (key, val) => store.set(key, val) } };
const node = { name: 'DMIT HY2', type: 'hysteria2', server: 'dmit.gghui.top', port: 443, password: 'test-hy2-password', sni: 'dmit.gghui.top', 'skip-cert-verify': false, alpn: ['h3'], up: '100 Mbps', down: '100 Mbps' };
const url = 'https://sub.example/api/generate';
async function post(body, token = 'test-secret') {
  return worker.fetch(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sub-access-token': token }, body: JSON.stringify(body) }), env);
}
const unauthorized = await post({ updateId: id, appendClashProxy: node }, 'wrong');
assert.equal(unauthorized.status, 403, 'updates must require token');
const missing = await post({ updateId: 'missing', appendClashProxy: node });
assert.equal(missing.status, 404);
const invalid = await post({ updateId: id, appendClashProxy: { ...node, password: '' } });
assert.equal(invalid.status, 400);
const res = await post({ updateId: id, appendClashProxy: node });
assert.equal(res.status, 200);
const data = await res.json();
assert.equal(data.shortId, id);
assert.equal(data.appendedCount, 1);
assert.deepEqual(JSON.parse(store.get(`sub:${id}`)).nodes[0], oldNode);
assert.deepEqual(JSON.parse(store.get(`sub:${id}`)).nodes[1], node);
const repeated = await post({ updateId: id, appendClashProxy: node });
assert.equal((await repeated.json()).appendedCount, 0);
assert.equal(JSON.parse(store.get(`sub:${id}`)).nodes.length, 2);
const clash = await worker.fetch(new Request(`https://sub.example/sub/${id}?target=clash&token=test-secret`), env);
assert.equal(clash.status, 200);
const yaml = await clash.text();
assert.match(yaml, /type: hysteria2/);
assert.match(yaml, /password: "test-hy2-password"/);
assert.match(yaml, /skip-cert-verify: false/);
assert.match(yaml, /type: vless/);
assert.match(yaml, /"DMIT HY2"/);
const groups = YAML.parse(yaml)['proxy-groups'];
assert.deepEqual(groups.find(g => g.name === 'DMIT'), { name: 'DMIT', type: 'select', proxies: [node.name] });
assert.ok(!groups.find(g => g.name === '节点选择').proxies.includes('DMIT'));
assert.ok(!groups.find(g => g.name === '节点选择').proxies.includes(node.name));
assert.ok(groups.find(g => g.name === '自动选择').proxies.includes('Old node'));
assert.ok(!groups.find(g => g.name === '自动选择').proxies.includes(node.name));
const raw = await worker.fetch(new Request(`https://sub.example/sub/${id}?target=raw&token=test-secret`), env);
assert.equal(raw.status, 200);
assert.ok((await raw.text()).length > 0, 'existing raw format stays accessible');
// Existing scheduled preferred-IP regeneration must not erase the appended HY2.
const refresh = await post({ updateId: id, nodeLinks: `vless://${oldNode.uuid}@example.org:443?type=ws&security=tls&host=example.org&sni=example.org&path=%2Fws#Old%20node`, preferredIps: '192.0.2.11#new' });
assert.equal(refresh.status, 200);
assert.equal((await refresh.json()).counts.outputNodes, 2);
assert.equal(JSON.parse(store.get(`sub:${id}`)).nodes.filter(n => n.type === 'hysteria2').length, 1);
for (const [shortId, oldName, displayName] of [
  ['RN443', 'RackNerd|每日优选CF | 香港 | 1', '每日优选CF | 香港 | 1'],
  ['RN80', 'RackNerd|备用CF | 西雅图 | 1', '备用CF | 西雅图 | 1'],
]) {
  store.set(`sub:${shortId}`, JSON.stringify({ nodes: [{ ...oldNode, name: oldName }, node] }));
  const rendered = YAML.parse(await (await worker.fetch(new Request(`https://sub.example/sub/${shortId}?target=clash&token=test-secret`), env)).text());
  assert.deepEqual(rendered['proxy-groups'].map(g => g.name), ['节点选择', '自动选择', 'DMIT', 'RackNerd']);
  assert.deepEqual(rendered.rules, ['MATCH,节点选择']);
  assert.deepEqual(rendered['proxy-groups'][0], { name: '节点选择', type: 'select', proxies: ['RackNerd', 'DMIT'] }, `${shortId} top selector`);
  assert.equal(rendered.proxies[0].name, displayName);
  assert.equal(rendered.proxies[1].name, node.name);
  assert.ok(rendered['proxy-groups'].find(g => g.name === 'RackNerd').proxies.includes(displayName));
  assert.ok(rendered['proxy-groups'].find(g => g.name === '自动选择').proxies.includes(displayName));
  assert.ok(!rendered['proxy-groups'].find(g => g.name === 'RackNerd').proxies.includes(oldName));
  const byName = Object.fromEntries(rendered['proxy-groups'].map(g => [g.name, g.proxies]));
  assert.deepEqual(byName.DMIT, [node.name], `${shortId} DMIT group has only its own node`);
  assert.deepEqual(byName['自动选择'], [displayName], `${shortId} auto group excludes DMIT`);
  assert.deepEqual(byName.RackNerd, ['自动选择', displayName, 'DIRECT'], `${shortId} RackNerd excludes DMIT`);
  assert.equal(JSON.parse(store.get(`sub:${shortId}`)).nodes[0].name, oldName, 'do not mutate KV names');
}
console.log('hysteria merge test passed');
