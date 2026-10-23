// Connexion entre joueurs, sans serveur de jeu : le navigateur de l'hôte fait tourner la partie
// et les autres s'y connectent en pair-à-pair (WebRTC via PeerJS). Le code de room sert d'adresse.
import { Room, newCode } from './game.js';

const PREFIX = 'devine-la-recherche-';
const PING_MS = 4000;
const TIMEOUT_MS = 13000;

// Serveur de mise en relation PeerJS : le serveur public gratuit par défaut,
// ou un autre passé dans l'URL (?peerhost=…&peerport=…&peerpath=…&peersecure=0).
function peerOptions() {
  const q = new URLSearchParams(location.search);
  const opts = { debug: 1 };
  if (q.get('peerhost')) {
    opts.host = q.get('peerhost');
    opts.port = Number(q.get('peerport')) || 443;
    opts.path = q.get('peerpath') || '/';
    opts.secure = q.get('peersecure') !== '0';
  }
  return opts;
}

function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
    const fail = (err) => {
      peer.destroy();
      reject(err);
    };
    peer.once('open', () => {
      peer.off('error', fail);
      resolve(peer);
    });
    peer.once('error', fail);
  });
}

// L'hôte : héberge la Room et répond aux actions des autres joueurs.
export class Host {
  constructor(playerId, onState) {
    this.playerId = playerId;
    this.onState = onState;
    this.guests = new Map(); // conn -> { playerId, lastSeen }
  }

  // Crée la room. `code` permet de la recréer à l'identique après un rafraîchissement de page.
  async open(name, code) {
    for (let attempt = 0; ; attempt++) {
      const c = code || newCode(new Set());
      try {
        this.peer = await openPeer(PREFIX + c);
        this.code = c;
        break;
      } catch (err) {
        if (err.type !== 'unavailable-id' || attempt >= 4) throw err;
        if (code) await new Promise((r) => setTimeout(r, 2000)); // l'ancien onglet libère le code
      }
    }
    this.room = new Room(this.code, () => this.broadcast());
    this.peer.on('connection', (conn) => this.accept(conn));
    this.peer.on('disconnected', () => this.peer.reconnect());
    this.peer.on('error', (err) => console.warn('[host]', err.type, err.message));
    this.watchdog = setInterval(() => this.dropSilent(), PING_MS);
    this.room.addPlayer(this.playerId, name);
    return this.code;
  }

  accept(conn) {
    conn.on('data', (msg) => this.receive(conn, msg));
    conn.on('close', () => this.drop(conn));
    conn.on('error', () => this.drop(conn));
  }

  receive(conn, msg) {
    const guest = this.guests.get(conn);
    if (guest) guest.lastSeen = Date.now();
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'ping') return conn.send({ t: 'pong' });
    const reply = (res) => msg.id && conn.send({ t: 'ack', id: msg.id, res });

    if (msg.t === 'join') {
      const playerId = String(msg.playerId || '').slice(0, 64);
      const name = String(msg.name || '').trim().slice(0, 20);
      const known = this.room.players.has(playerId);
      if (!playerId) return reply({ error: 'Identifiant manquant.' });
      if (!known && !name) return reply({ error: 'Choisis un pseudo.' });
      if (!known && this.room.players.size >= 12) return reply({ error: 'La room est pleine.' });
      // Le même joueur revient (page rafraîchie) : on oublie l'ancienne connexion.
      for (const [c, g] of this.guests) if (g.playerId === playerId && c !== conn) this.guests.delete(c), c.close();
      this.guests.set(conn, { playerId, lastSeen: Date.now() });
      reply({ ok: true, code: this.code });
      this.room.addPlayer(playerId, name);
      return;
    }
    if (guest) reply(this.act(guest.playerId, msg.t, msg.data));
  }

  // Actions de jeu, identiques pour l'hôte et pour les autres joueurs.
  act(playerId, type, data) {
    const r = this.room;
    switch (type) {
      case 'settings': return r.updateSettings(playerId, data || {});
      case 'start': {
        const err = r.start(playerId);
        return err ? { error: err } : { ok: true };
      }
      case 'phrase': return r.submitPhrase(playerId, data);
      case 'guess': return r.submitGuess(playerId, data);
      case 'next': return void r.nextRound(playerId);
      case 'lobby': return r.backToLobby(playerId);
      case 'leave': return r.setConnected(playerId, false);
    }
  }

  send(type, data) {
    return Promise.resolve(this.act(this.playerId, type, data));
  }

  drop(conn) {
    const guest = this.guests.get(conn);
    if (!guest) return;
    this.guests.delete(conn);
    const stillHere = [...this.guests.values()].some((g) => g.playerId === guest.playerId);
    if (!stillHere) this.room.setConnected(guest.playerId, false);
  }

  dropSilent() {
    for (const [conn, g] of this.guests) {
      if (Date.now() - g.lastSeen > TIMEOUT_MS) {
        this.drop(conn);
        conn.close();
      }
    }
  }

  broadcast() {
    for (const [conn, g] of this.guests) if (conn.open) conn.send({ t: 'state', view: this.room.viewFor(g.playerId) });
    this.onState(this.room.viewFor(this.playerId));
  }

  close() {
    for (const conn of this.guests.keys()) conn.open && conn.send({ t: 'bye' });
    clearInterval(this.watchdog);
    clearTimeout(this.room?.timer);
    setTimeout(() => this.peer?.destroy(), 200);
  }
}

