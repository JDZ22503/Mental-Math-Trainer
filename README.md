# Mental Math Trainer

Lightweight browser-based mental arithmetic trainer with optional real-time multiplayer via WebSocket.

You can try it here : https://mental-math-trainer.shreesbacademy.tech/
<img width="1862" height="925" alt="Screenshot 2025-09-04 214405" src="https://github.com/user-attachments/assets/161fca23-7c51-489f-af70-e7f3045b55eb" />


Files
- [index.html](index.html) — single-page client UI and logic (questions, timer, scoring, practice mode).
- [server.js](server.js) — simple WebSocket server implementing rooms, questions, chat and leaderboard.
- [package.json](package.json) — project metadata and start script.

Overview
- Local single-player practice with configurable question count, grade ranges and auto-next.
- Multiple topics: Addition, Subtraction, Multiplication, Division (see [`TOPICS`](index.html)).
- Speed-based scoring (see [`calcPoints`](index.html)).
- Multiplayer rooms with shared questions, chat and leaderboard (client connects to `WS_URL` in [index.html](index.html) and server logic in [server.js](server.js)).

Key client symbols (in [index.html](index.html))
- [`startSession`](index.html) — begin a session with chosen topics and settings.
- [`nextQuestion`](index.html) — advance to the next question.
- [`generateQuestion`](index.html) — builds MCQ options client-side.
- [`calcPoints`](index.html) — linear decay scoring based on response time.
- Generators: [`genAddition`](index.html), [`genSubtraction`](index.html), [`genMultiplication`](index.html), [`genDivision`](index.html).

Key server symbols (in [server.js](server.js))
- [`createRoom`](server.js) — allocates a new room code and structure.
- [`buildQuestion`](server.js) — server-side question builder and MCQ options.
- [`scheduleQuestion`](server.js) / [`revealIfPending`](server.js) — timing flow for broadcasting and revealing answers.
- [`calcPoints`](server.js) — server-side points calculation to mirror client scoring.

Run locally
1. Install dependencies:
   ```sh
   npm install
   ```
2. Start the WebSocket server:
   ```sh
   npm start
   ```
3. Open [index.html](index.html) in a browser. (For multiplayer, open the page served from a local HTTP server so WebSocket URL resolution is consistent — the client attempts to connect to the server at `ws://localhost:3000` by default; see `WS_URL` in [index.html](index.html).)

Notes about multiplayer
- The server maintains rooms, players, chat history and leaderboards. See [`createRoom`](server.js), [`scheduleQuestion`](server.js) and [`buildQuestion`](server.js).
- Answers are collected and revealed at timer end to all participants; the server computes points and broadcasts leaderboard updates.
- Chat messages are rate-limited and kept in room history.

Extending the project
- Add new topics by following the client-side generator pattern (`genAddition`, etc.) in [index.html](index.html) and register them in [`TOPICS`](index.html).
- Modify server question rules in [`buildQuestion`](server.js) and the generators in [server.js](server.js) to change difficulty or ranges.
- Serve the client via a static HTTP server (e.g., `npx http-server`) to avoid file:// WebSocket issues when using multiplayer.

Troubleshooting
- If the server fails to bind to the default port, set PORT env or stop the occupying process (see [server.js](server.js) error handling).
- For multiplayer testing, ensure the browser can reach the server at ws://localhost:3000 (check console logs from the server and client).
