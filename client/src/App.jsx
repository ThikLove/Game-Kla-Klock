import { useEffect, useMemo, useRef, useState } from "react";
import { socket } from "./socket";
import "./ui.css";

import CrabImg from "./assets/symbols/Crab.png";
import RoosterImg from "./assets/symbols/Rooster.png";
import ShrimpImg from "./assets/symbols/Shrimp.png";
import TigerImg from "./assets/symbols/Tiger.png";
import GourdImg from "./assets/symbols/gourd.png";
import FishImg from "./assets/symbols/Fish.png";

const SYMBOL_IMG = {
  crab: CrabImg,
  rooster: RoosterImg,
  shrimp: ShrimpImg,
  tiger: TigerImg,
  gourd: GourdImg,
  fish: FishImg,
};

const KH_NAME = {
  tiger: "ខ្លា",
  gourd: "ឃ្លោក",
  rooster: "មាន់",
  shrimp: "បង្គង",
  crab: "ក្តាម",
  fish: "ត្រី",
};

const FALLBACK_SYMBOLS = ["tiger", "gourd", "rooster", "shrimp", "crab", "fish"];

export default function App() {
  const [roomId, setRoomId] = useState("room1");
  const [name, setName] = useState("Thik");
  const [joined, setJoined] = useState(false);

  const [hostId, setHostId] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const myIdRef = useRef(null);

  const [symbols, setSymbols] = useState([]);
  const [players, setPlayers] = useState([]);
  const [coins, setCoins] = useState(0);
  const [bets, setBets] = useState({});
  const [dice, setDice] = useState(["fish", "fish", "fish"]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [resultLeft, setResultLeft] = useState([null, null, null]);

  const [rolling3d, setRolling3d] = useState(false);
  const rollAudioRef = useRef(null);

  const [chat, setChat] = useState([]);
  const [chatText, setChatText] = useState("");
  const chatBoxRef = useRef(null);

  useEffect(() => {
    const onConnect = () => {
      myIdRef.current = socket.id;
    };

    const onRoomState = (state) => {
      setJoined(true);
      setHostId(state.hostId);
      setIsHost(state.hostId === myIdRef.current);

      const syms = state?.symbols?.length ? state.symbols : FALLBACK_SYMBOLS;
      setSymbols(syms);

      setPlayers(state.players || []);

      const me = (state.players || []).find((p) => p.id === myIdRef.current);
      setCoins(me?.coins ?? 100);

      // ✅ update bets from server (myBets)
      const myBets = state.myBets || {};
      const next = {};
      syms.forEach((s) => (next[s] = Number(myBets[s] || 0)));
      setBets(next);

      if (Array.isArray(state.chat)) setChat(state.chat);
    };

    const onRollResult = ({ roll }) => {
      setDice(roll);
      setResultLeft(roll);
    };

    const onChatMessage = (entry) => {
      setChat((prev) => [...prev, entry].slice(-50));
    };

    const onError = (m) => {
      setMsg(String(m || "Error"));
      setRolling3d(false);
      setBusy(false);
      if (rollAudioRef.current) {
        rollAudioRef.current.pause();
        rollAudioRef.current.currentTime = 0;
      }
    };

    socket.on("connect", onConnect);
    socket.on("room_state", onRoomState);
    socket.on("roll_result", onRollResult);
    socket.on("chat_message", onChatMessage);
    socket.on("error_msg", onError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("room_state", onRoomState);
      socket.off("roll_result", onRollResult);
      socket.off("chat_message", onChatMessage);
      socket.off("error_msg", onError);
    };
  }, []);

  useEffect(() => {
    if (!chatBoxRef.current) return;
    chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
  }, [chat]);

  const totalBet = useMemo(
    () => symbols.reduce((sum, id) => sum + (Number(bets[id]) || 0), 0),
    [symbols, bets]
  );

  const createRoom = () => {
    setMsg("");
    socket.emit("create_room", { roomId, name });
  };

  const joinRoom = () => {
    setMsg("");
    socket.emit("join_room", { roomId, name });
  };

  const addBet = (id, amount) => {
    if (!joined || busy) return;

    if (amount > 0) {
      socket.emit("place_bet", { roomId, symbol: id, amount: Math.abs(amount) });
    } else if (amount < 0) {
      socket.emit("remove_bet", { roomId, symbol: id, amount: Math.abs(amount) });
    }
  };

  const onRoll = async () => {
    setMsg("");
    if (!joined) return setMsg("សូម Join room មុន");
    if (totalBet <= 0) return setMsg("សូមចាក់ភ្នាល់មុន");
    if (!isHost) return setMsg("តែ Host ទេដែលអាចក្រឡុកបាន");

    setBusy(true);
    setRolling3d(true);
    setResultLeft([null, null, null]);

    try {
      if (rollAudioRef.current) {
        rollAudioRef.current.currentTime = 0;
        await rollAudioRef.current.play();
      }
    } catch {}

    const interval = setInterval(() => {
      const rand = () => symbols[Math.floor(Math.random() * symbols.length)];
      setDice([rand(), rand(), rand()]);
    }, 70);

    setTimeout(() => {
      clearInterval(interval);
      if (rollAudioRef.current) {
        rollAudioRef.current.pause();
        rollAudioRef.current.currentTime = 0;
      }
      socket.emit("roll", { roomId });
      setRolling3d(false);
      setBusy(false);
    }, 1400);
  };

  const sendChat = () => {
    if (!joined) return;
    const text = chatText.trim();
    if (!text) return;
    socket.emit("chat_message", { roomId, message: text });
    setChatText("");
  };

  const orderedPlayers = useMemo(() => {
    const arr = [...players];
    arr.sort((a, b) => {
      const aHost = a.id === hostId ? 1 : 0;
      const bHost = b.id === hostId ? 1 : 0;
      if (aHost !== bHost) return bHost - aHost;

      const aYou = a.id === myIdRef.current ? 1 : 0;
      const bYou = b.id === myIdRef.current ? 1 : 0;
      return bYou - aYou;
    });
    return arr;
  }, [players, hostId]);

  return (
    <div className="page2">
      <audio ref={rollAudioRef} src="/sfx/roll.mp3" preload="auto" />

      <div className="lobbyBar">
        <input className="lobbyInput" value={name} onChange={(e) => setName(e.target.value)} placeholder="ឈ្មោះ" />
        <input className="lobbyInput" value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="Room ID" />
        <button className="lobbyBtn" onClick={createRoom}>Create</button>
        <button className="lobbyBtn" onClick={joinRoom}>Join</button>

        <div className="lobbyInfo">
          {joined ? (
            <>
              <span>✅ Joined</span>
              <span>{isHost ? "👑 Host" : "👤 Player"}</span>
            </>
          ) : (
            <span>Not joined</span>
          )}
        </div>
      </div>

      <div className="frame">
        <div className="topbar">
          <div className="gameTitle">ខ្លាឃ្លោក</div>
          <div className="coinPill">
            <span className="coinIcon">🪙</span>
            <span className="coinText">{coins.toLocaleString()}</span>
          </div>
        </div>

        <div className="board2">
          <div className="leftStack">
            {resultLeft.map((id, i) => (
              <div key={i} className={`qCircle qCircle--img ${id ? "qCircle--pop" : ""}`}>
                {id ? <img src={SYMBOL_IMG[id]} alt={id} /> : "?"}
              </div>
            ))}
          </div>

          <div className="center2">
            <div className="tilesWrap">
              {symbols.map((id) => (
                <div key={id} className={`tile2 ${bets[id] > 0 ? "tile2--active" : ""}`}>
                  <img className="tile2Img" src={SYMBOL_IMG[id]} alt={id} />
                  <div className="tileName">{KH_NAME[id]}</div>

                  <div className="tileBet">
                    <button className="betBtn2" onClick={() => addBet(id, -10)} disabled={busy}>−</button>
                    <div className="betValue2">{bets[id] || 0}</div>
                    <button className="betBtn2" onClick={() => addBet(id, 10)} disabled={busy}>+</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="hud2">
              <div><b>ភ្នាល់សរុប:</b> {totalBet.toLocaleString()}</div>
              {msg && <div className="msg2">{msg}</div>}
              <div className="version">Version : 1.0.0</div>
            </div>
          </div>

          <div className="right2">
            <div className={`bowl2 ${rolling3d ? "bowl2--shake" : ""}`}>
              <div className="diceRow2">
                {dice.map((id, i) => (
                  <div key={i} className="die3d">
                    <img className={`die3dImg ${rolling3d ? "die3dImg--blur" : ""}`} src={SYMBOL_IMG[id]} alt={id} />
                  </div>
                ))}
              </div>
            </div>

            <button className="rollBtn2" onClick={onRoll} disabled={busy || !joined || totalBet <= 0 || !isHost}>
              ក្រឡុក
            </button>

            {!isHost && joined && <div className="hint">តែ Host ទេអាចក្រឡុកបាន</div>}

            <div className="sidePanel">
              <div className="panelTitle">Players ({players.length}/4)</div>

              <div className="playerList">
                {orderedPlayers.map((p) => {
                  const isYou = p.id === myIdRef.current;
                  const isHostPlayer = p.id === hostId;

                  return (
                    <div key={p.id} className={`playerRow ${isYou ? "playerRow--you" : ""}`}>
                      <span className="pName">
                        {isHostPlayer && <span className="badgeHost">👑</span>}
                        {p.name}
                        {isYou && <span className="badgeYou">(You)</span>}
                      </span>
                      <span className="pCoin">🪙 {p.coins}</span>
                    </div>
                  );
                })}
              </div>

              <div className="panelTitle">Chat</div>
              <div className="chatBox" ref={chatBoxRef}>
                {chat.map((c, i) => (
                  <div key={i} className="chatLine">
                    <b>{c.name}:</b> {c.msg}
                  </div>
                ))}
              </div>

              <div className="chatInputRow">
                <input
                  className="chatInput"
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  placeholder="Type message..."
                  onKeyDown={(e) => e.key === "Enter" && sendChat()}
                  disabled={!joined}
                />
                <button className="chatSend" onClick={sendChat} disabled={!joined}>
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
