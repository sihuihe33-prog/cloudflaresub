import assert from 'node:assert/strict';
import YAML from 'yaml';
import worker from '../src/worker.js';

// Regression: the daily RN updater (cf_sub_updater.py) posts usePrefixOnly=true + compactName=false.
// Node names must be `<namePrefix> | <remark>` (no base-node name in front), otherwise the RN display
// logic (RackNerd| prefix) and group layout break.
const store = new Map();
const env = {
  SUB_ACCESS_TOKEN: 'test-secret',
  SUB_STORE: {
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => { store.set(k, v); },
  },
};
const id = 'PFX1234567';
const vless = 'vless://11111111-2222-3333-4444-555555555555@rn.example:443?type=ws&security=tls&host=rn.example&sni=rn.example&path=%2Fwasd#RackNerd';
store.set(`sub:${id}`, JSON.stringify({ nodes: [
  { name: 'RackNerd|每日优选CF | 香港 | 1', type: 'vless', server: '1.1.1.1', port: 443, uuid: '11111111-2222-3333-4444-555555555555', network: 'ws', tls: true, host: 'rn.example', sni: 'rn.example', path: '/wasd' },
  { name: 'hysteria-dmit', type: 'hysteria2', server: 'dmit.gghui.top', port: 443, password: 'x' },
] }));

const res = await worker.fetch(new Request('https://sub.example/api/generate', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-sub-access-token': 'test-secret', origin: 'https://sub.example' },
  body: JSON.stringify({
    nodeLinks: vless,
    preferredIps: '162.159.139.47#香港 | 1\n162.159.135.178#香港 | 2\n104.19.131.3#香港 | 3',
    namePrefix: 'RackNerd|每日优选CF', usePrefixOnly: true, compactName: false, keepOriginalHost: true, updateId: id,
  }),
}), env);
assert.equal(res.status, 200, await res.clone().text());
const names = JSON.parse(store.get(`sub:${id}`)).nodes.map((n) => n.name);
assert.deepEqual(names, ['RackNerd|每日优选CF | 香港 | 1', 'RackNerd|每日优选CF | 香港 | 2', 'RackNerd|每日优选CF | 香港 | 3', 'hysteria-dmit']);

const doc = YAML.parse(await (await worker.fetch(new Request(`https://sub.example/sub/${id}?target=clash&token=test-secret`), env)).text());
assert.deepEqual(doc['proxy-groups'].map((g) => g.name), ['节点选择', '自动选择', 'DMIT', 'RackNerd']);
assert.deepEqual(doc['proxy-groups'].find((g) => g.name === '自动选择').proxies, ['每日优选CF | 香港 | 1', '每日优选CF | 香港 | 2', '每日优选CF | 香港 | 3']);

// Without usePrefixOnly the old behaviour (base name first) is preserved for other users of the generator.
const id2 = 'PFX7654321';
store.set(`sub:${id2}`, JSON.stringify({ nodes: [] }));
await worker.fetch(new Request('https://sub.example/api/generate', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-sub-access-token': 'test-secret', origin: 'https://sub.example' },
  body: JSON.stringify({ nodeLinks: vless, preferredIps: '1.2.3.4#A', namePrefix: 'P', updateId: id2 }),
}), env);
assert.deepEqual(JSON.parse(store.get(`sub:${id2}`)).nodes.map((n) => n.name), ['RackNerd | P | A']);
console.log('prefix-only naming test passed');
