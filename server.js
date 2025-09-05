// Simple WebSocket multiplayer server for Mental Math Trainer
// Run: npm install; npm start (on Windows PowerShell)
import { WebSocketServer } from 'ws';
import { customAlphabet } from 'nanoid';
import fs from 'fs';
import https from 'https';

const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6); // avoids confusing chars
// ---- WebSocket Server Setup ----
let WSS;
WSS = new WebSocketServer({ port: 3000, host: '127.0.0.1' });
// ---- Data Structures ----
const rooms = new Map(); // code -> Room

// Room shape: { code, topics, players: Map<playerId, Player>, hostId, currentQuestion, questionDeadline, settings, inProgress, questionIndex, revealedQuestionId, limit, messages: ChatMessage[] }
// Player: { id, name, score, correct, questions, streak, ws, lastAnswerQuestionId, lastChatTs }
// ChatMessage: { id, playerId, name, text, ts: Date.now() }

// Settings
const QUESTION_TIME_MS = 10000;
const MAX_POINTS = 100;
const MIN_POINTS = 10;
const AUTO_DELAY = 800; // ms after reveal before next question (only if more remain)

// Generators (reuse logic similar to client)
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function genAddition(){ const a = rand(2,99), b = rand(2,99); return { text:`${a} + ${b} = ?`, answer:a+b }; }
function genSubtraction(){ let a = rand(5,150), b = rand(1,a-1); return { text:`${a} − ${b} = ?`, answer:a-b }; }
function genMultiplication(){ const a = rand(2,12), b = rand(2,12); return { text:`${a} × ${b} = ?`, answer:a*b }; }
function genDivision(){ const b = rand(2,12); const a = b * rand(2,12); return { text:`${a} ÷ ${b} = ?`, answer:a/b }; }

const TOPIC_MAP = {
  add: { id:'add', label:'Addition', symbol:'+ ', generator:genAddition },
  sub: { id:'sub', label:'Subtraction', symbol:'− ', generator:genSubtraction },
  mul: { id:'mul', label:'Multiplication', symbol:'× ', generator:genMultiplication },
  div: { id:'div', label:'Division', symbol:'÷ ', generator:genDivision },
};

function perturb(ans, topic) {
  if(topic==='div') {
    const delta = [1,-1,2,-2][Math.floor(Math.random()*4)];
    let v = ans + delta; if(v<=0) v = ans + Math.abs(delta)+1; return v;
  }
  const magnitude = Math.max(2, Math.round(Math.abs(ans)*0.15));
  let v = ans + (Math.floor(Math.random()* (magnitude*2+1)) - magnitude);
  if(v===ans) v += (Math.random()<0.5? -1:1)*(magnitude+1);
  if(topic==='mul' && ans>20 && Math.random()<0.3) v = ans + (Math.random()<0.5? 10:-10);
  return v;
}

function buildQuestion(room){
  const topicList = room.topics.length? room.topics : Object.keys(TOPIC_MAP);
  const topicId = topicList[Math.floor(Math.random()*topicList.length)];
  const t = TOPIC_MAP[topicId];
  const base = t.generator();
  const answer = base.answer;
  const opts = new Set([answer]);
  while(opts.size < 4) opts.add(perturb(answer, topicId));
  const options = Array.from(opts).sort(()=>Math.random()-0.5);
  return { id: nanoid(), topicId, topicLabel:t.label, topicSymbol:t.symbol.trim(), text:base.text, answer, options, start: Date.now(), duration:QUESTION_TIME_MS };
}

function calcPoints(elapsedMs){
  const ratio = Math.min(1, elapsedMs / QUESTION_TIME_MS);
  return Math.max(MIN_POINTS, Math.round(MAX_POINTS - (MAX_POINTS - MIN_POINTS)*ratio));
}

function broadcast(room, type, data) {
  const payload = JSON.stringify({ type, ...data });
  for(const p of room.players.values()) {
    try { p.ws.send(payload); } catch {/* ignore */}
  }
}

function send(ws, type, data) { ws.send(JSON.stringify({ type, ...data })); }

