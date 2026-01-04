import { io } from "socket.io-client";

// ✅ On Vercel set VITE_SOCKET_URL=https://your-backend.onrender.com
const URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3001";

export const socket = io(URL, {
  transports: ["websocket"],
  autoConnect: true,
});
