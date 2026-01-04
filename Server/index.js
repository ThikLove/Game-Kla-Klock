import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

const app = express();

// ✅ set this in Render: CLIENT_ORIGIN=https://YOUR-VERCEL.vercel.app
const ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

app.use(cors({ origin: ORIGIN }));
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: ORIGIN, methods: ["GET", "POST"] },
});

const SYMBOLS = ["tiger", "gourd", "rooster", "shrimp", "crab", "fish"];
const pick = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
const roll3 = () => [pick(), pick(), pick()];

app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/symbols", (req, res) => res.json(SYMBOLS));

// rooms: in-memory (for demo). For production, use Redis/DB.
const rooms = new Map();

function makeRoom(roomId) {
  return {
    roomId,
    hostId: null,
    players: new Map(), // socketId -> {id,name,coins}
    bets: {},           // socketId -> {symbol: amount}
    lastRoll: [],
    status: "betting",
    chat: [],
  };
}

function settle(roll, betObj) {
  const counts = Object.fromEntries(SYMBOLS.map((s) => [s, 0]));
  for (const d of roll) counts[d] += 1;

  const totalBet = SYMBOLS.reduce((sum, s) => sum + (Number(betObj?.[s]) || 0), 0);

  let payout = 0;
  for (const s of SYMBOLS) payout += (Number(betObj?.[s]) || 0) * counts[s];

  return { totalBet, payout, net: payout - totalBet, counts };
}

// ✅ IMPORTANT: each player receives their own myBets (fix bet showing 0)
function emitRoomState(rid) {
  const room = rooms.get(rid);
  if (!room) return;

  const playersArray = Array.from(room.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    coins: p.coins,
  }));

  for (const sid of room.players.keys()) {
    io.to(sid).emit("room_state", {
      roomId: room.roomId,
      hostId: room.hostId,
      status: room.status,
      lastRoll: room.lastRoll,
      symbols: SYMBOLS,
      players: playersArray,
      myBets: room.bets?.[sid] || {}, // ✅
      chat: room.chat,
    });
  }
}

io.on("connection", (socket) => {
  console.log("✅ connected:", socket.id);

  socket.on("create_room", ({ roomId, name }) => {
    const rid = String(roomId || "").trim();
    if (!rid) return socket.emit("error_msg", "Room ID required");
    if (rooms.has(rid)) return socket.emit("error_msg", "Room already exists");

    const room = makeRoom(rid);
    rooms.set(rid, room);

    room.hostId = socket.id;
    room.players.set(socket.id, { id: socket.id, name: name || "Host", coins: 100 });

    socket.join(rid);

    const entry = { name: "SYSTEM", msg: `${name || "Host"} created room`, ts: Date.now() };
    room.chat.push(entry);
    room.chat = room.chat.slice(-50);

    emitRoomState(rid);
  });

  socket.on("join_room", ({ roomId, name }) => {
    const rid = String(roomId || "").trim();
    const room = rooms.get(rid);
    if (!room) return socket.emit("error_msg", "Room not found");
    if (room.players.size >= 4) return socket.emit("error_msg", "Room is full (max 4)");

    room.players.set(socket.id, { id: socket.id, name: name || "Player", coins: 100 });
    socket.join(rid);

    const entry = { name: "SYSTEM", msg: `${name || "Player"} joined`, ts: Date.now() };
    room.chat.push(entry);
    room.chat = room.chat.slice(-50);

    io.to(rid).emit("chat_message", entry);
    emitRoomState(rid);
  });

  socket.on("place_bet", ({ roomId, symbol, amount }) => {
    const rid = String(roomId || "").trim();
    const room = rooms.get(rid);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    const s = String(symbol || "");
    const a = Math.max(0, Number(amount || 0));

    if (!SYMBOLS.includes(s) || a <= 0) return;

    if (player.coins < a) return socket.emit("error_msg", "Not enough coins");

    if (!room.bets[socket.id]) room.bets[socket.id] = {};
    const cur = Number(room.bets[socket.id][s] || 0);

    player.coins -= a;
    room.bets[socket.id][s] = cur + a;

    emitRoomState(rid);
  });

  socket.on("remove_bet", ({ roomId, symbol, amount }) => {
    const rid = String(roomId || "").trim();
    const room = rooms.get(rid);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    const s = String(symbol || "");
    const a = Math.max(0, Number(amount || 0));
    if (!SYMBOLS.includes(s) || a <= 0) return;

    const cur = Number(room.bets?.[socket.id]?.[s] || 0);
    if (cur <= 0) return;

    const take = Math.min(a, cur);
    room.bets[socket.id][s] = cur - take;
    player.coins += take;

    emitRoomState(rid);
  });

  socket.on("roll", ({ roomId }) => {
    const rid = String(roomId || "").trim();
    const room = rooms.get(rid);
    if (!room) return;

    if (room.hostId !== socket.id) return socket.emit("error_msg", "Only host can roll");

    const roll = roll3();
    room.lastRoll = roll;

    for (const [sid, p] of room.players.entries()) {
      const betObj = room.bets[sid] || {};
      const { payout } = settle(roll, betObj);
      p.coins += payout; // bets already deducted
    }

    room.bets = {};
    io.to(rid).emit("roll_result", { roll });
    emitRoomState(rid);
  });

  socket.on("chat_message", ({ roomId, message }) => {
    const rid = String(roomId || "").trim();
    const room = rooms.get(rid);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    const msg = String(message || "").trim();
    if (!msg) return;

    const entry = { name: player.name, msg, ts: Date.now() };
    room.chat.push(entry);
    room.chat = room.chat.slice(-50);

    io.to(rid).emit("chat_message", entry);
    emitRoomState(rid);
  });

  socket.on("disconnect", () => {
    console.log("❌ disconnected:", socket.id);

    for (const [rid, room] of rooms.entries()) {
      if (!room.players.has(socket.id)) continue;

      const leavingName = room.players.get(socket.id)?.name || "Player";
      room.players.delete(socket.id);
      delete room.bets[socket.id];

      if (room.hostId === socket.id) {
        room.hostId = room.players.size ? Array.from(room.players.keys())[0] : null;

        if (room.hostId) {
          const newHostName = room.players.get(room.hostId)?.name || "Player";
          const entry = { name: "SYSTEM", msg: `${newHostName} is now Host`, ts: Date.now() };
          room.chat.push(entry);
          room.chat = room.chat.slice(-50);
          io.to(rid).emit("chat_message", entry);
        }
      }

      if (room.players.size === 0) {
        rooms.delete(rid);
      } else {
        const entry = { name: "SYSTEM", msg: `${leavingName} left`, ts: Date.now() };
        room.chat.push(entry);
        room.chat = room.chat.slice(-50);
        io.to(rid).emit("chat_message", entry);
        emitRoomState(rid);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log("✅ Server running on port", PORT, "origin:", ORIGIN));
