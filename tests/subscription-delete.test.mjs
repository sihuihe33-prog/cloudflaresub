import { readFileSync } from 'node:fs';
import path from 'node:path';

const here = new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '');
const root = path.resolve(path.dirname(here), '..');
const html = readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const js = readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const worker = readFileSync(path.join(root, 'src', 'worker.js'), 'utf8');

if (!html.includes('deleteSubscriptionBtn')) throw new Error('missing delete subscription button');
if (!js.includes('/api/subscriptions/')) throw new Error('missing delete subscription request');
if (!worker.includes('deleteSubscription')) throw new Error('worker lacks subscription deletion');
if (!worker.includes('env.SUB_STORE.delete')) throw new Error('worker lacks KV delete');

console.log('subscription delete feature test passed');
