const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const rooms = new Map();
const wins = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => {
  let c = '';
  for (let i = 0; i < 6; i++) {
    c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return c;
};

function snapshot(room) {
  return {
    board: room.board,
    turn: room.turn,
    winner: room.winner,
    players: room.players.map(p => ({ name: p.name, symbol: p.symbol })),
    round: room.round
  };
}

function broadcast(id) {
  const room = rooms.get(id);
  if (room) {
    io.to(id).emit('state', snapshot(room));
  }
}

function error(socket, message) {
  socket.emit('game-error', message);
}

io.on('connection', socket => {
  socket.on('create-room', raw => {
    if (socket.data.room) return error(socket, 'Already in a room. Refresh to switch rooms.');
    let id;
    let attempts = 0;
    do {
      id = code();
      attempts++;
    } while (rooms.has(id) && attempts < 100);

    const name = String(raw || 'Player 1').trim().slice(0, 24) || 'Player 1';
    rooms.set(id, {
      players: [{ id: socket.id, name, symbol: 'X' }],
      board: Array(9).fill(null),
      turn: 'X',
      winner: null,
      round: 1
    });

    socket.join(id);
    socket.data.room = id;
    socket.emit('joined', { room: id, symbol: 'X' });
    broadcast(id);
  });

  socket.on('join-room', payload => {
    if (socket.data.room) return error(socket, 'Already in a room. Refresh to switch rooms.');
    const data = (payload && typeof payload === 'object') ? payload : {};
    const id = String(data.room || '').trim().toUpperCase();
    const room = rooms.get(id);

    if (!room) return error(socket, 'Room not found. Check the code.');
    if (room.players.length >= 2) return error(socket, 'Room is full.');

    const name = String(data.name || 'Player 2').trim().slice(0, 24) || 'Player 2';
    room.players.push({ id: socket.id, name, symbol: 'O' });
    socket.join(id);
    socket.data.room = id;
    socket.emit('joined', { room: id, symbol: 'O' });
    broadcast(id);
  });

  socket.on('move', index => {
    const id = socket.data.room;
    const room = rooms.get(id);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (
      room.players.length !== 2 ||
      !player ||
      room.winner ||
      room.turn !== player.symbol ||
      !Number.isInteger(index) ||
      index < 0 ||
      index > 8 ||
      room.board[index] !== null
    ) {
      return;
    }

    room.board[index] = player.symbol;
    if (wins.some(line => line.every(i => room.board[i] === player.symbol))) {
      room.winner = player.symbol;
    } else if (room.board.every(Boolean)) {
      room.winner = 'draw';
    } else {
      room.turn = room.turn === 'X' ? 'O' : 'X';
    }
    broadcast(id);
  });

  socket.on('rematch', () => {
    const id = socket.data.room;
    const room = rooms.get(id);
    if (!room || room.players.length !== 2 || !room.winner) return;

    room.board = Array(9).fill(null);
    room.winner = null;
    room.round++;
    room.turn = room.round % 2 === 1 ? 'X' : 'O';
    broadcast(id);
  });

  socket.on('disconnect', () => {
    const id = socket.data.room;
    if (!id) return;
    const room = rooms.get(id);
    if (!room) return;

    rooms.delete(id);
    io.to(id).emit('opponent-left');
  });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/favicon.ico', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.svg'));
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Neon Grid game server running on http://0.0.0.0:${PORT}`);
  });
}

module.exports = { app, server, io, rooms };