function scheduleQuestion(room) {
  console.log('[scheduleQuestion] room', room.code, 'index', room.questionIndex, 'limit', room.limit);
  if(room.limit && room.questionIndex >= room.limit){
    finishRoom(room);
    return;
  }
  room.currentQuestion = buildQuestion(room);
  room.questionDeadline = room.currentQuestion.start + QUESTION_TIME_MS;
  room.questionIndex++;
  room.revealedQuestionId = null;
  for(const p of room.players.values()) { p.lastAnswerQuestionId = null; }
  broadcast(room, 'question', { question: room.currentQuestion, leaderboard: buildLeaderboard(room), index: room.questionIndex, total: room.limit || null });
  // schedule timeout reveal strictly at timer end (no early reveal)
  setTimeout(()=> { revealIfPending(room); }, QUESTION_TIME_MS + 5);
}

function revealIfPending(room){
  if(!room.currentQuestion) return;
  if(room.revealedQuestionId === room.currentQuestion.id) return;
  // Only reveal at or after deadline
  const now = Date.now();
  if(now < room.questionDeadline - 5) { // safety recheck
    console.log('[revealIfPending] too early, rescheduling in', room.questionDeadline - now, 'ms');
    setTimeout(()=> revealIfPending(room), room.questionDeadline - now);
    return;
  }
  console.log('[revealIfPending] revealing question', room.currentQuestion.id, 'index', room.questionIndex);
  room.revealedQuestionId = room.currentQuestion.id;
  const playerSummaries = [];
  for(const p of room.players.values()){
    const answered = p.lastAnswerQuestionId === room.currentQuestion.id;
    playerSummaries.push({ id:p.id, name:p.name, answered, score:p.score, streak:p.streak });
  }
  broadcast(room, 'reveal', { questionId: room.currentQuestion.id, answer: room.currentQuestion.answer, leaderboard: buildLeaderboard(room), players: playerSummaries });
  if(room.limit && room.questionIndex >= room.limit){
    setTimeout(()=> finishRoom(room), AUTO_DELAY);
  } else {
    setTimeout(()=>{ if(room.inProgress) scheduleQuestion(room); }, AUTO_DELAY);
  }
}

function finishRoom(room){
  room.inProgress = false;
  broadcast(room,'end_game',{ leaderboard: buildLeaderboard(room), totalQuestions: room.questionIndex });
  room.currentQuestion = null;
}

function buildLeaderboard(room){
  return Array.from(room.players.values())
    .map(p=>({ id:p.id, name:p.name, score:p.score, streak:p.streak, correct:p.correct, questions:p.questions }))
    .sort((a,b)=> b.score - a.score || b.correct - a.correct || a.name.localeCompare(b.name));
}

function tryStart(room){
  if(!room.inProgress){
    room.inProgress = true;
    room.questionIndex = 0;
    scheduleQuestion(room);
  }
}

function createRoom(topics){
  const code = nanoid();
  const room = { code, topics, players:new Map(), hostId:null, currentQuestion:null, questionDeadline:0, settings:{}, inProgress:false, questionIndex:0, revealedQuestionId:null, limit:null, messages:[] };
  rooms.set(code, room);
  return room;
}

function pushChat(room, msgObj){
  room.messages.push(msgObj);
  if(room.messages.length > 500) room.messages.splice(0, room.messages.length - 500);
  broadcast(room,'chat',{ message: msgObj });
}

function systemMessage(room, text){
  const cm = { id: nanoid(), playerId: null, name: 'System', text, ts: Date.now() };
  pushChat(room, cm);
}

function removePlayerFromRoom(room, playerId){
  room.players.delete(playerId);
  if(room.players.size===0){
    rooms.delete(room.code);
  } else {
    if(room.hostId===playerId){
      // reassign host
      const first = room.players.values().next().value;
      room.hostId = first.id;
      broadcast(room,'host_change',{ hostId: room.hostId });
    }
    broadcast(room,'leaderboard',{ leaderboard: buildLeaderboard(room) });
  }
}

