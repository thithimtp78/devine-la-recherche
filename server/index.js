import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { Room, newCode } from './game.js';
import { activeProvider } from './images.js';

const app = express();
const server = createServer(app);
const io = new Server(server);
const rooms = new Map(); // code -> Room

app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, images: activeProvider() }));

function broadcast(room) {
  for (const s of io.sockets.adapter.rooms.get(room.code) ?? []) {
    const sock = io.sockets.sockets.get(s);
    if (sock?.data.playerId) sock.emit('state', room.viewFor(sock.data.playerId));
  }
}

const cleanName = (n) => String(n || '').trim().slice(0, 20);

io.on('connection', (socket) => {
  const room = () => rooms.get(socket.data.code);

  function enter(code, playerId, name, ack) {
    const r = rooms.get(code);
    if (!r) return ack?.({ error: 'Cette room n’existe pas.' });
    const known = r.players.has(playerId);
    if (!known && r.players.size >= 12) return ack?.({ error: 'La room est pleine.' });
    socket.data = { code, playerId };
    socket.join(code);
    r.addPlayer(playerId, name);
    ack?.({ ok: true, code });
  }

  socket.on('create', ({ playerId, name }, ack) => {
    name = cleanName(name);
    if (!name || !playerId) return ack?.({ error: 'Choisis un pseudo.' });
    const code = newCode(rooms);
    const r = new Room(code, () => broadcast(r));
    rooms.set(code, r);
    enter(code, playerId, name, ack);
  });

  socket.on('join', ({ code, playerId, name }, ack) => {
    name = cleanName(name);
    code = String(code || '').trim().toUpperCase();
    if (!playerId) return ack?.({ error: 'Identifiant manquant.' });
    const r = rooms.get(code);
    if (r && !r.players.has(playerId) && !name) return ack?.({ error: 'Choisis un pseudo.' });
    enter(code, playerId, name, ack);
  });

  socket.on('settings', (s) => room()?.updateSettings(socket.data.playerId, s || {}));
  socket.on('start', (_, ack) => {
    const err = room()?.start(socket.data.playerId);
    ack?.(err ? { error: err } : { ok: true });
  });
  socket.on('phrase', (text) => room()?.submitPhrase(socket.data.playerId, text));
  socket.on('guess', (index) => room()?.submitGuess(socket.data.playerId, index));
  socket.on('next', () => room()?.nextRound(socket.data.playerId));
  socket.on('lobby', () => room()?.backToLobby(socket.data.playerId));

  socket.on('leave', () => {
    const r = room();
    if (!r) return;
    socket.leave(r.code);
    r.players.get(socket.data.playerId) && r.setConnected(socket.data.playerId, false);
    socket.data = {};
  });

  socket.on('disconnect', () => {
    const r = room();
    if (!r) return;
    // Le joueur peut avoir un autre onglet encore ouvert sur la même room.
    const stillHere = [...(io.sockets.adapter.rooms.get(r.code) ?? [])].some(
      (s) => io.sockets.sockets.get(s)?.data.playerId === socket.data.playerId,
    );
    if (!stillHere) r.setConnected(socket.data.playerId, false);
  });
});

setInterval(() => {
  for (const [code, r] of rooms) if (r.isStale()) rooms.delete(code);
}, 60 * 1000).unref();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Devine la recherche sur http://localhost:${PORT} (images : ${activeProvider()})`));

export { server, rooms };