// Un joueur invité : se connecte au navigateur de l'hôte et relaie ses actions.
export class Guest {
  constructor(playerId, onState, onLost) {
    this.playerId = playerId;
    this.onState = onState;
    this.onLost = onLost; // appelé quand l'hôte est définitivement injoignable
    this.pending = new Map();
    this.seq = 0;
  }

  async open(code, name) {
    this.code = code;
    this.name = name;
    if (!this.peer || this.peer.destroyed) this.peer = await openPeer();
    return this.connect();
  }

  connect() {
    return new Promise((resolve) => {
      const conn = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
      let settled = false;
      const done = (res) => {
        if (settled) return;
        settled = true;
        this.peer.off('error', onPeerError);
        resolve(res);
      };
      const onPeerError = (err) => {
        if (err.type === 'peer-unavailable') done({ error: 'Cette room n’existe pas (ou l’hôte est parti).' });
        else if (err.type === 'network' || err.type === 'server-error') done({ error: 'Impossible de joindre le service de connexion.' });
      };
      this.peer.on('error', onPeerError);
      setTimeout(() => done({ error: 'L’hôte ne répond pas.' }), 15000);

      conn.on('open', async () => {
        this.conn = conn;
        this.lastSeen = Date.now();
        const res = await this.request('join', { playerId: this.playerId, name: this.name }, true);
        if (res?.error) conn.close();
        else this.keepAlive();
        done(res);
      });
      conn.on('data', (msg) => this.receive(msg));
      conn.on('close', () => conn === this.conn && this.lost());
    });
  }

  receive(msg) {
    this.lastSeen = Date.now();
    if (msg?.t === 'state') this.onState(msg.view);
    else if (msg?.t === 'bye') this.lost();
    else if (msg?.t === 'ack') {
      this.pending.get(msg.id)?.(msg.res);
      this.pending.delete(msg.id);
    }
  }

  request(t, payload, flat = false) {
    if (!this.conn?.open) return Promise.resolve({ error: 'Connexion perdue avec l’hôte.' });
    const id = ++this.seq;
    this.conn.send(flat ? { t, id, ...payload } : { t, id, data: payload });
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      setTimeout(() => this.pending.delete(id) && resolve(undefined), 10000);
    });
  }

  send(type, data) {
    return this.request(type, data);
  }

  keepAlive() {
    clearInterval(this.pinger);
    this.pinger = setInterval(() => {
      if (Date.now() - this.lastSeen > TIMEOUT_MS) return this.lost();
      this.conn?.open && this.conn.send({ t: 'ping' });
    }, PING_MS);
  }

  // Connexion perdue : on retente quelques fois (l'hôte a peut-être juste rafraîchi sa page).
  async lost() {
    if (this.reconnecting || this.closed) return;
    this.reconnecting = true;
    clearInterval(this.pinger);
    this.conn?.close();
    this.conn = null;
    for (let i = 0; i < 4 && !this.closed; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        if (this.peer.disconnected) this.peer.reconnect();
        const res = await this.connect();
        if (res?.ok) return void (this.reconnecting = false);
      } catch {}
    }
    this.reconnecting = false;
    if (!this.closed) this.onLost();
  }

  close() {
    this.closed = true;
    clearInterval(this.pinger);
    this.conn?.open && this.conn.send({ t: 'leave' });
    setTimeout(() => this.peer?.destroy(), 200);
  }
}
