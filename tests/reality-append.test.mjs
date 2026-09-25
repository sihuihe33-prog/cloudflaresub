import assert from 'node:assert/strict';
import YAML from 'yaml';
import worker from '../src/worker.js';

// A standalone DMIT VLESS+Reality node must be appendable to a fixed RN
// subscription, render verbatim in Clash, live only in the DMIT group, and
// survive the daily CFST regeneration.
const id = 'RNreality';
const rnNode = { type: 'vless', name: 'RackNerd|每日优选CF | 香港 | 1', server: '192.0.2.10', port: 443, uuid: '00000000-0000-4000-8000-000000000001', network: 'ws', tls: true, sni: 'rn.example', host: 'rn.example', path: '/wasd' };
const hy2 = { name: 'hysteria-dmit', type: 'hysteria2', server: 'dmit.gghui.top', port: 443, password: 'hy2-pass', sni: 'dmit.gghui.top' };
const store = new Map([[`sub:${id}`, JSON.stringify({ version: 1, nodes: [rnNode, hy2] })]]);
const env = { SUB_ACCESS_TOKEN: 'test-secret', SUB_STORE: { get: async key => store.get(key) ?? null, put: async (key, val) => store.set(key, val) } };
const reality = {
  name: 'reality-dmit', type: 'vless', server: 'dmit.gghui.top', port: 443,
  uuid: '11111111-2222-4333-8444-555555555555', network: 'tcp', tls: true, udp: true,
  flow: 'xtls-rprx-vision', servername: 'www.apple.com', 'client-fingerprint': 'chrome',
  'reality-opts': { 'public-key': 'A'.repeat(43), 'short-id': '0123456789abcdef', 'support-x25519mlkem768': true },
};
const post = (body, token = 'test-secret') => worker.fetch(new Request('https://sub.example/api/generate', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-sub-access-token': token }, body: JSON.stringify(body),
}), env);

assert.equal((await post({ updateId: id, appendClashProxy: reality }, 'wrong')).status, 403);
assert.equal((await post({ updateId: id, appendClashProxy: { ...reality, 'reality-opts': { 'short-id': 'x' } } })).status, 400, 'reality needs public-key');
assert.equal((await post({ updateId: id, appendClashProxy: { ...reality, evil: 1 } })).status, 400, 'unknown keys rejected');
const res = await post({ updateId: id, appendClashProxy: reality });
assert.equal(res.status, 200);
assert.equal((await res.json()).appendedCount, 1);
assert.equal((await (await post({ updateId: id, appendClashProxy: reality })).json()).appendedCount, 0, 'idempotent');

const render = async () => YAML.parse(await (await worker.fetch(new Request(`https://sub.example/sub/${id}?target=clash&token=test-secret`), env)).text());
let doc = await render();
assert.deepEqual(doc.proxies.find(p => p.name === 'reality-dmit'), reality, 'reality renders verbatim');
const groups = Object.fromEntries(doc['proxy-groups'].map(g => [g.name, g.proxies]));
assert.deepEqual(groups.DMIT, ['hysteria-dmit', 'reality-dmit']);
assert.deepEqual(groups['自动选择'], ['每日优选CF | 香港 | 1']);
assert.deepEqual(groups.RackNerd, ['自动选择', '每日优选CF | 香港 | 1', 'DIRECT']);

// Daily CFST in-place refresh must keep both DMIT nodes.
const refresh = await post({ updateId: id, nodeLinks: `vless://${rnNode.uuid}@rn.example:443?type=ws&security=tls&host=rn.example&sni=rn.example&path=%2Fwasd#x`, preferredIps: '192.0.2.99#香港', namePrefix: 'RackNerd|每日优选CF' });
assert.equal(refresh.status, 200);
const kept = JSON.parse(store.get(`sub:${id}`)).nodes;
assert.ok(kept.some(n => n.name === 'reality-dmit') && kept.some(n => n.name === 'hysteria-dmit'), 'refresh keeps DMIT nodes');
doc = await render();
assert.deepEqual(Object.fromEntries(doc['proxy-groups'].map(g => [g.name, g.proxies])).DMIT, ['hysteria-dmit', 'reality-dmit']);
// raw target must not crash on the appended node
assert.equal((await worker.fetch(new Request(`https://sub.example/sub/${id}?target=raw&token=test-secret`), env)).status, 200);
console.log('reality append test passed');
