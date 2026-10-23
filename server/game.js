import { QUERIES } from './queries.js';
import { imageFor } from './images.js';

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const STOPWORDS = new Set(
  'le la les un une des de du d l a au aux et en sur sous dans avec qui que pour par son sa ses se ce cet cette est the of'.split(' '),
);
const EMPTY_PHRASE = '(pas de réponse…)';
const ROOM_TTL_MS = 30 * 60 * 1000;

export const DEFAULT_SETTINGS = { rounds: 3, writeTime: 60, guessTime: 30 };

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const words = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));

// Mots de la vraie recherche retrouvés par le joueur (en ignorant accents et petits mots).
export function sharedWords(phrase, query) {
  const target = new Set(words(query));
  return [...new Set(words(phrase))].filter((w) => target.has(w) || target.has(w.replace(/s$/, '')));
}

export class Room {
  constructor(code, onChange) {
    this.code = code;
    this.onChange = onChange; // appelé à chaque changement d'état, pour diffuser aux joueurs
    this.players = new Map(); // id -> { id, name, score, connected }
    this.hostId = null;
    this.phase = 'lobby'; // lobby | loading | write | guess | reveal | end
    this.settings = { ...DEFAULT_SETTINGS };
    this.roundNo = 0;
    this.round = null;
    this.deadline = null;
    this.timer = null;
    this.usedQueries = new Set();
    this.lastActivity = Date.now();
  }

  touch() {
    this.lastActivity = Date.now();
  }

  isStale() {
    const anyone = [...this.players.values()].some((p) => p.connected);
    return !anyone && Date.now() - this.lastActivity > ROOM_TTL_MS;
  }

  addPlayer(id, name) {
    const existing = this.players.get(id);
    if (existing) {
      existing.connected = true;
      if (name) existing.name = name;
    } else {
      this.players.set(id, { id, name, score: 0, connected: true });
    }
    if (!this.hostId || !this.players.get(this.hostId)?.connected) this.hostId = id;
    this.touch();
    this.onChange();
  }

