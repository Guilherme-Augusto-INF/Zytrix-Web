import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const globalHeaders = vercel.headers.find(item => item.source === '/(.*)')?.headers || [];
const csp = globalHeaders.find(item => item.key === 'Content-Security-Policy')?.value || '';

test('CSP libera o authDomain exato do Firebase para o iframe de login', () => {
  assert.match(csp, /frame-src[^;]*https:\/\/zytrix-ca4f2\.firebaseapp\.com/);
  assert.match(csp, /connect-src[^;]*https:\/\/zytrix-ca4f2\.firebaseapp\.com/);
});

test('CSP continua restrita e não libera firebaseapp.com globalmente', () => {
  assert.equal(csp.includes('https://*.firebaseapp.com'), false);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
});
