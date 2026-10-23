// Test de bout en bout : 3 navigateurs jouent une partie complète en pair-à-pair.
// Lance un serveur PeerJS local qui sert aussi docs/, puis pilote Chromium avec Playwright.
// Usage : node test/e2e.mjs [dossier-captures]
import { ExpressPeerServer } from 'peer';
import express from 'express';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const shots = process.argv[2];
const app = express();
const web = app.listen(8123, '127.0.0.1');
app.use('/peerjs', ExpressPeerServer(web, { path: '/' }));
app.use(express.static(fileURLToPath(new URL('../docs/', import.meta.url))));

const base = 'http://localhost:8123/?peerhost=localhost&peerport=8123&peerpath=/peerjs&peersecure=0&images=demo';
const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
const open = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('ERREUR PAGE', e.message));
  await page.goto(base);
  return page;
};
const visible = (p, id) => p.waitForSelector(`#${id}:not(.hidden)`, { timeout: 20000 });

const [alice, bob, chloe] = [await open(), await open(), await open()];
const players = [alice, bob, chloe];
await alice.fill('#name', 'Alice');
await alice.click('#createBtn');
await visible(alice, 'lobby');
const code = await alice.textContent('#lobbyCode');
assert.match(code, /^[A-Z]{4}$/);

// Code inexistant
await bob.fill('#name', 'Bob');
await bob.fill('#codeInput', 'ZZZZ');
await bob.click('#joinBtn');
await bob.waitForSelector('#toast:not(.hidden)', { timeout: 20000 });
console.log('Code inexistant →', await bob.textContent('#toast'));

for (const [p, n] of [[bob, 'Bob'], [chloe, 'Chloé']]) {
  await p.fill('#name', n);
  await p.fill('#codeInput', code);
  await p.click('#joinBtn');
  await visible(p, 'lobby');
}
await alice.waitForFunction(() => document.querySelectorAll('#lobbyPlayers li').length === 3);
if (shots) await bob.screenshot({ path: `${shots}/lobby.png` });

await alice.fill('#setRounds', '2');
await alice.dispatchEvent('#setRounds', 'change');
await alice.click('#startBtn');

for (let round = 1; round <= 2; round++) {
  await Promise.all(players.map((p) => visible(p, 'write')));
  for (const [i, p] of players.entries()) {
    await p.fill('#phraseInput', `recherche ${i} manche ${round}`);
    await p.click('#writeForm button');
  }
  await Promise.all(players.map((p) => visible(p, 'guess')));
  await alice.waitForTimeout(200);
  if (shots && round === 1) await chloe.screenshot({ path: `${shots}/guess.png` });
  for (const p of players) await p.click('#options .option >> nth=0');
  await Promise.all(players.map((p) => visible(p, 'reveal')));
  assert.equal(await bob.locator('#results .result').count(), 3);
  console.log(`Manche ${round} : résultats affichés chez les 3 joueurs`);
  if (round === 1) {
    // Bob rafraîchit sa page en plein milieu : il doit revenir dans la room.
    await bob.reload();
    await visible(bob, 'reveal');
    console.log('Bob a rafraîchi sa page et est revenu dans la partie');
  }
  await alice.click('#nextBtn');
}
await Promise.all(players.map((p) => visible(p, 'end')));
console.log('Classement :', (await chloe.textContent('#finalScores')).replace(/\s+/g, ' ').trim());
if (shots) await chloe.screenshot({ path: `${shots}/end.png` });

// L'hôte rafraîchit : la room est recréée avec le même code et les autres reviennent dans la salle.
await alice.reload();
await visible(alice, 'lobby');
assert.equal(await alice.textContent('#lobbyCode'), code);
await alice.waitForFunction(() => document.querySelectorAll('#lobbyPlayers li').length === 3, null, { timeout: 45000 });
console.log("L'hôte a rafraîchi sa page : room recréée, les 3 joueurs sont revenus");

// L'hôte quitte : les autres sont renvoyés à l'accueil avec un message.
await alice.close({ runBeforeUnload: true });
await bob.waitForSelector('#home:not(.hidden)', { timeout: 45000 });
console.log('Hôte parti →', await bob.textContent('#toast'));

console.log('OK : partie pair-à-pair complète');
await browser.close();
web.close();
process.exit(0);
