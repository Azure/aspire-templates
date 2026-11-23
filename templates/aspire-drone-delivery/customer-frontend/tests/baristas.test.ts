import { existsSync } from 'node:fs';
import { assert, test } from 'vitest';
import { baristaFor, baristas } from '../src/baristas';

test('a dozen complete barista profiles, each with its avatar', () => {
  assert.equal(baristas.length, 12);
  assert.equal(new Set(baristas.map(barista => barista.id)).size, 12);
  assert.isAtLeast(new Set(baristas.map(barista => barista.aflTeam)).size, 10);
  for (const barista of baristas) {
    assert.ok(barista.backstory && barista.favouriteCoffee && barista.facts.length >= 2, barista.id);
    assert.ok(existsSync(new URL(`../public${barista.avatar}`, import.meta.url)), barista.avatar);
  }
});

test('each order keeps the same barista and orders spread across the team', () => {
  assert.equal(baristaFor('FC-A1AF4F'), baristaFor('FC-A1AF4F'));
  const assigned = new Set(Array.from({ length: 200 }, (_, index) => baristaFor(`FC-${index.toString(16).toUpperCase().padStart(6, '0')}`).id));
  assert.isAtLeast(assigned.size, 10);
});
