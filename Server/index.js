import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

const app = express();

// ✅ allow multiple origins (localhost + vercel)
const allowlist = [
  process.env.CLIENT_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
].filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // allow server-to-server / curl (no origin)
      if (!origin) return cb(null, true);
      if (allowlist.includes(origin)) return cb(null, true);
      return cb(new Error("CORS blocked: " + origin));
    },
    credentials: true,
  })
);

app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowlist,
    credentials: true,
  },
});

const SYMBOLS = ["tiger", "gourd", "rooster", "shrimp", "crab", "fish"];
const pick = () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
const roll3 = () => [pick(), pick(), pick()];

app.get("/", (req, res) => res.send("OK"));
app.get("/symbols", (req, res) => res.json(SYMBOLS));

// rooms
const rooms = new Map();

function makeRoom(roomId) {
  return {
    roomId,
    hostId: null,
    players: new Map(), // socketId -> {id,name,coins}
    bets: {}, // socketId -> {symbol: amount}
    lastRoll: [],
    status: "betting",
    chat: [],
  };
}

function publicState(room, myId) {
  return {
    roomId: room.roomId,
    hostId: room.hostId,
    status: room.status,
    lastRoll: room.lastRoll,
    symbols: SYMBOLS, // ✅ send symbols to frontend
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      coins: p.coins,
    })),
    myBets: room.bets?.[myId] || {}, // ✅ send my bets so UI shows numbers
    chat: room.chat,
  };
}

function settle projected(roll, betObj) {
  const counts = Object.fromEntries(SYMBOLS.map((s) => [s, 0]));
  for (const d of roll) counts[d] += 1;

  const totalBet = SYMBOLS.reduce((sum, s) => sum + (Number(betObj?.[s]) || 0), 0);
  let payout = 0;
  for (const s of SYMBOLS) payout += (Number(betObj?.[s]) || 0) * counts[s];
  return { totalBet, payout, net: payout - totalBet };
}

io.on("connection", (socket) => {
  socket.on("create_room", ({ roomId, name }) => {
    roomId = String(roomId || "").trim();
    if (!roomId) return socket.emit("error_msg", "Room ID required");
    if (rooms.has(roomId)) return socket.emit("error_msg", "Room already exists");

    const room = makeRoom(roomId);
    rooms.set(roomId, room);

    room.hostId = socket.id;
    room.players.set(socket.id, { id: socket.id, name: name || "Player", coins: 100 });

    socket.join(roomId);
    io.to(roomId).emit("room_state", publicState(room, socket.id));
  });

  socket.on("join_room", ({ roomId, name }) => {
    roomId = String(roomId || "").trim();
    const room = rooms.get(roomId);
    if (!room) return socket.emit("error_msg", "Room not found");
    if (room.players.size >= 4) return socket.emit("error_msg", "Room is full (max 4)");

    room.players.set(socket.id, { id: socket.id, name: name || "Player", coins: 100 });
    socket.join(roomId);

    io.to(roomId).emit("room_state", publicState(room, socket.id));
  });

  socket.on("place_bet", ({ roomId, symbol, amount }) => {
    const rid = String(roomId || "").trim();
    const room = rooms.get(rid);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    symbol = String(symbol || "");
    const a = Math.max(0, Number(amount || 0));
    if (!SYMBOLS.includes(symbol) || a <= 0) return;

    if (player.coins < a) return socket.emit("error_msg", "Not enough coins");

    if (!room.bets[socket.id]) room.bets[socket.id] = {};
    const cur = Number(room.bets[socket.id][symbol] || 0);

    player.coins -= a;
    room.bets[socket.id][symbol] = cur + a;

    io.to(rid).emit("room_state", publicState(room, socket.id));
  });

  socket.on("remove_bet", ({ roomId, symbol, amount }) => {
    const rid = String(roomId || "").trim();
    const room = rooms.get(rid);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    symbol = String(symbol || "");
    const a = Math.max(0, Number(amount || 0));
    if (!SYMBOLS.includes(symbol) || a <= 0) return;

    const cur = Number(room.bets?.[socket.id]?.[symbol] || 0);
    if (cur <= 0) return;

    const take = Math.min(a, cur);
    room.bets[socket.id][symbol] = cur - take;
    player.coins += take;

    io.to(rid).emit("room_state", publicState(room, socket.id));
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
      const { payout } = settle projected(roll, betObj);
      p.coins += payout;
    }

    room.bets = {};
    io.to(rid).emit("roll_result", { roll });
    io.to(rid).emit("room_state", publicState(room, socket.id));
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
    if (room.chat.length > 50) room.chat.shift();

    io.to(rid).emit("chat_message", entry);
  });

  socket.on("disconnect", () => {
    for (const [rid, room] of rooms.entries()) {
      if (!room.players.has(socket.id)) continue;

      room.players.delete(socket.id);
      delete room.bets[socket.id];

      if (room.hostId === socket.id) {
        room.hostId = room.players.size ? Array.from(room.players.keys())[0] : null;
      }

      if (room.players.size === 0) rooms.delete(rid);
      else io.to(rid).emit("room_state", publicState(room, socket.id));
    }
  });
});

// ✅ Render requires PORT from env
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log("✅ Server running on port", PORT));
