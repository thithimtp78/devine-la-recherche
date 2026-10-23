// Simule une partie complète avec 3 joueurs connectés au serveur (images en mode demo).
import { io } from 'socket.io-client';
import assert from 'node:assert/strict';

process.env.IMAGE_PROVIDER = 'demo';
process.env.PORT = '0';
const { server } = await import('../server/index.js');
await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
const url = `http://localhost:${server.address().port}`;

const names = ['Alice', 'Bob', 'Chloé'];
const bots = names.map((name, i) => {
  const s = io(url, { transports: ['websocket'] });
  const bot = { name, id: `id-${i}`, s, state: null };
  s.on('state', (st) => (bot.state = st));
  return bot;
});
const emit = (bot, ev, data) => new Promise((r) => bot.s.emit(ev, data, r));
const until = async (fn, ms = 5000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

const created = await emit(bots[0], 'create', { playerId: bots[0].id, name: 'Alice' });
assert.ok(created.code?.length === 4);
assert.equal((await emit(bots[1], 'join', { code: 'ZZZZ', playerId: 'x', name: 'x' })).error, 'Cette room n’existe pas.');
for (const b of bots.slice(1)) assert.ok((await emit(b, 'join', { code: created.code.toLowerCase(), playerId: b.id, name: b.name })).ok);
await until(() => bots.every((b) => b.state?.players.length === 3));
assert.ok(bots[0].state.isHost && !bots[1].state.isHost);

bots[0].s.emit('settings', { rounds: 2, writeTime: 30, guessTime: 20 });
await until(() => bots[2].state.settings.rounds === 2);
assert.ok((await emit(bots[1], 'start')).error, 'un non-hôte ne peut pas lancer');
assert.ok((await emit(bots[0], 'start')).ok);

for (let round = 1; round <= 2; round++) {
  await until(() => bots.every((b) => b.state.phase === 'write' && b.state.roundNo === round));
  const images = bots.map((b) => b.state.image.url);
  assert.equal(new Set(images).size, 3, 'chaque joueur a une image différente');
  bots.forEach((b) => b.s.emit('phrase', `ma recherche ${b.name} round ${round}`));

  await until(() => bots.every((b) => b.state.phase === 'guess'));
  for (const b of bots) {
    assert.equal(b.state.options.length, 4);
    assert.notEqual(b.state.author, b.name, 'on ne devine pas sa propre phrase');
    assert.ok(!b.state.options.some((o) => o.url === b.state.image?.url));
  }
  // Alice et Bob cherchent la bonne image (celle de l'auteur), Chloé clique au hasard.
  for (const b of bots) {
    const author = bots.find((x) => x.name === b.state.author);
    const target = images[bots.indexOf(author)];
    const i = b.name === 'Chloé' ? 0 : b.state.options.findIndex((o) => o.url === target);
    assert.ok(i >= 0, 'la bonne image est parmi les 4');
    b.s.emit('guess', i);
  }
  await until(() => bots.every((b) => b.state.phase === 'reveal'));
  const res = bots[0].state.results;
  assert.equal(res.length, 3);
  assert.ok(res.find((r) => r.guesser === 'Alice').correct && res.find((r) => r.guesser === 'Bob').correct);
  console.log(`Manche ${round} :`, res.map((r) => `${r.guesser}→${r.author} ${r.correct ? '✓' : '✗'} (${r.query})`).join(' | '));
  bots[0].s.emit('next');
}

await until(() => bots.every((b) => b.state.phase === 'end'));
console.log('Scores :', bots[0].state.players.map((p) => `${p.name}=${p.score}`).join(', '));
assert.ok(bots[0].state.players.find((p) => p.name === 'Alice').score >= 2);

// Reconnexion : Bob se déconnecte puis revient avec le même identifiant.
bots[1].s.disconnect();
await until(() => bots[0].state.players.find((p) => p.name === 'Bob').connected === false);
const bob2 = io(url, { transports: ['websocket'] });
assert.ok((await new Promise((r) => bob2.emit('join', { code: created.code, playerId: bots[1].id }, r))).ok);
await until(() => bots[0].state.players.find((p) => p.name === 'Bob').connected);

console.log('OK : partie complète simulée sans erreur');
bots.forEach((b) => b.s.close());
bob2.close();
server.close();
process.exit(0);
