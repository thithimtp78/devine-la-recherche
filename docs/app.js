import { Host, Guest } from './net.js';
import { setProvider } from './images.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const params = new URLSearchParams(location.search);
if (params.get('images')) setProvider(params.get('images'));

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

let playerId = store.get('dlr.id');
if (!playerId) {
  playerId = (crypto.randomUUID?.() || String(Math.random()).slice(2)) + '';
  store.set('dlr.id', playerId);
}

let state = null;
let skew = 0; // décalage horloge serveur - client

$('#name').value = store.get('dlr.name') || '';
const urlCode = params.get('room');
if (urlCode) $('#codeInput').value = urlCode.toUpperCase();

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), 2600);
}

function show(id) {
  $$('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id));
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function setImg(img, image) {
  img.onerror = () => {
    if (image.thumb && img.src !== image.thumb) img.src = image.thumb;
  };
  img.referrerPolicy = 'no-referrer';
  img.src = image.url;
}

function name() {
  const n = $('#name').value.trim();
  if (!n) {
    toast('Choisis un pseudo');
    $('#name').focus();
    return null;
  }
  store.set('dlr.name', n);
  return n;
}

let net = null; // Host ou Guest
const send = (type, data) => net?.send(type, data) ?? Promise.resolve();

function onState(s) {
  const prevPhase = state?.phase;
  const prevRound = state?.roundNo;
  state = s;
  skew = s.now - Date.now();
  render(prevPhase !== s.phase || prevRound !== s.roundNo);
}

function goHome(msg) {
  net?.close();
  net = null;
  state = null;
  store.set('dlr.room', null);
  store.set('dlr.role', null);
  params.delete('room');
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  $('#roomBadge').classList.add('hidden');
  setBusy(false);
  show('home');
  if (msg) toast(msg);
}

function inRoom(code, role) {
  store.set('dlr.room', code);
  store.set('dlr.role', role);
  params.set('room', code);
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

function setBusy(busy, label) {
  $('#createBtn').disabled = $('#joinBtn').disabled = busy;
  $('#createBtn').textContent = busy && label === 'create' ? 'Création…' : 'Créer une room';
  $('#joinBtn').textContent = busy && label === 'join' ? 'Connexion…' : 'Rejoindre';
}

async function createRoom(n, code) {
  setBusy(true, 'create');
  const host = new Host(playerId, onState);
  try {
    net = host;
    inRoom(await host.open(n, code), 'host');
  } catch (err) {
    console.error(err);
    goHome(err.type === 'unavailable-id' ? 'Ce code est déjà pris, réessaie.' : 'Impossible de créer la room (connexion).');
  }
}

async function joinRoom(code, n) {
  setBusy(true, 'join');
  const guest = new Guest(playerId, onState, () => goHome('Connexion perdue : l’hôte a quitté la partie.'));
  net = guest;
  let res;
  try {
    res = await guest.open(code, n);
  } catch (err) {
    console.error(err);
    res = { error: 'Impossible de joindre le service de connexion.' };
  }
  if (res?.error) return goHome(res.error);
  inRoom(code, 'guest');
}

$('#createBtn').onclick = () => {
  const n = name();
  if (n) createRoom(n);
};
$('#joinBtn').onclick = () => {
  const n = name();
  const code = $('#codeInput').value.trim().toUpperCase();
  if (!n) return;
  if (code.length !== 4) return toast('Le code fait 4 lettres');
  joinRoom(code, n);
};
$('#codeInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('#joinBtn').click());

$('#copyLink').onclick = async () => {
  const link = `${location.origin}${location.pathname}?room=${state.code}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Lien copié !');
  } catch {
    prompt('Copie ce lien :', link);
  }
};
$('#leaveBtn').onclick = () => goHome();

for (const [sel, key] of [['#setRounds', 'rounds'], ['#setWrite', 'writeTime'], ['#setGuess', 'guessTime']]) {
  $(sel).addEventListener('change', (e) => send('settings', { ...state.settings, [key]: e.target.value }));
}
const start = () => send('start').then((r) => r?.error && toast(r.error));
$('#startBtn').onclick = start;
$('#againBtn').onclick = start;
$('#toLobbyBtn').onclick = () => send('lobby');
$('#nextBtn').onclick = () => send('next');

$('#writeForm').onsubmit = (e) => {
  e.preventDefault();
  const v = $('#phraseInput').value.trim();
  if (!v) return toast('Écris une recherche');
  send('phrase', v);
};

// Retour dans la room après un rafraîchissement de page. L'hôte recrée sa room avec le même code
// (la partie en cours est perdue, les autres joueurs se reconnectent tout seuls).
{
  const code = store.get('dlr.room');
  const n = store.get('dlr.name');
  if (code && n && (!urlCode || urlCode.toUpperCase() === code)) {
    store.get('dlr.role') === 'host' ? createRoom(n, code) : joinRoom(code, n);
  }
}

window.addEventListener('beforeunload', () => net?.close());

function playersList(el, { scores = false } = {}) {
  el.innerHTML = state.players
    .map((p) => {
      const cls = [!p.connected && 'off', p.done && 'done'].filter(Boolean).join(' ');
      const label = `${p.host ? '👑 ' : ''}${esc(p.name)}${p.id === state.you ? ' (toi)' : ''}${scores ? ` · ${p.score}` : ''}`;
      return `<li class="${cls}">${label}</li>`;
    })
    .join('');
}

function scoresList(el) {
  el.innerHTML = [...state.players]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => `<li>${i === 0 && state.phase === 'end' ? '🏆 ' : ''}${esc(p.name)} <span>${p.score} pt${p.score > 1 ? 's' : ''}</span></li>`)
    .join('');
}

function highlight(phrase, found) {
  if (!found?.length) return esc(phrase);
  const norm = (w) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return phrase
    .split(/(\s+)/)
    .map((w) => {
      const n = norm(w).replace(/[^a-z0-9]/g, '');
      return found.includes(n) ? `<mark>${esc(w)}</mark>` : esc(w);
    })
    .join('');
}

function render(phaseChanged) {
  const s = state;
  $('#roomBadge').textContent = s.code;
  $('#roomBadge').classList.remove('hidden');
  $$('.round').forEach((el) => (el.textContent = `Manche ${s.roundNo} / ${s.rounds}`));
  const me = s.players.find((p) => p.id === s.you);

  if (s.phase === 'lobby') {
    show('lobby');
    $('#lobbyCode').textContent = s.code;
    playersList($('#lobbyPlayers'));
    $('#hostSettings').classList.toggle('hidden', !s.isHost);
    $('#startBtn').classList.toggle('hidden', !s.isHost);
    $('#startBtn').disabled = s.players.filter((p) => p.connected).length < 2;
    $('#startBtn').textContent = $('#startBtn').disabled ? 'Il faut au moins 2 joueurs' : 'Lancer la partie';
    $('#waitHost').classList.toggle('hidden', s.isHost);
    for (const [sel, key] of [['#setRounds', 'rounds'], ['#setWrite', 'writeTime'], ['#setGuess', 'guessTime']]) {
      if (document.activeElement !== $(sel)) $(sel).value = s.settings[key];
    }
    return;
  }

  if (s.phase === 'loading') return show('loading');

  if ((s.phase === 'write' || s.phase === 'guess') && !me?.playing) {
    show('spectate');
    return playersList($('#spectate .players'));
  }

  if (s.phase === 'write') {
    show('write');
    if (phaseChanged) {
      setImg($('#writeImg'), s.image);
      $('#phraseInput').value = '';
      setTimeout(() => $('#phraseInput').focus(), 50);
    }
    const done = !!s.myPhrase;
    $('#writeForm').classList.toggle('hidden', done);
    $('#writeDone').classList.toggle('hidden', !done);
    $('#writeDone').textContent = done ? `Ta recherche : « ${s.myPhrase} ». On attend les autres…` : '';
    return playersList($('#write .players'));
  }

  if (s.phase === 'guess') {
    show('guess');
    $('#guessAuthor').textContent = s.author;
    $('#guessPhrase').textContent = s.phrase;
    if (phaseChanged) {
      const box = $('#options');
      box.innerHTML = '';
      s.options.forEach((image, i) => {
        const b = document.createElement('button');
        b.className = 'option';
        b.setAttribute('aria-label', `Image ${i + 1}`);
        const img = document.createElement('img');
        img.alt = '';
        setImg(img, image);
        b.appendChild(img);
        b.onclick = () => send('guess', i);
        box.appendChild(b);
      });
    }
    $$('#options .option').forEach((b, i) => {
      b.disabled = s.myGuess !== null;
      b.classList.toggle('picked', s.myGuess === i);
    });
    $('#guessDone').classList.toggle('hidden', s.myGuess === null);
    return playersList($('#guess .players'));
  }

  if (s.phase === 'reveal') {
    show('reveal');
    $('#results').innerHTML = s.results
      .map(
        (r) => `<div class="result">
          <img src="${esc(r.image.thumb || r.image.url)}" alt="" referrerpolicy="no-referrer" />
          <div>
            <div class="q">🔍 ${esc(r.query)}</div>
            <div class="p">« ${highlight(r.phrase, r.found)} » <span class="meta">— ${esc(r.author)} (+${r.authorPts})</span></div>
            <div class="meta">${esc(r.guesser)} : <span class="tag ${r.correct ? 'ok' : 'ko'}">${r.correct ? 'trouvé ✓' : r.chosen ? 'raté ✗' : 'pas répondu'}</span> (+${r.guesserPts})</div>
          </div>
        </div>`,
      )
      .join('');
    scoresList($('#scores'));
    $('#nextBtn').classList.toggle('hidden', !s.isHost);
    $('#nextBtn').textContent = s.lastRound ? 'Voir le classement' : 'Manche suivante';
    $('#waitNext').classList.toggle('hidden', s.isHost);
    return;
  }

  if (s.phase === 'end') {
    show('end');
    scoresList($('#finalScores'));
    $('#againBtn').classList.toggle('hidden', !s.isHost);
    $('#toLobbyBtn').classList.toggle('hidden', !s.isHost);
    $('#waitAgain').classList.toggle('hidden', s.isHost);
  }
}

// Compte à rebours
setInterval(() => {
  if (!state?.deadline) return;
  const left = Math.max(0, Math.ceil((state.deadline - (Date.now() + skew)) / 1000));
  $$('.timer').forEach((el) => {
    el.textContent = `${left}s`;
    el.classList.toggle('urgent', left <= 10);
  });
}, 250);