WSS.on('connection', (ws, req) => {
    console.log('WS connection from', req.socket.remoteAddress, 'req headers:', req.headers.origin || req.headers.host);

    const playerId = nanoid();
    let currentRoom = null;
    const player = { id:playerId, name:'Player', score:0, correct:0, questions:0, streak:0, ws, lastAnswerQuestionId:null, lastChatTs:0 };
    send(ws,'hello',{ playerId, supportedTopics:Object.values(TOPIC_MAP).map(t=>({id:t.id,label:t.label})) });

    ws.on('message', raw => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      const { type } = msg;
      if(type==='create_room'){
        const topics = Array.isArray(msg.topics) && msg.topics.length ? msg.topics.filter(t=>TOPIC_MAP[t]) : Object.keys(TOPIC_MAP);
        currentRoom = createRoom(topics);
        currentRoom.players.set(player.id, player);
        currentRoom.hostId = player.id;
        if(Number.isInteger(msg.limit) && msg.limit>0 && msg.limit<=200){ currentRoom.limit = msg.limit; }
        send(ws,'room_created',{ code: currentRoom.code, hostId: currentRoom.hostId, topics, limit: currentRoom.limit });
        broadcast(currentRoom,'leaderboard',{ leaderboard: buildLeaderboard(currentRoom) });
    systemMessage(currentRoom, `${player.name} created the room.`);
      }
      else if(type==='join_room'){
        const code = (msg.code||'').toUpperCase();
        const room = rooms.get(code);
        if(!room){ send(ws,'error',{ message:'Room not found'}); return; }
        if(room.inProgress){ send(ws,'error',{ message:'Game already in progress'}); return; }
        currentRoom = room;
        room.players.set(player.id, player);
        broadcast(room,'player_join',{ player:{ id:player.id, name:player.name }, leaderboard: buildLeaderboard(room) });
        send(ws,'joined',{ code:room.code, hostId: room.hostId, topics: room.topics, limit: room.limit });
        // send recent chat history (last 50)
        if(room.messages.length){
          const history = room.messages.slice(-50);
          send(ws,'chat_history',{ messages: history });
        }
    systemMessage(room, `${player.name} joined the room.`);
      }
      else if(type==='set_name'){
        const name = String(msg.name||'Player').substring(0,18).trim() || 'Player';
        player.name = name;
        if(currentRoom) broadcast(currentRoom,'leaderboard',{ leaderboard: buildLeaderboard(currentRoom) });
      }
      else if(type==='start' && currentRoom){
        if(player.id !== currentRoom.hostId){ send(ws,'error',{ message:'Only host can start'}); return; }
        tryStart(currentRoom);
      }
      else if(type==='answer' && currentRoom){
        const q = currentRoom.currentQuestion;
        if(!q || msg.questionId !== q.id) return;
        if(player.lastAnswerQuestionId === q.id) return; // already answered
        const elapsed = Date.now() - q.start;
        const choice = msg.choice;
        player.questions++;
        if(choice === q.answer){
          player.correct++;
          player.streak++;
          player.score += calcPoints(elapsed);
        } else {
          player.streak = 0;
        }
        player.lastAnswerQuestionId = q.id;
        broadcast(currentRoom,'leaderboard',{ leaderboard: buildLeaderboard(currentRoom) });
        // no early reveal; wait for timer to end
      }
      else if(type==='chat' && currentRoom){
        const rawText = (msg.text||'').toString();
        const text = rawText.replace(/[\r\n\t]/g,' ').trim();
        if(!text) return; // ignore empty
        if(text.length > 200) return; // too long
        const now = Date.now();
    if(now - player.lastChatTs < 250) return; // relaxed rate limit (250ms)
    player.lastChatTs = now;
    const cm = { id: nanoid(), playerId: player.id, name: player.name, text, ts: now };
    console.log(`[chat] ${currentRoom.code} ${player.name}:`, text);
    pushChat(currentRoom, cm);
      }
    });

    ws.on('close', (code, reason) => {
        console.log(`Client disconnected. code=${code} reason=${reason ? reason.toString() : '<none>'}`);
        if(currentRoom){ removePlayerFromRoom(currentRoom, player.id); }
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err && err.stack ? err.stack : err);
    });
});

process.on('uncaughtException', err => { console.error('[Uncaught]', err); });
process.on('unhandledRejection', err => { console.error('[UnhandledRejection]', err); });
