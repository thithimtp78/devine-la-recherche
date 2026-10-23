// Simule une partie complète à 3 joueurs directement sur la logique du jeu (images en mode demo).
import assert from 'node:assert/strict';
import { Room, sharedWords } from '../docs/game.js';
import { setProvider } from '../docs/images.js';

setProvider('demo');
const until = async (fn, ms = 3000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

const room = new Room('ABCD', () => {});
const ids = ['a', 'b', 'c'];
const names = { a: 'Alice', b: 'Bob', c: 'Chloé' };
ids.forEach((id) => room.addPlayer(id, names[id]));
assert.equal(room.hostId, 'a');
assert.ok(room.start('b'), 'un non-hôte ne peut pas lancer');
room.updateSettings('a', { rounds: 2, writeTime: 30, guessTime: 20 });
assert.equal(room.start('a'), null);

for (let round = 1; round <= 2; round++) {
  await until(() => room.phase === 'write' && room.roundNo === round);
  const views = Object.fromEntries(ids.map((id) => [id, room.viewFor(id)]));
  assert.equal(new Set(ids.map((id) => views[id].image.url)).size, 3, 'chaque joueur a une image différente');
  ids.forEach((id) => room.submitPhrase(id, `recherche de ${names[id]}`));
  assert.equal(room.phase, 'guess');
  for (const id of ids) {
    const v = room.viewFor(id);
    assert.equal(v.options.length, 4);
    assert.notEqual(v.author, names[id], 'on ne devine pas sa propre phrase');
    const authorId = ids.find((x) => names[x] === v.author);
    const i = id === 'c' ? 0 : v.options.findIndex((o) => o.url === views[authorId].image.url);
    assert.ok(i >= 0, 'la bonne image est parmi les 4');
    room.submitGuess(id, i);
  }
  assert.equal(room.phase, 'reveal');
  const res = room.viewFor('a').results;
  assert.ok(res.find((r) => r.guesser === 'Alice').correct && res.find((r) => r.guesser === 'Bob').correct);
  console.log(`Manche ${round} :`, res.map((r) => `${r.guesser}→${r.author} ${r.correct ? '✓' : '✗'} (${r.query})`).join(' | '));
  room.nextRound('a');
}
assert.equal(room.phase, 'end');
console.log('Scores :', [...room.players.values()].map((p) => `${p.name}=${p.score}`).join(', '));

assert.deepEqual(sharedWords('Tarte aux Pommes maison', 'tarte aux pommes'), ['tarte', 'pommes']);
assert.deepEqual(sharedWords('Éléphant', 'éléphant qui se baigne'), ['elephant']);
console.log('OK');
