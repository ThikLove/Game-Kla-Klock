// client/src/api.js

// ✅ Use env on Vercel, fallback to localhost for dev
const BASE =
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_SOCKET_URL || // (optional if you only set one var)
  "http://localhost:3001";

export async function getSymbols() {
  const r = await fetch(`${BASE}/symbols`);
  if (!r.ok) throw new Error("Failed to load symbols");
  return r.json();
}

// If your backend DOES NOT have /roll route, you can delete this function
export async function rollApi(payload) {
  const r = await fetch(`${BASE}/roll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "Roll failed");
  return data;
}
