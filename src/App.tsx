import { useState } from "react";

const games = [
  { icon: "⚡", name: "Reaction Rush", type: "Reaksiya", players: "2–8", color: "purple" },
  { icon: "🧠", name: "Brain Battle", type: "Zəka və bilik", players: "2–10", color: "blue" },
  { icon: "🎨", name: "Draw & Guess", type: "Rəsm və təxmin", players: "3–8", color: "pink" },
  { icon: "🕵️", name: "Secret Role", type: "Sosial strategiya", players: "4–10", color: "gold" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("games");
  const [showCreate, setShowCreate] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [capacity, setCapacity] = useState("8");
  const [privateRoom, setPrivateRoom] = useState(false);

  return (
    <div className="app">
      <header className="navbar">
        <a className="brand" href="#">
          <span className="brand-icon">P</span>
          PLAY<span>GROUND</span>
        </a>
        <div className="nav-links">
          <button onClick={() => setActiveTab("games")}>Oyunlar</button>
          <button onClick={() => setActiveTab("rooms")}>Otaqlar</button>
          <button onClick={() => setActiveTab("about")}>Haqqımızda</button>
        </div>
        <button className="login-button">Daxil ol</button>
      </header>

      <main>
        <section className="hero">
          <div className="hero-content">
            <div className="eyebrow">
              <span className="live-dot" /> OYUNUN YENİ MƏRKƏZİ
            </div>
            <h1>
              Oyun tək deyil,
              <br />
              <span>birlikdə daha yaxşıdır.</span>
            </h1>
            <p>
              Dostlarını çağır, otağını yarat və fərqli mini-oyunlarda
              rəqabətə başla.
            </p>
            <div className="hero-actions">
              <button className="primary-button" onClick={() => setShowCreate(true)}>
                Otaq yarat <span>↗</span>
              </button>
              <button className="secondary-button" onClick={() => setActiveTab("rooms")}>
                Otaqlara bax
              </button>
            </div>
            <div className="hero-note">
              <span>✦</span> Dostlarınla oynamaq üçün hazırlanıb
            </div>
          </div>

          <div className="hero-art">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
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
              <h2>{activeTab === "rooms" ? "Oyun otaqları" : activeTab === "about" ? "Birlikdə oynamaq üçün" : "Oyunlarını seç"}</h2>
            </div>
            <div className="tabs">
              <button className={activeTab === "games" ? "tab active" : "tab"} onClick={() => setActiveTab("games")}>Oyunlar</button>
              <button className={activeTab === "rooms" ? "tab active" : "tab"} onClick={() => setActiveTab("rooms")}>Otaqlar</button>
            </div>
          </div>

          {activeTab === "games" && (
            <div className="game-grid">
              {games.map((game) => (
                <article className={`game-card ${game.color}`} key={game.name}>
                  <div className="game-top">
                    <div className="game-icon">{game.icon}</div>
                    <span className="coming-soon">YAXINDA</span>
                  </div>
                  <h3>{game.name}</h3>
                  <p>{game.type}</p>
                  <div className="game-footer">
                    <span>👥 {game.players} oyunçu</span>
                    <span className="game-arrow">↗</span>
                  </div>
                </article>
              ))}
            </div>
          )}

          {activeTab === "rooms" && (
            <div className="empty-rooms">
              <div className="empty-icon">♧</div>
              <h3>Hələlik açıq otaq yoxdur</h3>
              <p>İlk otağı sən yarat və dostlarını dəvət et.</p>
              <button className="primary-button" onClick={() => setShowCreate(true)}>Otaq yarat ↗</button>
            </div>
          )}

          {activeTab === "about" && (
            <div className="empty-rooms">
              <div className="empty-icon">✦</div>
              <h3>Oyun, dostlar və rəqabət</h3>
              <p>PLAYGROUND müxtəlif mini-oyunları bir platformada birləşdirmək üçün hazırlanır.</p>
            </div>
          )}
        </section>

        <section className="bottom-banner">
          <div>
            <span className="section-kicker">SƏNİN OTAĞIN, SƏNİN QAYDALARIN</span>
            <h2>Dostlarını topla. Oyuna başla.</h2>
          </div>
          <button className="primary-button" onClick={() => setShowCreate(true)}>İndi başla ↗</button>
        </section>
      </main>

      <footer>
        <a className="brand" href="#"><span className="brand-icon">P</span> PLAY<span>GROUND</span></a>
        <p>Birlikdə oynamaq daha gözəldir.</p>
        <span>© 2026 PLAYGROUND</span>
      </footer>

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="room-modal" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCreate(false)}>×</button>
            <div className="section-kicker">YENİ MACƏRA</div>
            <h2>Otağını yarat</h2>
            <p className="modal-description">Dostlarını dəvət etmək üçün öz otağını hazırla.</p>
            <label>Otağın adı</label>
            <input value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="Məsələn: Dostlarla oyun" />
            <label>Oyunçu sayı</label>
            <select value={capacity} onChange={(event) => setCapacity(event.target.value)}>
              {["2", "4", "6", "8", "10"].map((n) => <option key={n} value={n}>{n} oyunçu</option>)}
            </select>
            <label className="private-option">
              <input type="checkbox" checked={privateRoom} onChange={(event) => setPrivateRoom(event.target.checked)} />
              Şəxsi otaq olsun
            </label>
            <button className="primary-button full-button" onClick={() => alert("Otaq sistemi növbəti mərhələdə aktiv ediləcək.")}>
              Otaq yarat ↗
            </button>
            <p className="modal-footnote">Otaqların real yaradılması növbəti mərhələdə qoşulacaq.</p>
          </div>
        </div>
      )}
    </div>
  );
              }
