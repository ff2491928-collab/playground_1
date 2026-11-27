import { useEffect, useRef, useState, type FormEvent } from "react";
import "./rooms.css";

const API_BASE = String((import.meta as any).env?.VITE_API_URL || "").replace(/\/$/, "");

const games = [
  { id: "reaction-rush", icon: "⚡", name: "Reaction Rush", type: "Reaksi", players: "2–8", color: "purple" },
  { id: "brain-battle", icon: "🧠", name: "Brain Battle", type: "Zəka və bilik", players: "2–10", color: "blue" },
  { id: "draw-guess", icon: "🎨", name: "Draw & Guess", type: "Rəsm və təxmin", players: "3–8", color: "pink" },
  { id: "secret-role", icon: "🕵️", name: "Secret Role", type: "Sosial strategiya", players: "4–10", color: "gold" },
];

type Player = { id: string; name: string; isHost: boolean };
type Room = {
  id: string;
  name: string;
  capacity: number;
  privateRoom: boolean;
  hostId: string;
  players: Player[];
  status: "waiting" | "playing";
  selectedGame: string | null;
  gameState?: ReactionGameState | null;
  createdAt: number;
};
type ReactionHit = { playerId: string; playerName: string; reactionMs: number };
type ReactionGameState = { phase: "countdown"; startAt: number; endsAt: number; hits: ReactionHit[] };
type ChatMessage = {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  createdAt: number;
};

