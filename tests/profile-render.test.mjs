import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../assets/js/profile-plus.js', import.meta.url), 'utf8');

test('profile-plus não recria a seção a cada render', () => {
  assert.match(source, /let section = root\.querySelector\('#profile-plus'\)/);
  assert.match(source, /if \(!section\) \{/);
  assert.doesNotMatch(source, /existing\?\.remove\(\)/);
});

test('MutationObserver só remonta quando profile-plus estiver ausente', () => {
  assert.match(source, /new MutationObserver\(\(\) => \{/);
  assert.match(source, /if \(!root\.querySelector\('#profile-plus'\)\) \{\s*tryMount\(\);\s*\}/);
});