  setConnected(id, connected) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = connected;
    if (!connected && this.hostId === id) {
      const next = [...this.players.values()].find((x) => x.connected);
      if (next) this.hostId = next.id;
    }
    if (!connected && this.phase === 'lobby') this.players.delete(id);
    this.touch();
    this.checkPhaseDone();
    this.onChange();
  }

  updateSettings(by, s) {
    if (by !== this.hostId || this.phase !== 'lobby') return;
    const clamp = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
    this.settings = {
      rounds: clamp(s.rounds, 1, 10, this.settings.rounds),
      writeTime: clamp(s.writeTime, 15, 180, this.settings.writeTime),
      guessTime: clamp(s.guessTime, 10, 120, this.settings.guessTime),
    };
    this.onChange();
  }

  connectedIds() {
    return [...this.players.values()].filter((p) => p.connected).map((p) => p.id);
  }

  start(by) {
    if (by !== this.hostId || !['lobby', 'end'].includes(this.phase)) return 'Seul l’hôte peut lancer la partie.';
    if (this.connectedIds().length < 2) return 'Il faut au moins 2 joueurs.';
    for (const p of this.players.values()) p.score = 0;
    this.roundNo = 0;
    this.usedQueries.clear();
    this.nextRound(by);
    return null;
  }

  pickQueries(n) {
    let pool = QUERIES.filter((x) => !this.usedQueries.has(x.q));
    if (pool.length < n) {
      this.usedQueries.clear();
      pool = QUERIES;
    }
    const picked = shuffle(pool).slice(0, n);
    picked.forEach((x) => this.usedQueries.add(x.q));
    return picked;
  }

  async nextRound(by) {
    if (by !== undefined && by !== this.hostId) return;
    if (!['lobby', 'reveal', 'end'].includes(this.phase)) return;
    if (this.roundNo >= this.settings.rounds && this.phase === 'reveal') return this.finish();

    const participants = shuffle(this.connectedIds());
    if (participants.length < 2) {
      this.phase = 'lobby';
      return this.onChange();
    }
    this.roundNo += 1;
    this.phase = 'loading';
    this.onChange();

    // Une recherche secrète par joueur, plus quelques "leurres" pour compléter les 4 propositions.
    const extraCount = Math.max(2, 5 - participants.length);
    const items = this.pickQueries(participants.length + extraCount);
    const images = await Promise.all(items.map((it) => imageFor(it)));
    const entries = items.map((item, i) => ({ item, image: images[i] }));

    const targets = new Map(participants.map((id, i) => [id, entries[i]]));
    const extras = entries.slice(participants.length);

    // Chaque joueur devine la phrase d'un autre ; le décalage change à chaque manche.
    const n = participants.length;
    const offset = ((this.roundNo - 1) % (n - 1)) + 1;
    const assignment = new Map(participants.map((id, i) => [id, participants[(i + n - offset) % n]]));

    const options = new Map();
    for (const [guesser, author] of assignment) {
      const decoys = shuffle([
        ...participants.filter((id) => id !== author && id !== guesser).map((id) => targets.get(id)),
        ...extras,
      ]).slice(0, 3);
      const opts = shuffle([{ ...targets.get(author), correct: true }, ...decoys]);
      options.set(guesser, opts);
    }

    this.round = { participants, targets, assignment, options, phrases: new Map(), guesses: new Map(), results: [] };
    this.setPhase('write', this.settings.writeTime);
  }

  setPhase(phase, seconds) {
    clearTimeout(this.timer);
    this.phase = phase;
    this.deadline = seconds ? Date.now() + seconds * 1000 : null;
    if (seconds) this.timer = setTimeout(() => this.timeUp(), seconds * 1000 + 500);
    this.touch();
    this.onChange();
  }

  timeUp() {
    if (this.phase === 'write') this.startGuess();
    else if (this.phase === 'guess') this.reveal();
  }

  submitPhrase(id, text) {
    if (this.phase !== 'write' || !this.round.participants.includes(id)) return;
    const phrase = String(text || '').trim().slice(0, 80);
    if (!phrase) return;
    this.round.phrases.set(id, phrase);
    this.touch();
    this.checkPhaseDone();
    this.onChange();
  }

  submitGuess(id, index) {
    if (this.phase !== 'guess' || !this.round.assignment.has(id) || this.round.guesses.has(id)) return;
    const i = Number(index);
    if (!(i >= 0 && i < this.round.options.get(id).length)) return;
    this.round.guesses.set(id, i);
    this.touch();
    this.checkPhaseDone();
    this.onChange();
  }

  // Passe à la suite dès que tous les joueurs encore connectés ont répondu.
  checkPhaseDone() {
    if (!this.round) return;
    const active = this.round.participants.filter((id) => this.players.get(id)?.connected);
    if (this.phase === 'write' && active.every((id) => this.round.phrases.has(id))) this.startGuess();
    else if (this.phase === 'guess' && active.every((id) => this.round.guesses.has(id))) this.reveal();
  }

  startGuess() {
    if (this.phase !== 'write') return;
    this.setPhase('guess', this.settings.guessTime);
  }

  reveal() {
    if (this.phase !== 'guess') return;
    const r = this.round;
    r.results = [];
    for (const [guesser, author] of r.assignment) {
      const opts = r.options.get(guesser);
      const choice = r.guesses.get(guesser);
      const correct = choice !== undefined && opts[choice].correct;
      const phrase = r.phrases.get(author) || EMPTY_PHRASE;
      const found = r.phrases.has(author) ? sharedWords(phrase, r.targets.get(author).item.q) : [];
      const bonus = Math.min(3, found.length);
      const authorPts = (correct ? 1 : 0) + bonus;
      const guesserPts = correct ? 1 : 0;
      const a = this.players.get(author);
      const g = this.players.get(guesser);
      if (a) a.score += authorPts;
      if (g) g.score += guesserPts;
      r.results.push({
        author: a?.name ?? '?',
        guesser: g?.name ?? '?',
        query: r.targets.get(author).item.q,
        image: r.targets.get(author).image,
        phrase,
        found,
        correct,
        chosen: choice !== undefined ? opts[choice].image : null,
        authorPts,
        guesserPts,
      });
    }
    this.setPhase('reveal');
  }

  finish() {
    clearTimeout(this.timer);
    this.phase = 'end';
    this.deadline = null;
    this.onChange();
  }

  backToLobby(by) {
    if (by !== this.hostId) return;
    clearTimeout(this.timer);
    this.phase = 'lobby';
    this.round = null;
    this.roundNo = 0;
    for (const [id, p] of this.players) if (!p.connected) this.players.delete(id);
    this.onChange();
  }

  // Vue personnalisée : chaque joueur ne reçoit que ce qu'il a le droit de voir.
  viewFor(id) {
    const r = this.round;
    const players = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      connected: p.connected,
      host: p.id === this.hostId,
      done:
        (this.phase === 'write' && r?.phrases.has(p.id)) || (this.phase === 'guess' && r?.guesses.has(p.id)) || false,
      playing: !!r?.participants.includes(p.id),
    }));
    const view = {
      code: this.code,
      you: id,
      isHost: id === this.hostId,
      phase: this.phase,
      players,
      settings: this.settings,
      roundNo: this.roundNo,
      rounds: this.settings.rounds,
      deadline: this.deadline,
      now: Date.now(),
    };
    const playing = r?.participants.includes(id);
    if (this.phase === 'write' && playing) {
      view.image = r.targets.get(id).image;
      view.myPhrase = r.phrases.get(id) || null;
    }
    if (this.phase === 'guess' && playing) {
      const author = r.assignment.get(id);
      view.phrase = r.phrases.get(author) || EMPTY_PHRASE;
      view.author = this.players.get(author)?.name;
      view.options = r.options.get(id).map((o) => o.image);
      view.myGuess = r.guesses.has(id) ? r.guesses.get(id) : null;
    }
    if (this.phase === 'reveal') {
      view.results = r.results;
      view.lastRound = this.roundNo >= this.settings.rounds;
    }
    return view;
  }
}

export function newCode(existing) {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join('');
  } while (existing.has(code));
  return code;
}