export default function App() {
  const [activeTab, setActiveTab] = useState("games");
  const [showCreate, setShowCreate] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [capacity, setCapacity] = useState("8");
  const [privateRoom, setPrivateRoom] = useState(false);
  const [nickname, setNickname] = useState(() => localStorage.getItem("playground-name") || "Qonaq");
  const [joinCode, setJoinCode] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [myPlayerId, setMyPlayerId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [selectedGame, setSelectedGame] = useState(games[0].id);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [gameState, setGameState] = useState<ReactionGameState | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const socketRef = useRef<WebSocket | null>(null);

  const saveNickname = (value: string) => {
    const clean = value.slice(0, 20);
    setNickname(clean);
    localStorage.setItem("playground-name", clean);
  };

  const loadRooms = async () => {
    if (!API_BASE) return;
    try {
      const response = await fetch(`${API_BASE}/api/rooms`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Otaqları yükləmək mümkün olmadı.");
      setRooms(data.rooms || []);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Serverə qoşulmaq mümkün olmadı.");
    }
  };

  useEffect(() => {
    void loadRooms();
    const refresh = window.setInterval(() => void loadRooms(), 10000);
    return () => {
      window.clearInterval(refresh);
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!gameState) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [gameState]);

  const connectToRoom = (roomId: string, playerName: string, playerId = "") => {
    if (!API_BASE) {
      setNotice("Backend ünvanı hələ qoşulmayıb. Cloudflare Pages-də VITE_API_URL dəyişənini əlavə et.");
      return;
    }

    socketRef.current?.close();
    setConnected(false);
    const wsBase = API_BASE.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
    const params = new URLSearchParams({ name: playerName || "Qonaq" });
    if (playerId) params.set("playerId", playerId);
    const socket = new WebSocket(`${wsBase}/api/rooms/${roomId}/ws?${params.toString()}`);
    socketRef.current = socket;

    socket.onopen = () => setConnected(true);
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "welcome") {
          setCurrentRoom(data.room);
          setMyPlayerId(data.playerId);
          setMessages(data.messages || []);
          setGameState(data.gameState || null);
          setActiveTab("rooms");
          setNotice(`${data.room.name} otağına qoşuldun.`);
          void loadRooms();
        } else if (data.type === "room_update") {
          setCurrentRoom(data.room);
          setGameState(data.room.gameState || null);
          void loadRooms();
        } else if (data.type === "chat") {
          setMessages((previous) => [...previous, data.message].slice(-50));
        } else if (data.type === "game_started") {
          setCurrentRoom(data.room);
          setGameState(data.gameState || null);
          setClockNow(Date.now());
          const game = games.find((item) => item.id === data.gameId);
          setNotice(`${game?.name || "Oyun"} başladı!`);
        } else if (data.type === "reaction_update") {
          setGameState(data.gameState || null);
        } else if (data.type === "room_closed") {
          setCurrentRoom(null);
          setMessages([]);
          setGameState(null);
          setConnected(false);
          setNotice("Otaq bağlandı.");
          void loadRooms();
        } else if (data.type === "error") {
          setNotice(data.message || "Əməliyyat alınmadı.");
        }
      } catch {
        setNotice("Serverdən gələn məlumat oxunmadı.");
      }
    };
    socket.onerror = () => setNotice("Real vaxt bağlantısında xəta oldu. Server ünvanını və deployment statusunu yoxla.");
    socket.onclose = () => setConnected(false);
  };

  const createRoom = async () => {
    if (!API_BASE) {
      setNotice("Əvvəlcə Cloudflare Pages-də VITE_API_URL dəyişənini əlavə etmək lazımdır.");
      return;
    }
    if (!roomName.trim()) {
      setNotice("Otağın adını daxil et.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: roomName.trim(),
          capacity: Number(capacity),
          privateRoom,
          hostName: nickname.trim() || "Qonaq",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Otaq yaratmaq mümkün olmadı.");

      setShowCreate(false);
      setRoomName("");
      setPrivateRoom(false);
      connectToRoom(data.room.id, nickname.trim() || "Qonaq", data.playerId);
      void loadRooms();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Otaq yaratmaq mümkün olmadı.");
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async (code: string) => {
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(normalized)) {
      setNotice("Otaq kodu 8 simvoldan ibarət olmalıdır.");
      return;
    }
    if (!API_BASE) {
      setNotice("Backend ünvanı hələ qoşulmayıb.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/rooms/${normalized}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Otaq tapılmadı.");
      connectToRoom(normalized, nickname.trim() || "Qonaq");
      setJoinCode("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Otağa qoşulmaq mümkün olmadı.");
    } finally {
      setBusy(false);
    }
  };

  const sendChat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = chatText.trim();
    if (!text || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: "chat", text }));
    setChatText("");
  };

  const sendRoomAction = (type: string, extra: Record<string, string> = {}) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setNotice("Otaq bağlantısı aktiv deyil.");
      return;
    }
    socketRef.current.send(JSON.stringify({ type, ...extra }));
  };

  const leaveRoom = () => {
    socketRef.current?.close(1000, "Player left");
    socketRef.current = null;
    setCurrentRoom(null);
    setMyPlayerId("");
    setMessages([]);
    setGameState(null);
    setConnected(false);
    setNotice("Otaqdan çıxdın.");
    void loadRooms();
  };

  const copyCode = async () => {
    if (!currentRoom) return;
    try {
      await navigator.clipboard.writeText(currentRoom.id);
      setNotice("Otaq kodu kopyalandı. Dostlarına göndərə bilərsən.");
    } catch {
      setNotice(`Otaq kodun: ${currentRoom.id}`);
    }
  };

  const currentGameName = games.find((game) => game.id === currentRoom?.selectedGame)?.name;
  const reactionStarted = Boolean(gameState && clockNow >= gameState.startAt);
  const reactionFinished = Boolean(gameState && clockNow >= gameState.endsAt);
  const myReaction = gameState?.hits.find((hit) => hit.playerId === myPlayerId);

  return (
    <div className="app">
      <header className="navbar">
        <a className="brand" href="#top" onClick={() => setActiveTab("games")}>
          <span className="brand-icon">P</span> PLAY<span>GROUND</span>
        </a>
        <div className="nav-links">
          <button onClick={() => setActiveTab("games")}>Oyunlar</button>
          <button onClick={() => setActiveTab("rooms")}>Otaqlar</button>
          <button onClick={() => setActiveTab("about")}>Haqqımızda</button>
        </div>
        <button className="login-button" onClick={() => setNotice("PLAYGROUND hazırda qonaq rejimində işləyir.")}> {nickname || "Qonaq"} </button>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-content">
            <div className="eyebrow"><span className="live-dot" /> OYUNUN YENİ MƏRKƏZİ</div>
            <h1>Oyun tək deyil,<br /><span>birlikdə daha yaxşıdır.</span></h1>
            <p>Dostlarını çağır, otağını yarat və fərqli mini-oyunlarda rəqabətə başla.</p>
            <div className="hero-actions">
              <button className="primary-button" onClick={() => setShowCreate(true)}>Otaq yarat <span>↗</span></button>
              <button className="secondary-button" onClick={() => setActiveTab("rooms")}>Otaqlara bax</button>
            </div>
            <div className="hero-note"><span>✦</span> Dostlarınla oynamaq üçün hazırlanıb</div>
          </div>
          <div className="hero-art">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="game-symbol">✦</div>
            <div className="floating-card card-one">🎮 <span>PLAY</span></div>
            <div className="floating-card card-two">⚡ <span>COMPETE</span></div>
            <div className="floating-card card-three">👥 <span>TOGETHER</span></div>
            <div className="hero-glow" />
          </div>
        </section>

        <section className="content-section">
          <div className="section-heading">
            <div>
              <div className="section-kicker">PLAYGROUND UNİVERSİ</div>
              <h2>{currentRoom ? "Sənin oyun otağın" : activeTab === "rooms" ? "Oyun otaqları" : activeTab === "about" ? "Birlikdə oynamaq üçün" : "Oyunlarını seç"}</h2>
            </div>
            <div className="tabs">
              <button className={activeTab === "games" ? "tab active" : "tab"} onClick={() => setActiveTab("games")}>Oyunlar</button>
              <button className={activeTab === "rooms" ? "tab active" : "tab"} onClick={() => setActiveTab("rooms")}>Otaqlar</button>
            </div>
          </div>

          {activeTab === "games" && (
            <div className="game-grid">
              {games.map((game) => (
                <article className={`game-card ${game.color}`} key={game.id}>
                  <div className="game-top"><div className="game-icon">{game.icon}</div><span className={game.id === "reaction-rush" ? "game-available" : "coming-soon"}>{game.id === "reaction-rush" ? "OYNA" : "YAXINDA"}</span></div>
                  <h3>{game.name}</h3><p>{game.type}</p>
                  <div className="game-footer"><span>👥 {game.players} oyunçu</span><span className="game-arrow">↗</span></div>
                </article>
              ))}
            </div>
          )}

          {activeTab === "rooms" && !currentRoom && (
            <div className="room-browser">
              <div className="room-join-panel">
                <div className="section-kicker">DOSTLARINA QOŞUL</div>
                <h3>Otaq kodunu daxil et</h3>
                <p>Dostunun göndərdiyi 8 simvollu kodla otağa qoşul.</p>
                <label className="room-field-label">Oyunçu adın</label>
                <input className="room-input" value={nickname} maxLength={20} onChange={(event) => saveNickname(event.target.value)} placeholder="Adın" />
                <label className="room-field-label">Otaq kodu</label>
                <div className="join-code-row">
                  <input className="room-input code-input" value={joinCode} maxLength={8} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="ABCD2345" />
                  <button className="primary-button" disabled={busy} onClick={() => void joinRoom(joinCode)}>Qoşul ↗</button>
                </div>
                <button className="secondary-button create-inline" onClick={() => setShowCreate(true)}>Yeni otaq yarat</button>
              </div>

              <div className="room-list-panel">
                <div className="room-list-heading"><div><div className="section-kicker">İCTİMAİ OTAQLAR</div><h3>Hazırda açıq olanlar</h3></div><button className="refresh-button" onClick={() => void loadRooms()}>↻ Yenilə</button></div>
                {rooms.length === 0 ? (
                  <div className="room-empty"><span>♧</span><h3>Hələ açıq otaq yoxdur</h3><p>İlk otağı sən yarat və dostlarını dəvət et.</p></div>
                ) : (
                  <div className="room-list">
                    {rooms.map((room) => (
                      <article className="room-list-card" key={room.id}>
                        <div className="room-list-icon">🎮</div>
                        <div className="room-list-info"><strong>{room.name}</strong><span>{room.players.length}/{room.capacity} oyunçu · {room.status === "playing" ? "Oyunda" : "Lobbidə"}</span></div>
                        <button className="secondary-button" disabled={busy} onClick={() => void joinRoom(room.id)}>Qoşul</button>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "rooms" && currentRoom && (
            <div className="room-dashboard">
              <div className="room-dashboard-top">
                <div><div className="section-kicker">{connected ? "● CANLI BAĞLANTI" : "BAĞLANTI QURULUR"}</div><h3>{currentRoom.name}</h3><p>{currentRoom.privateRoom ? "Şəxsi otaq" : "Açıq otaq"} · {currentRoom.players.length}/{currentRoom.capacity} oyunçu</p></div>
                <button className="secondary-button" onClick={leaveRoom}>Otaqdan çıx</button>
              </div>
              <div className="room-code-box"><div><span>OTAQ DƏVƏT KODU</span><strong>{currentRoom.id}</strong></div><button className="primary-button" onClick={() => void copyCode()}>Kodu kopyala</button></div>
              <div className="room-dashboard-grid">
                <section className="room-panel"><div className="room-panel-heading"><h4>Oyunçular</h4><span>{currentRoom.players.length} nəfər</span></div><div className="room-player-list">{currentRoom.players.map((player) => <div className="room-player" key={player.id}><span className="player-avatar">{player.name.slice(0, 1).toUpperCase()}</span><strong>{player.name}</strong>{player.isHost && <span className="host-tag">HOST</span>}{player.id === myPlayerId && <span className="you-tag">SƏN</span>}</div>)}</div></section>
                <section className="room-panel room-game-panel"><div className="room-panel-heading"><h4>Oyun seçimi</h4><span>{currentRoom.status === "playing" ? "Başlayıb" : "Gözləyir"}</span></div>{currentRoom.status === "playing" ? <div className="selected-game-state"><span>🎮</span><strong>{currentGameName || "Oyun"}</strong>{currentRoom.selectedGame === "reaction-rush" && gameState ? <div className="reaction-game"><div className="reaction-status">{reactionFinished ? "RAUND BİTDİ" : reactionStarted ? "İNDİ BAS!" : "YAŞIL SİQNALI GÖZLƏ"}</div><button className="reaction-hit-button" disabled={!connected || !reactionStarted || reactionFinished || Boolean(myReaction)} onClick={() => sendRoomAction("reaction_hit")}>{myReaction ? "CAVAB QEYD OLUNDU" : reactionFinished ? "RAUND BİTDİ" : reactionStarted ? "BAS!" : "GÖZLƏ..."}</button><p>{!reactionStarted ? `Başlamağa ${Math.max(0, (gameState.startAt - clockNow) / 1000).toFixed(1)} saniyə` : reactionFinished ? "Nəticələr:" : "Ən sürətli reaksiya qalibdir."}</p><div className="reaction-results">{gameState.hits.slice().sort((x, y) => x.reactionMs - y.reactionMs).map((hit, index) => <div key={hit.playerId}><strong>{index + 1}. {hit.playerName}</strong><span>{hit.reactionMs} ms</span></div>)}</div>{reactionFinished && currentRoom.hostId === myPlayerId && <button className="secondary-button" onClick={() => sendRoomAction("back_to_lobby")}>Yenidən oynamaq üçün lobbiyə qayıt</button>}</div> : <p>Bu oyunun mexanikası hələ hazırlanmayıb.</p>}</div> : <><p>Otaq sahibi oynanacaq mini-oyunu seçə bilər.</p><select className="room-input" value={selectedGame} onChange={(event) => setSelectedGame(event.target.value)}>{games.map((game) => <option value={game.id} key={game.id} disabled={game.id !== "reaction-rush"}>{game.name}{game.id !== "reaction-rush" ? " — Yaxında" : ""}</option>)}</select>{currentRoom.hostId === myPlayerId ? <button className="primary-button full-button" onClick={() => sendRoomAction("start_game", { gameId: selectedGame })}>Oyunu başlat ↗</button> : <p className="room-hint">Otaq sahibinin oyunu başlatmasını gözlə.</p>}</>}{currentRoom.hostId === myPlayerId && <div className="host-actions"><button className="secondary-button" onClick={() => sendRoomAction("close_room")}>Otağı bağla</button>{currentRoom.status === "playing" && <button className="secondary-button" onClick={() => sendRoomAction("back_to_lobby")}>Lobbiyə qayıt</button>}</div>}</section>
              </div>
              <section className="room-panel room-chat-panel"><div className="room-panel-heading"><h4>Otaq söhbəti</h4><span>Canlı çat</span></div><div className="chat-messages">{messages.length === 0 ? <p className="room-hint">Hələ mesaj yoxdur. İlk mesajı sən yaz.</p> : messages.map((message) => <div className="chat-message" key={message.id}><strong>{message.playerName}</strong><span>{message.text}</span></div>)}</div><form className="chat-form" onSubmit={sendChat}><input className="room-input" value={chatText} maxLength={300} onChange={(event) => setChatText(event.target.value)} placeholder="Mesaj yaz..." /><button className="primary-button" type="submit" disabled={!connected || !chatText.trim()}>Göndər</button></form></section>
            </div>
          )}

          {activeTab === "about" && <div className="empty-rooms"><div className="empty-icon">✦</div><h3>Oyun, dostlar və rəqabət</h3><p>PLAYGROUND müxtəlif mini-oyunları bir platformada birləşdirmək üçün hazırlanır.</p></div>}
        </section>

        <section className="bottom-banner"><div><span className="section-kicker">SƏNİN OTAĞIN, SƏNİN QAYDALARIN</span><h2>Dostlarını topla. Oyuna başla.</h2></div><button className="primary-button" onClick={() => setShowCreate(true)}>İndi başla ↗</button></section>
      </main>

      <footer><a className="brand" href="#top"><span className="brand-icon">P</span> PLAY<span>GROUND</span></a><p>Birlikdə oynamaq daha gözəldir.</p><span>© 2026 PLAYGROUND <b className="footer-he">H E</b></span></footer>

      {!API_BASE && <div className="app-toast warning-toast">Backend ünvanı qoşulmayıb. Cloudflare Pages-də VITE_API_URL əlavə edilməlidir.</div>}
      {notice && <div className="app-toast" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Bildirişi bağla">×</button></div>}

      {showCreate && <div className="modal-backdrop" onClick={() => setShowCreate(false)}><div className="room-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowCreate(false)}>×</button><div className="section-kicker">YENİ MACƏRA</div><h2>Otağını yarat</h2><p className="modal-description">Dostlarını dəvət et və birlikdə oynamağa başla.</p><label>Oyunçu adın</label><input value={nickname} maxLength={20} onChange={(event) => saveNickname(event.target.value)} placeholder="Adın" /><label>Otağın adı</label><input value={roomName} maxLength={36} onChange={(event) => setRoomName(event.target.value)} placeholder="Məsələn: Dostlarla oyun" /><label>Oyunçu sayı</label><select value={capacity} onChange={(event) => setCapacity(event.target.value)}>{["2", "4", "6", "8", "10"].map((number) => <option key={number} value={number}>{number} oyunçu</option>)}</select><label className="private-option"><input type="checkbox" checked={privateRoom} onChange={(event) => setPrivateRoom(event.target.checked)} />Şəxsi otaq olsun</label><button className="primary-button full-button" disabled={busy} onClick={() => void createRoom()}>{busy ? "Yaradılır..." : "Otaq yarat ↗"}</button><p className="modal-footnote">Otaqlar serverdə saxlanılır. Şəxsi otaqlar ümumi siyahıda görünmür.</p></div></div>}
    </div>
  );
}
