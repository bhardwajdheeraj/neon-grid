# Neon Grid — Multiplayer Tic-Tac-Toe

A real-time two-player Tic-Tac-Toe game using Express and Socket.IO. Two people on different devices can join the same room, take turns, and play a rematch.

## Run locally

1. Install Node.js 18 or later.
2. In this folder, run `npm install`.
3. Run `npm start`.
4. Open http://localhost:3000.

## Test multiplayer

Open the game in two browser windows. Create a room in one and join with the displayed code in the other. For testing across devices on the same Wi-Fi, open `http://YOUR_COMPUTER_LAN_IP:3000` on both devices, and ensure your firewall allows port 3000.

## Deploy publicly with Render

1. Push this folder to a GitHub repository.
2. Create a new **Web Service** on Render connected to that repository.
3. Set build command `npm install` and start command `npm start`.
4. Deploy and open the generated HTTPS URL.
5. Share the URL with a friend; create a room and send its invite link.

This version stores rooms in memory, so restarting or sleeping the server clears active games. It is designed for one server instance; for multi-instance scaling, add a shared room store and Socket.IO adapter. The first version has no accounts or chat.
