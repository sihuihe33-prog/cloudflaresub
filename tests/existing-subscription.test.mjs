import { readFileSync } from 'node:fs';
import path from 'node:path';

const here = new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '');
const root = path.resolve(path.dirname(here), '..');
const html = readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const js = readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const worker = readFileSync(path.join(root, 'src', 'worker.js'), 'utf8');

if (!html.includes('existingSubscription')) throw new Error('missing existing subscription selector');
if (!html.includes('appendIps')) throw new Error('missing append IP input');
if (!js.includes('/api/subscriptions')) throw new Error('missing subscriptions API call');
if (!js.includes('appendPreferredIps')) throw new Error('missing append update payload');
if (!worker.includes('appendPreferredIps')) throw new Error('worker lacks appendPreferredIps');
if (!worker.includes('listSubscriptions')) throw new Error('worker lacks subscription listing');

console.log('existing subscription append feature test passed');
