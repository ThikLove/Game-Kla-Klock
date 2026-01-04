const BASE = "http://localhost:3001";

export async function getSymbols() {
  const r = await fetch(`${BASE}/symbols`);
  if (!r.ok) throw new Error("Failed to load symbols");
  return r.json();
}

export async function rollApi({ coins, bets }) {
  const r = await fetch(`${BASE}/roll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coins, bets })
  });

  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || "Roll failed");
  return data;
}
