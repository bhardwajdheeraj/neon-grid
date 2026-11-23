const assert = require('assert');
const http = require('http');
const { io: Client } = require('socket.io-client');
const { app, server, io } = require('../server');

async function runTests() {
  console.log('--- Starting Neon Grid Automated Test Suite ---');
  
  // Start server on a random available port for testing
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;
  console.log(`Test server running at ${url}`);

  const activeSockets = new Set();
  const createClient = () => {
    const s = Client(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false
    });
    activeSockets.add(s);
    return s;
  };

  const waitFor = (socket, event) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for event: ${event}`)), 4000);
      socket.once(event, data => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  };

  const waitForState = (socket, predicate, desc = '') => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for state: ${desc}`)), 4000);
      const handler = state => {
        if (predicate(state)) {
          clearTimeout(timer);
          socket.off('state', handler);
          resolve(state);
        }
      };
      socket.on('state', handler);
    });
  };

  try {
    // Test 1: Health check endpoint
    console.log('[Test 1] Health check endpoint...');
    const healthRes = await new Promise((resolve, reject) => {
      http.get(`${url}/health`, res => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => resolve(JSON.parse(raw)));
      }).on('error', reject);
    });
    assert.strictEqual(healthRes.ok, true, 'Health check should return ok: true');
    console.log('✓ Health check passed');

    // Test 2: Favicon endpoint
    console.log('[Test 2] Favicon endpoint...');
    const faviconStatus = await new Promise((resolve, reject) => {
      http.get(`${url}/favicon.ico`, res => {
        resolve(res.statusCode);
      }).on('error', reject);
    });
    assert.strictEqual(faviconStatus, 200, 'Favicon should return 200 OK');
    console.log('✓ Favicon endpoint passed');

    // Test 3: Malformed payload resilience
    console.log('[Test 3] Resilient payload handling...');
    const rogue = createClient();
    await waitFor(rogue, 'connect');
    rogue.emit('join-room', null);
    rogue.emit('join-room', 'string-not-object');
    rogue.emit('move', 'invalid-index');
    await new Promise(r => setTimeout(r, 100));
    rogue.disconnect();
    console.log('✓ Malformed payloads handled gracefully without server crash');

    // Test 4: Room creation & joining
    console.log('[Test 4] Two players create and join room...');
    const p1 = createClient();
    const p2 = createClient();

    await Promise.all([waitFor(p1, 'connect'), waitFor(p2, 'connect')]);

    const p1JoinedPromise = waitFor(p1, 'joined');
    p1.emit('create-room', 'Player Alpha');
    const p1Joined = await p1JoinedPromise;
    assert.strictEqual(p1Joined.symbol, 'X');
    assert.strictEqual(p1Joined.room.length, 6, 'Room code should be exactly 6 characters');
    const roomId = p1Joined.room;

    const p2JoinedPromise = waitFor(p2, 'joined');
    const p1StatePromise = waitForState(p1, s => s.players.length === 2, 'both players in room');
    p2.emit('join-room', { room: roomId, name: 'Player Bravo' });
    const p2Joined = await p2JoinedPromise;
    assert.strictEqual(p2Joined.symbol, 'O');
    assert.strictEqual(p2Joined.room, roomId);

    const p1State = await p1StatePromise;
    assert.strictEqual(p1State.players.length, 2);
    assert.strictEqual(p1State.turn, 'X');
    console.log('✓ Room creation, joining, and role assignment passed');

    // Test 5: Turn enforcement (Player 2 cannot move on Player 1 turn)
    console.log('[Test 5] Turn enforcement...');
    p2.emit('move', 0); // Invalid: not O's turn
    await new Promise(r => setTimeout(r, 80));

    const stateMoveXPromise = waitForState(p1, s => s.board[0] === 'X', 'board[0] is X');
    p1.emit('move', 0);
    const stateMoveX = await stateMoveXPromise;
    assert.strictEqual(stateMoveX.board[0], 'X', 'Cell 0 should belong to X');
    assert.strictEqual(stateMoveX.turn, 'O', 'Turn should switch to O');
    console.log('✓ Out-of-turn move rejected; valid move registered');

    // Test 6: Win condition detection (X wins top row: 0, 1, 2)
    console.log('[Test 6] Win condition detection...');
    let nextState = waitForState(p1, s => s.board[3] === 'O', 'cell 3 is O');
    p2.emit('move', 3);
    await nextState;

    nextState = waitForState(p1, s => s.board[1] === 'X', 'cell 1 is X');
    p1.emit('move', 1);
    await nextState;

    nextState = waitForState(p1, s => s.board[4] === 'O', 'cell 4 is O');
    p2.emit('move', 4);
    await nextState;

    nextState = waitForState(p1, s => s.winner === 'X', 'winner is X');
    p1.emit('move', 2); // X completes [0, 1, 2]
    const winState = await nextState;
    assert.strictEqual(winState.winner, 'X', 'X should be the winner');
    console.log('✓ Win detected successfully');

    // Test 7: Rematch functionality
    console.log('[Test 7] Rematch functionality...');
    const rematchPromise = waitForState(p2, s => s.round === 2 && s.winner === null, 'round 2 reset');
    p1.emit('rematch');
    const rematchState = await rematchPromise;
    assert.strictEqual(rematchState.winner, null, 'Winner should be reset to null');
    assert.strictEqual(rematchState.round, 2, 'Round should be 2');
    assert.strictEqual(rematchState.turn, 'O', 'Turn should alternate to O on round 2');
    assert(rematchState.board.every(cell => cell === null), 'Board should be cleared');
    console.log('✓ Rematch passed');

    // Test 8: Disconnection handling
    console.log('[Test 8] Disconnection handling...');
    const opponentLeftPromise = waitFor(p1, 'opponent-left');
    p2.disconnect();
    await opponentLeftPromise;
    console.log('✓ Disconnection notified to remaining player');
    p1.disconnect();

    // Test 9: Draw condition detection in a new room
    console.log('[Test 9] Draw condition detection...');
    const d1 = createClient();
    const d2 = createClient();
    await Promise.all([waitFor(d1, 'connect'), waitFor(d2, 'connect')]);

    const d1JoinP = waitFor(d1, 'joined');
    d1.emit('create-room', 'DrawX');
    const d1Joined = await d1JoinP;

    const d2JoinP = waitFor(d2, 'joined');
    const d1ReadyP = waitForState(d1, s => s.players.length === 2, 'both draw players joined');
    d2.emit('join-room', { room: d1Joined.room, name: 'DrawO' });
    await Promise.all([d2JoinP, d1ReadyP]);

    // Draw game sequence:
    // X:0, O:1, X:2, O:4, X:3, O:5, X:7, O:6, X:8
    // Resulting board:
    // X O X
    // X O O
    // O X X
    const drawMoves = [
      { client: d1, idx: 0, sym: 'X' },
      { client: d2, idx: 1, sym: 'O' },
      { client: d1, idx: 2, sym: 'X' },
      { client: d2, idx: 4, sym: 'O' },
      { client: d1, idx: 3, sym: 'X' },
      { client: d2, idx: 5, sym: 'O' },
      { client: d1, idx: 7, sym: 'X' },
      { client: d2, idx: 6, sym: 'O' },
      { client: d1, idx: 8, sym: 'X' }
    ];

    let lastState;
    for (const m of drawMoves) {
      const waitP = waitForState(d1, s => s.board[m.idx] === m.sym, `board[${m.idx}] is ${m.sym}`);
      m.client.emit('move', m.idx);
      lastState = await waitP;
    }

    assert.strictEqual(lastState.winner, 'draw', 'Game should result in a draw');
    console.log('✓ Draw detected successfully');

    d1.disconnect();
    d2.disconnect();

    console.log('\n========================================');
    console.log('ALL 9 AUTOMATED TESTS PASSED SUCCESSFULLY!');
    console.log('========================================\n');
  } finally {
    for (const s of activeSockets) {
      try { s.disconnect(); } catch (_) {}
    }
    io.close();
    await new Promise(resolve => server.close(resolve));
  }
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
