const https = require('https');
const { io: Client } = require('socket.io-client');

const LIVE_URL = process.env.LIVE_URL || 'https://neon-grid-l1sl.onrender.com';

async function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

function waitFor(socket, event, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for event: ${event}`)), timeoutMs);
    socket.once(event, data => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function waitForState(socket, predicate, desc = '', timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for state: ${desc}`)), timeoutMs);
    const handler = state => {
      if (predicate(state)) {
        clearTimeout(timer);
        socket.off('state', handler);
        resolve(state);
      }
    };
    socket.on('state', handler);
  });
}

async function runLiveTests() {
  console.log(`=== Testing Live Deployed Service: ${LIVE_URL} ===\n`);

  // 1. Health check
  console.log('1. Probing /health endpoint...');
  const health = await fetchUrl(`${LIVE_URL}/health`);
  console.log(`   Status: ${health.status}, Response: ${health.data.trim()}`);
  if (health.status !== 200) throw new Error('Health check failed');

  // 2. Main page load
  console.log('\n2. Probing main HTML page...');
  const page = await fetchUrl(`${LIVE_URL}/`);
  console.log(`   Status: ${page.status}, Length: ${page.data.length} bytes`);
  if (!page.data.includes('NEON') || !page.data.includes('GRID')) {
    throw new Error('Index page content mismatch');
  }

  // 3. Favicon check
  console.log('\n3. Probing /favicon.ico and /favicon.svg...');
  const favicon = await fetchUrl(`${LIVE_URL}/favicon.ico`);
  console.log(`   Favicon status: ${favicon.status}`);
  if (favicon.status !== 200) throw new Error('Favicon missing');

  // 4. WebSocket / Socket.IO live two-player test
  console.log('\n4. Testing Real-Time Socket.IO Multiplayer over HTTPS/WSS...');
  const p1 = Client(LIVE_URL, { transports: ['websocket', 'polling'], forceNew: true });
  const p2 = Client(LIVE_URL, { transports: ['websocket', 'polling'], forceNew: true });

  await Promise.all([waitFor(p1, 'connect'), waitFor(p2, 'connect')]);
  console.log('   ✓ Player 1 and Player 2 connected to live WebSocket server');

  // Player 1 creates room
  const p1JoinP = waitFor(p1, 'joined');
  p1.emit('create-room', 'Alice');
  const p1Joined = await p1JoinP;
  console.log(`   ✓ Player 1 created room: ${p1Joined.room} (assigned symbol ${p1Joined.symbol})`);

  // Player 2 joins room
  const p2JoinP = waitFor(p2, 'joined');
  const p1GameReadyP = waitForState(p1, s => s.players.length === 2, 'both players present');
  p2.emit('join-room', { room: p1Joined.room, name: 'Bob' });
  const p2Joined = await p2JoinP;
  await p1GameReadyP;
  console.log(`   ✓ Player 2 joined room: ${p2Joined.room} (assigned symbol ${p2Joined.symbol})`);

  // Moves synchronization
  console.log('\n5. Testing Live Move Synchronization...');
  // P1 plays at 4 (center)
  const p2SawMoveP = waitForState(p2, s => s.board[4] === 'X', 'P2 saw P1 move at 4');
  p1.emit('move', 4);
  const p2State = await p2SawMoveP;
  console.log(`   ✓ Move registered! Cell 4 is 'X', current turn: ${p2State.turn}`);

  // P2 plays at 0 (top-left)
  const p1SawMoveP = waitForState(p1, s => s.board[0] === 'O', 'P1 saw P2 move at 0');
  p2.emit('move', 0);
  const p1State = await p1SawMoveP;
  console.log(`   ✓ Move registered! Cell 0 is 'O', current turn: ${p1State.turn}`);

  // Play to completion (P1 wins diagonal: 4, 0 is O, P1 plays 2, P2 plays 1, P1 plays 6)
  // Current: board[4]='X', board[0]='O'
  // P1 moves 2
  let waitState = waitForState(p2, s => s.board[2] === 'X', 'cell 2 is X');
  p1.emit('move', 2);
  await waitState;

  // P2 moves 1
  waitState = waitForState(p1, s => s.board[1] === 'O', 'cell 1 is O');
  p2.emit('move', 1);
  await waitState;

  // P1 moves 6 -> [2, 4, 6] diagonal win for X!
  waitState = waitForState(p2, s => s.winner === 'X', 'winner is X');
  p1.emit('move', 6);
  const winState = await waitState;
  console.log(`   ✓ Winner detected on live server: ${winState.winner} won!`);

  // Rematch test
  console.log('\n6. Testing Rematch on Live Server...');
  const rematchWait = waitForState(p1, s => s.round === 2 && s.winner === null, 'rematch round 2');
  p2.emit('rematch');
  const rematchState = await rematchWait;
  console.log(`   ✓ Rematch active! Round: ${rematchState.round}, Starting Turn: ${rematchState.turn}`);

  p1.disconnect();
  p2.disconnect();

  console.log('\n======================================================');
  console.log('ALL LIVE REMOTE TESTS PASSED WITH 100% SUCCESS!');
  console.log('======================================================\n');
}

runLiveTests().catch(err => {
  console.error('\n❌ Live test failed:', err);
  process.exit(1);
});
