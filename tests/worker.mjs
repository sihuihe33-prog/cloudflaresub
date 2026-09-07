import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const records = new Map();
const writes = [];
const env = {
  SUB_ACCESS_TOKEN: 'legacy-test-only',
  SUB_STORE: {
    async get(key) { return records.get(key) ?? null; },
    async put(key, value, options) { records.set(key, value); writes.push({ key, options }); },
  },
};
const input = {
  subscriptionName: 'RN443',
  nodeLinks: 'vless://00000000-0000-4000-8000-000000000001@edge.example.com:443?security=tls&type=ws&host=edge.example.com&sni=edge.example.com&path=%2Fws#test',
  preferredIps: '192.0.2.1',
  keepOriginalHost: true,
};
async function generate(body, token = '') {
  const response = await worker.fetch(new Request('https://example.test/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sub-access-token': token },
    body: JSON.stringify(body),
  }), env);
  return { status: response.status, data: await response.json() };
}
const get = url => worker.fetch(new Request(url), env);
const created = await generate(input);
assert.equal(created.status, 200);
const first = created.data;
const token = new URL(first.urls.clash).searchParams.get('token');
assert.match(token, /^[a-f0-9]{64}$/);
assert.notEqual(token, env.SUB_ACCESS_TOKEN);
assert.ok(!records.get(`sub:${first.shortId}`).includes(token));
assert.equal(writes.at(-1).options, undefined, 'new subscription has no expiry');
let response = await get(first.urls.clash);
assert.equal(response.status, 200);
assert.match(response.headers.get('content-disposition'), /filename="RN443.yaml"/);
assert.equal(response.headers.get('cache-control'), 'no-store');
assert.match(await response.text(), /servername: "edge.example.com"/);
assert.equal((await get(first.urls.clash.replace(token, 'wrong'))).status, 403);

const second = (await generate({ ...input, subscriptionName: 'RN80' })).data;
assert.notEqual(second.shortId, first.shortId);
const secondBefore = records.get(`sub:${second.shortId}`);
const update = { ...input, preferredIps: '192.0.2.2', updateId: first.shortId };
for (const bad of ['', 'wrong', new URL(second.urls.clash).searchParams.get('token')]) {
  const before = records.get(`sub:${first.shortId}`);
  assert.equal((await generate(update, bad)).status, 403);
  assert.equal(records.get(`sub:${first.shortId}`), before);
}
const updated = await generate(update, token);
assert.equal(updated.status, 200);
assert.deepEqual(updated.data.urls, first.urls);
assert.equal(updated.data.updated, true);
assert.equal(updated.data.migrated, false);
assert.equal(writes.at(-1).options, undefined);
response = await get(first.urls.clash);
const yaml = await response.text();
assert.match(yaml, /server: 192.0.2.2/);
assert.doesNotMatch(yaml, /server: 192.0.2.1/);
assert.equal(records.get(`sub:${second.shortId}`), secondBefore);

for (const name of ['bad\r\nheader', 'x'.repeat(65), '', '   ', '\u007f']) {
  const count = writes.length;
  assert.equal((await generate({ ...input, subscriptionName: name })).status, 400);
  assert.equal(writes.length, count);
}
const unicode = (await generate({ ...input, subscriptionName: '香港 RN443' })).data;
assert.match((await get(unicode.urls.clash)).headers.get('content-disposition'), /filename\*=UTF-8''%E9%A6%99%E6%B8%AF%20RN443.yaml/);

records.set('sub:Legacy123', JSON.stringify({ version: 1, nodes: [], createdAt: '2026-01-01' }));
const legacyUrl = 'https://example.test/sub/Legacy123?target=clash&token=legacy-test-only';
assert.equal((await get(legacyUrl)).status, 200);
const migrated = await generate({ ...input, updateId: 'Legacy123' }, env.SUB_ACCESS_TOKEN);
assert.equal(migrated.status, 200);
assert.equal(migrated.data.shortId, 'Legacy123');
assert.equal(migrated.data.migrated, true);
assert.ok(migrated.data.warnings.length);
assert.equal((await get(legacyUrl)).status, 403);
assert.equal((await get(migrated.data.urls.clash)).status, 200);
assert.equal(writes.at(-1).options, undefined);
assert.equal(JSON.parse(records.get('sub:Legacy123')).createdAt, '2026-01-01');
assert.equal((await generate({ ...input, updateId: 'Missing123' }, token)).status, 404);
assert.equal((await generate(null)).status, 400);
assert.equal((await generate({ ...input, nodeLinks: 'vmess://not-valid' })).status, 400);
assert.equal((await get(migrated.data.urls.surge)).status, 200);
console.log('worker tests passed: name, stable URL, persistent records, authorization, isolation, legacy migration');
