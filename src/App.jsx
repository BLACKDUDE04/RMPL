import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Route, Routes, useLocation, useParams } from 'react-router-dom';

const API_ORIGIN = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const API = `${API_ORIGIN}/api`;
const AUCTION_SOUND_DURATION_MS = 5000;
const SOLD_SOUND_DURATION_MS = 5000;
const ROUTE_LOADING_DURATION_MS = 1500;
const LIVE_DATA_CHANGED_EVENT = 'rmpl-live-data-changed';

function useLiveDataRefresh(refresh) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const handleChange = () => refreshRef.current();
    window.addEventListener(LIVE_DATA_CHANGED_EVENT, handleChange);
    return () => window.removeEventListener(LIVE_DATA_CHANGED_EVENT, handleChange);
  }, []);
}

const formatEventDate = (value) => {
  if (!value) return 'Previous Event';
  const [date] = String(value).split('T');
  const parts = date.split('-');
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : value;
};

const categoryLabels = {
  allrounder: 'All Rounder',
  batsmen: 'Batsmen',
  bowler: 'Bowler',
  wicketkeeper: 'Wicket Keeper',
  mvp: 'MVP Players'
};

const resolveAssetUrl = (value) => {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/uploads/')) {
    return API_ORIGIN ? `${API_ORIGIN}${value}` : value;
  }
  return value;
};

const getPlayerRoleDetails = (player) => {
  if (player?.source === 'registration' && player.registrationRoles?.length) {
    return `Roles: ${player.registrationRoles.join(', ')}`;
  }
  return player?.details || '';
};

const defaultExcelColumns = {
  nameColumn: 'name',
  categoryColumn: 'category',
  detailsColumn: 'details',
  teamColumn: 'team',
  amountColumn: 'amount',
  imageColumn: 'image',
  phoneColumn: 'phone'
};

function PlayersPage({ refreshData }) {
  const [players, setPlayers] = useState([]);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const [playerImagePreview, setPlayerImagePreview] = useState('');
  const load = () => fetch(`${API}/players`).then((response) => response.json()).then((data) => setPlayers(data.players || []));
  useEffect(() => { load(); }, []);
  useLiveDataRefresh(load);
  useEffect(() => { if (editing) setPlayerImagePreview(editing.image || ''); }, [editing]);
  const save = async (event) => {
    event.preventDefault();
    const response = await fetch(editing ? `${API}/players/${editing._id}` : `${API}/players`, { method: editing ? 'PUT' : 'POST', body: new FormData(event.currentTarget) });
    const data = await response.json(); setMessage(data.message);
    if (response.ok) { setEditing(null); setShowForm(false); setPlayerImagePreview(''); await Promise.all([load(), refreshData()]); }
  };
  const remove = async (player) => {
    if (!window.confirm(`Delete ${player.name}?`)) return;
    const response = await fetch(`${API}/players/${player._id}`, { method: 'DELETE' });
    const data = await response.json(); setMessage(data.message);
    if (response.ok) await Promise.all([load(), refreshData()]);
  };
  const filtered = players.filter((player) => {
    const matchesCategory = categoryFilter === 'all' || player.category === categoryFilter;
    const matchesSearch = [player.auctionNumber, player.name, player.category, player.playedIn, player.team, player.details, player.sold ? 'sold' : player.unsold ? 'unsold' : 'available'].join(' ').toLowerCase().includes(query.toLowerCase());
    return matchesCategory && matchesSearch;
  });
  return <main className="panel">
    <div className="page-heading"><div><span className="eyebrow">PLAYER DATABASE</span><h2>Players</h2></div><div className="page-heading-actions"><button onClick={() => { setEditing(null); setPlayerImagePreview(''); setShowForm(!showForm); }}>{showForm ? 'Close Form' : 'Add Player'}</button><Link className="back-link" to="/">Back</Link></div></div>
    {showForm || editing ? <form className="manual-player-form player-editor form-reveal" onSubmit={save} key={editing?._id || 'new'}>
      <div className="full-field player-form-image-preview">{playerImagePreview ? <img src={resolveAssetUrl(playerImagePreview)} alt="Player preview" /> : <div><span>Image Preview</span><small>Upload an image or enter an image URL</small></div>}</div>
      <label>Name<input name="name" defaultValue={editing?.name || ''} required /></label>
      <label>Category<select name="category" defaultValue={editing?.category || 'allrounder'}><option value="allrounder">All Rounder</option><option value="batsmen">Batsmen</option><option value="bowler">Bowler</option><option value="wicketkeeper">Wicket Keeper</option><option value="mvp">MVP Player</option></select></label>
      <label className="full-field">Details<textarea name="details" defaultValue={editing?.details || ''} /></label>
      <label>Played In<input name="playedIn" placeholder="Previous or regular team" defaultValue={editing?.playedIn || (!editing?.sold ? editing?.team : '') || ''} /></label><label>Base Price<input name="amount" type="number" min="0" defaultValue={editing?.amount || 0} /></label><label>Phone Number<input name="phone" type="tel" defaultValue={editing?.phone || ''} placeholder="Optional" /></label>
      <label>{editing ? 'Replace Image' : 'Player Image'}<input name="image" type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) setPlayerImagePreview(URL.createObjectURL(file)); }} /></label><label>Image URL<input name="imageUrl" type="url" defaultValue={editing?.image?.startsWith('http') ? editing.image : ''} onChange={(event) => setPlayerImagePreview(event.target.value)} /></label>
      {editing ? <input type="hidden" name="image" value={editing.image || ''} /> : null}<button>Save Player</button><button type="button" className="ghost" onClick={() => { setEditing(null); setShowForm(false); setPlayerImagePreview(''); }}>Cancel</button>
    </form> : null}
    {message ? <p className="feedback">{message}</p> : null}
    <div className="players-filter-bar">
      <div className="player-search"><span>⌕</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search players..." />{query ? <button onClick={() => setQuery('')}>Clear</button> : null}</div>
      <label className="category-filter">Category
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="all">All Categories</option>
          <option value="allrounder">All Rounder</option>
          <option value="batsmen">Batsmen</option>
          <option value="bowler">Bowler</option>
          <option value="wicketkeeper">Wicket Keeper</option>
          <option value="mvp">MVP Players</option>
        </select>
      </label>
    </div>
    <p className="filter-result-count">{filtered.length} player{filtered.length === 1 ? '' : 's'} shown</p>
    <div className="all-players-grid">{filtered.map((player) => <article className="database-player-card" key={player._id}><img src={resolveAssetUrl(player.image || 'https://via.placeholder.com/240')} alt={player.name} /><div className="database-player-details"><span className={`result-status ${player.sold ? 'sold' : player.unsold ? 'unsold' : 'available'}`}>{player.sold ? 'SOLD' : player.unsold ? 'UNSOLD' : 'AVAILABLE'}</span><h3>#{player.auctionNumber} · {player.name}</h3><p>{categoryLabels[player.category]}</p><p><strong>Played In:</strong> {player.playedIn || (!player.sold ? player.team : '') || '—'}</p><p>{player.details}</p><strong>{Number(player.amount || 0).toLocaleString()} Points</strong><div className="management-actions"><button onClick={() => { setEditing(player); setShowForm(true); window.scrollTo(0, 0); }}>Edit</button><button className="danger-button" onClick={() => remove(player)}>Delete</button></div></div></article>)}</div>
  </main>;
}

function WelcomeVideoPage({ settings, refreshData }) {
  const [videoPreview, setVideoPreview] = useState(settings.welcomeVideo || '');
  const [feedback, setFeedback] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => setVideoPreview(settings.welcomeVideo || ''), [settings.welcomeVideo]);

  const saveVideo = async (event) => {
    event.preventDefault();
    setUploading(true);
    setFeedback('Uploading welcome video...');
    const response = await fetch(`${API}/settings/welcome-video`, { method: 'POST', body: new FormData(event.currentTarget) });
    const data = await response.json();
    if (response.ok) {
      setFeedback(data.message);
      setVideoPreview(data.welcomeVideo);
      await refreshData();
    } else {
      setFeedback(data.message || 'Unable to upload video');
    }
    setUploading(false);
  };

  return <main className="panel welcome-video-page">
    <div className="page-heading"><div><span className="eyebrow">WELCOME MEDIA</span><h2>Welcome Video</h2><p>Upload and preview the video used to welcome auction viewers.</p></div><Link className="back-link" to="/">Back to auction</Link></div>
    <div className="welcome-video-layout">
      <section className="welcome-video-preview">
        {videoPreview ? <video src={resolveAssetUrl(videoPreview)} controls playsInline /> : <div><strong>No welcome video uploaded</strong><span>Select a video file to preview it here.</span></div>}
      </section>
      <form className="welcome-video-form" onSubmit={saveVideo}>
        <label>Choose Welcome Video
          <input name="welcomeVideo" type="file" accept="video/*" required onChange={(event) => { const file = event.target.files?.[0]; if (file) setVideoPreview(URL.createObjectURL(file)); }} />
        </label>
        <small>Recommended formats: MP4 or WebM.</small>
        <button type="submit" disabled={uploading}>{uploading ? 'Uploading...' : 'Save Welcome Video'}</button>
        {feedback ? <p className={`settings-feedback ${feedback.includes('successfully') ? 'success' : feedback.includes('Uploading') ? 'saving' : ''}`}>{feedback}</p> : null}
      </form>
    </div>
  </main>;
}

function TestimonialsPage() {
  const [items, setItems] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [feedback, setFeedback] = useState('');
  const loadItems = () => fetch(`${API}/testimonials`).then((response) => response.json()).then((data) => setItems(data.testimonials || []));
  useEffect(() => { loadItems(); }, []);
  useLiveDataRefresh(loadItems);
  const saveItem = async (event) => {
    event.preventDefault();
    const response = await fetch(`${API}/testimonials`, { method: 'POST', body: new FormData(event.currentTarget) });
    const data = await response.json(); setFeedback(data.message);
    if (response.ok) { event.currentTarget.reset(); setShowForm(false); await loadItems(); }
  };
  const removeItem = async (item) => {
    if (!window.confirm(`Delete ${item.title}?`)) return;
    const response = await fetch(`${API}/testimonials/${item._id}`, { method: 'DELETE' });
    const data = await response.json(); setFeedback(data.message);
    if (response.ok) await loadItems();
  };
  return <main className="panel testimonials-page">
    <div className="page-heading"><div><span className="eyebrow">RMPL HISTORY</span><h2>Previous Events & Winners</h2><p>Celebrate past events, moments, and champions.</p></div><div className="page-heading-actions"><button onClick={() => setShowForm(!showForm)}>{showForm ? 'Close Form' : 'Add Previous Event'}</button><Link className="back-link" to="/">Back</Link></div></div>
    {showForm ? <form className="testimonial-form form-reveal" onSubmit={saveItem}>
      <label>Event Title<input name="title" required /></label><label>Event Date<input name="eventDate" type="date" /></label>
      <label className="full-field">Event Details<textarea name="description" rows="4" required /></label>
      <label>Event Pictures<input name="eventImages" type="file" accept="image/*" multiple /></label>
      <label>Previous Winner Name<input name="winnerName" /></label><label>Previous Winner Image<input name="winnerImage" type="file" accept="image/*" /></label>
      <label className="highlight-checkbox"><input name="highlighted" type="checkbox" /> Highlight this event</label><button type="submit">Save Previous Event</button>
    </form> : null}
    {feedback ? <p className="feedback">{feedback}</p> : null}
    <div className="testimonials-grid">{items.map((item) => <article className={`testimonial-card ${item.highlighted ? 'highlighted' : ''}`} key={item._id}>
      {item.highlighted ? <span className="highlight-ribbon">★ HIGHLIGHT</span> : null}
      {item.images?.[0] ? <img className="event-cover" src={resolveAssetUrl(item.images[0])} alt={item.title} /> : null}
      <div className="testimonial-content"><span>{formatEventDate(item.eventDate)}</span><h3>{item.title}</h3><p>{item.description}</p>
        {item.images?.length > 1 ? <div className="event-gallery">{item.images.slice(1).map((image, index) => <img src={resolveAssetUrl(image)} alt={`${item.title} ${index + 2}`} key={image} />)}</div> : null}
        {item.winnerName || item.winnerImage ? <div className="previous-winner">{item.winnerImage ? <img src={item.winnerImage} alt={item.winnerName} /> : null}<div><small>PREVIOUS WINNER</small><strong>{item.winnerName || 'Winner'}</strong></div></div> : null}
        <button className="danger-button" onClick={() => removeItem(item)}>Delete</button>
      </div>
    </article>)}</div>
  </main>;
}

function TeamPlayersPage({ teams }) {
  const { teamId } = useParams();
  const team = teams.find((item) => item._id === teamId);
  if (!team) return <main className="panel">Loading team...</main>;
  return <main className="panel"><div className="page-heading"><div className="team-detail-title">{team.logo ? <img src={team.logo} alt={team.name} /> : null}<div><span className="eyebrow">TEAM SQUAD</span><h2>{team.name}</h2><p>{team.playerCount} players</p></div></div><Link to="/teams" className="back-link">Back</Link></div><div className="team-detail-stats"><span>Opening <strong>{Number(team.purse).toLocaleString()} Points</strong></span><span>Spent <strong>{Number(team.spent).toLocaleString()} Points</strong></span><span>Remaining <strong>{Number(team.remainingPurse).toLocaleString()} Points</strong></span></div><div className="team-squad-grid">{(team.players || []).map((player) => <article className="squad-player-card" key={player._id}><img src={player.image} alt={player.name} /><div><span></span><h3>{player.name}</h3><p>{categoryLabels[player.category]}</p><strong>{Number(player.amount).toLocaleString()} Points</strong></div></article>)}</div></main>;
}

function UnsoldPlayersPage({ teams, refreshData, settings }) {
  const [players, setPlayers] = useState([]);
  const [selling, setSelling] = useState(null);
  const [sale, setSale] = useState({ teamId: '', amount: '' });
  const [celebration, setCelebration] = useState(null);
  const load = () => fetch(`${API}/players/unsold`).then((response) => response.json()).then((data) => setPlayers(data.players || []));
  useEffect(() => { load(); }, []);
  useLiveDataRefresh(load);
  const restore = async (player) => { await fetch(`${API}/players/${player._id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'available' }) }); await Promise.all([load(), refreshData()]); };
  const sell = async (event) => {
    event.preventDefault();
    const response = await fetch(`${API}/auction/bid`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: selling._id, category: selling.category, teamId: sale.teamId, amount: sale.amount, status: 'sold' }) });
    const data = await response.json(); if (!response.ok) return;
    const team = teams.find((item) => item._id === sale.teamId);
    const audio = settings.playerSoldAudio ? new Audio(settings.playerSoldAudio) : null; if (audio) { audio.loop = true; audio.play().catch(() => {}); }
    setCelebration({ player: selling, team, amount: sale.amount }); setSelling(null); await Promise.all([load(), refreshData()]);
    setTimeout(() => { if (audio) audio.pause(); setCelebration(null); }, SOLD_SOUND_DURATION_MS);
  };
  return <main className="panel"><div className="page-heading"><div><span className="eyebrow">AUCTION HOLDING AREA</span><h2>Unsold Players</h2></div><Link className="back-link" to="/">Back</Link></div><div className="all-players-grid">{players.map((player) => <article className="database-player-card" key={player._id}><img src={resolveAssetUrl(player.image)} alt={player.name} /><div><span className="result-status unsold">UNSOLD</span><h3>#{player.auctionNumber} · {player.name}</h3><p><strong>Base Price:</strong> {Number(player.amount || 0).toLocaleString()} Points</p><div className="management-actions"><button onClick={() => { setSelling(player); setSale({ teamId: '', amount: player.amount || '' }); }}>Sell Player</button><button className="ghost" onClick={() => restore(player)}>Return to Auction</button></div></div></article>)}</div>
    {selling ? <div className="player-modal-backdrop">{settings.logo ? <img className="player-modal-logo" src={settings.logo} alt="" /> : null}<form className="panel selected-player-card player-reveal" onSubmit={sell}><button className="modal-close" type="button" onClick={() => setSelling(null)}>×</button><div className="selected-number-badge">#{selling.auctionNumber}</div><div className="player-image-wrap"><img src={selling.image} alt={selling.name} /></div><div className="player-card-details"><span className="unsold-live-badge">UNSOLD PLAYER</span><h2>{selling.name}</h2><p>{selling.details}</p><strong className="starting-bid">Base Price: {Number(selling.amount || 0).toLocaleString()} Points</strong><div className="bid-form"><select required value={sale.teamId} onChange={(event) => setSale({ ...sale, teamId: event.target.value })}><option value="">Select team</option>{teams.map((team) => <option value={team._id} key={team._id}>{team.name} — {Number(team.remainingPurse).toLocaleString()} Points</option>)}</select><input required type="number" value={sale.amount} onChange={(event) => setSale({ ...sale, amount: event.target.value })} /><button>Confirm Sold</button></div></div></form></div> : null}
    {celebration ? <div className="player-modal-backdrop"><div className="sold-celebration">{celebration.team?.logo ? <img className="sold-team-backdrop" src={celebration.team.logo} alt="" /> : null}<span className="sold-title">SOLD!</span><h2>{celebration.player.name}</h2><p>sold to</p><h1>{celebration.team?.name}</h1><strong>{Number(celebration.amount).toLocaleString()} Points</strong></div></div> : null}
  </main>;
}

function TeamsPage({ teams, refreshData }) {
  const [editingTeam, setEditingTeam] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [showTeamForm, setShowTeamForm] = useState(false);

  const saveTeam = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const response = await fetch(editingTeam ? `${API}/teams/${editingTeam._id}` : `${API}/teams`, {
      method: editingTeam ? 'PUT' : 'POST',
      body: new FormData(form)
    });
    const data = await response.json();
    setFeedback(data.message);
    if (response.ok) {
      form.reset();
      setEditingTeam(null);
      setShowTeamForm(false);
      await refreshData();
    }
  };

  const deleteTeam = async (team) => {
    if (!window.confirm(`Delete team ${team.name}? Sold-player records will keep the team name, but the team purse will be removed.`)) return;
    const response = await fetch(`${API}/teams/${team._id}`, { method: 'DELETE' });
    const data = await response.json();
    setFeedback(data.message);
    if (response.ok) await refreshData();
  };

  return (
    <main className="panel">
      <div className="page-heading">
        <div><span className="eyebrow">TEAM MANAGEMENT</span><h2>Teams</h2><p>Add teams, logos, and opening purse values.</p></div>
        <div className="page-heading-actions">
          <button type="button" onClick={() => { setEditingTeam(null); setShowTeamForm((visible) => !visible); }}>{showTeamForm && !editingTeam ? 'Close Form' : 'Add Team'}</button>
          <Link className="back-link" to="/">Back to auction</Link>
        </div>
      </div>
      {showTeamForm || editingTeam ? <form className="team-form form-reveal" onSubmit={saveTeam} key={editingTeam?._id || 'new'}>
        <label>Team Name<input name="name" defaultValue={editingTeam?.name || ''} required /></label>
        <label>Opening Purse<input name="purse" type="number" min="0" defaultValue={editingTeam?.purse || 0} required /></label>
        <label>Team Logo<input name="teamLogo" type="file" accept="image/*" /></label>
        <label>Or Logo URL<input name="logoUrl" type="url" defaultValue={editingTeam?.logo || ''} /></label>
        <button type="submit">{editingTeam ? 'Save Team' : 'Add Team'}</button>
        {editingTeam ? <button type="button" className="ghost" onClick={() => { setEditingTeam(null); setShowTeamForm(false); }}>Cancel Edit</button> : null}
      </form> : null}
      {feedback ? <p className="feedback">{feedback}</p> : null}
      <div className="teams-grid">
        {teams.map((team) => (
          <article className="team-card" key={team._id}>
            {team.logo ? <img src={resolveAssetUrl(team.logo)} alt={team.name} /> : <div className="team-logo-fallback">{team.name.charAt(0)}</div>}
            <h3>{team.name}</h3>
            <p>Purse: {Number(team.purse || 0).toLocaleString()} Points</p>
            <p>Remaining: {Number(team.remainingPurse || 0).toLocaleString()} Points</p>
            <div className="management-actions">
              <Link className="team-view-button" to={`/teams/${team._id}`}>View Players</Link>
              <button onClick={() => { setEditingTeam(team); setShowTeamForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button>
              <button className="danger-button" onClick={() => deleteTeam(team)}>Delete</button>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}

function PurseValuePage({ teams }) {
  return (
    <main className="panel">
      <div className="page-heading">
        <div><span className="eyebrow">LIVE FINANCES</span><h2>Purse Value</h2><p>Team purse and player purchase statistics.</p></div>
        <Link className="back-link" to="/">Back to auction</Link>
      </div>
      <div className="purse-stats-grid">
        {teams.map((team) => (
          <Link className="purse-card-link" to={`/teams/${team._id}`} key={team._id} aria-label={`View ${team.name} team`}>
          <article className="purse-card">
            <div className="purse-team-heading">
              {team.logo ? <img src={resolveAssetUrl(team.logo)} alt={team.name} /> : <div className="small-team-logo">{team.name.charAt(0)}</div>}
              <div><h3>{team.name}</h3><span>{team.playerCount || 0} players bought</span></div>
            </div>
            <div className="purse-numbers">
              <div><span>Opening Purse</span><strong>{Number(team.purse || 0).toLocaleString()} Points</strong></div>
              <div><span>Spent</span><strong>{Number(team.spent || 0).toLocaleString()} Points</strong></div>
              <div className="remaining"><span>Remaining</span><strong>{Number(team.remainingPurse || 0).toLocaleString()} Points</strong></div>
            </div>
            <div className="spend-progress">
              <div className="spend-progress-label"><span>Purse spent</span><strong>{team.purse > 0 ? Math.min(100, Math.round((Number(team.spent || 0) / Number(team.purse)) * 100)) : 0}%</strong></div>
              <div className="spend-progress-track"><span style={{ width: `${team.purse > 0 ? Math.min(100, (Number(team.spent || 0) / Number(team.purse)) * 100) : 0}%` }} /></div>
            </div>
        
            
          </article>
          </Link>
        ))}
      </div>
      {!teams.length ? <div className="empty-state"><h3>No teams configured</h3><p>Add teams and purse values from the Teams tab.</p></div> : null}
    </main>
  );
}

function SelectedPlayersPage({ refreshCategories, teams }) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');

  const loadPlayers = () => {
    setLoading(true);
    return fetch(`${API}/players/selected`)
      .then((response) => response.json())
      .then((data) => setPlayers(data.players || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadPlayers();
  }, []);
  useLiveDataRefresh(loadPlayers);

  const groupedPlayers = players.reduce((groups, player) => {
    const key = player.teamId || 'unassigned';
    if (teamFilter !== 'all' && key !== teamFilter) return groups;
    const team = teams.find((item) => item._id === player.teamId);
    const label = team?.name || player.team || 'Unassigned';
    if (!groups[key]) groups[key] = { label, logo: team?.logo || '', players: [] };
    groups[key].players.push(player);
    return groups;
  }, {});

  const updateStatus = async (player, status) => {
    const response = await fetch(`${API}/players/${player._id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const data = await response.json();
    setFeedback(data.message);
    if (response.ok) {
      await Promise.all([loadPlayers(), refreshCategories()]);
    }
  };

  const deletePlayer = async (player) => {
    if (!window.confirm(`Delete ${player.name}? This cannot be undone.`)) return;
    const response = await fetch(`${API}/players/${player._id}`, { method: 'DELETE' });
    const data = await response.json();
    setFeedback(data.message);
    if (response.ok) {
      await Promise.all([loadPlayers(), refreshCategories()]);
    }
  };

  const savePlayerEdit = async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    const response = await fetch(`${API}/players/${editingPlayer._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    setFeedback(data.message);
    if (response.ok) {
      setEditingPlayer(null);
      await Promise.all([loadPlayers(), refreshCategories()]);
    }
  };

  return (
    <main className="panel">
      <div className="page-heading">
        <div>
          <span className="eyebrow">AUCTION RESULTS</span>
          <h2>Selected Players & Management</h2>
          <p>Only sold players appear here. Mark one unsold to return them to the auction.</p>
        </div>
        <Link className="back-link" to="/">Back to categories</Link>
      </div>
      {feedback ? <p className="feedback">{feedback}</p> : null}
      <label className="team-filter">
        Filter by Team
        <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
          <option value="all">All Teams</option>
          {teams.map((team) => <option value={team._id} key={team._id}>{team.name}</option>)}
          <option value="unassigned">Unassigned</option>
        </select>
      </label>
      {loading ? <p>Loading selected players...</p> : null}
      {Object.entries(groupedPlayers).map(([teamId, group]) => (
        <section className="sold-team-section" key={teamId}>
          <div className="sold-team-heading">
            {group.logo ? <img src={resolveAssetUrl(group.logo)} alt={group.label} /> : <div className="small-team-logo">{group.label.charAt(0)}</div>}
            <div><h3>{group.label}</h3><span>{group.players.length} players bought</span></div>
          </div>
          <div className="selected-players-grid">
            {group.players.map((player) => (
              <article className="result-player-card" key={player._id}>
                <img src={resolveAssetUrl(player.image || 'https://via.placeholder.com/160x160')} alt={player.name} />
                <div>
                  <span className="result-status sold">SOLD</span>
                  <h3>{player.name}</h3>
                  <p>{categoryLabels[player.category] || player.category}</p>
                  <strong>{player.team || 'No team'} · {Number(player.amount || 0).toLocaleString()} Points</strong>
                  <div className="management-actions">
                    <button type="button" onClick={() => setEditingPlayer(player)}>Edit</button>
                    <button type="button" className="ghost" onClick={() => updateStatus(player, 'unsold')}>Mark Unsold & Return</button>
                    <button type="button" className="danger-button" onClick={() => deletePlayer(player)}>Delete</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      {!loading && !players.length ? <div className="empty-state"><h3>No players yet</h3><p>Add a player to begin.</p></div> : null}

      {editingPlayer ? (
        <div className="player-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Edit ${editingPlayer.name}`}>
          <section className="panel edit-player-modal">
            <button className="modal-close" type="button" onClick={() => setEditingPlayer(null)} aria-label="Close edit form">×</button>
            <h2>Edit Player</h2>
            <form className="manual-player-form" onSubmit={savePlayerEdit}>
              <label>Name<input name="name" defaultValue={editingPlayer.name} required /></label>
              <label>Category
                <select name="category" defaultValue={editingPlayer.category}>
                  <option value="allrounder">All Rounder</option>
                  <option value="batsmen">Batsmen</option>
                  <option value="bowler">Bowler</option>
                  <option value="wicketkeeper">Wicket Keeper</option>
                  <option value="mvp">MVP Player</option>
                </select>
              </label>
              <label className="full-field">Details<textarea name="details" defaultValue={editingPlayer.details} rows="3" /></label>
              <label>Team<input name="team" defaultValue={editingPlayer.team} /></label>
              <label>Bid amount<input name="amount" type="number" min="0" defaultValue={editingPlayer.amount} /></label>
              <label className="full-field">Image URL<input name="image" type="text" defaultValue={editingPlayer.image} /></label>
              <button className="full-field" type="submit">Save Changes</button>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function CategoryAuctionPage({ categories, refreshCategories, teams, auctionStartAudio, playerSoldAudio, auctionLogo, playerLimitEnabled, maxPlayersPerTeam, fixedCategoryKey, mvpMode = false, cardSelectionEnabled = false }) {
  const routeParams = useParams();
  const categoryKey = fixedCategoryKey || routeParams.categoryKey;
  const category = categories.find((item) => item.key === categoryKey);
  const players = category?.players || [];
  const directCardMode = mvpMode || cardSelectionEnabled;
  const [highlightedNumber, setHighlightedNumber] = useState(null);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [hiddenPlayer, setHiddenPlayer] = useState(null);
  const [bidData, setBidData] = useState({ teamId: '', amount: '' });
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [soldCelebration, setSoldCelebration] = useState(null);
  const auctionAudioRef = useRef(null);
  const soldAudioRef = useRef(null);
  const soldTimerRef = useRef(null);

  const stopAudio = (audioRef) => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    audioRef.current = null;
  };

  useEffect(() => {
    setHighlightedNumber(null);
    setSelectedNumber(null);
    setCurrentPlayer(null);
    setHiddenPlayer(null);
    setFeedback('');
  }, [categoryKey]);

  useEffect(() => () => {
    stopAudio(auctionAudioRef);
    stopAudio(soldAudioRef);
    if (soldTimerRef.current) clearTimeout(soldTimerRef.current);
  }, []);

  const startNumberAuction = async () => {
    if (!players.length || loading || currentPlayer || hiddenPlayer) return;

    if (auctionStartAudio) {
      stopAudio(auctionAudioRef);
      auctionAudioRef.current = new Audio(auctionStartAudio);
      auctionAudioRef.current.loop = true;
      auctionAudioRef.current.play().catch(() => {});
    }
    setLoading(true);
    setFeedback('Choosing a player number...');
    const winningIndex = Math.floor(Math.random() * players.length);

    await new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        setHighlightedNumber(players[Math.floor(Math.random() * players.length)].auctionNumber);
        if (Date.now() - startedAt >= AUCTION_SOUND_DURATION_MS) {
          clearInterval(timer);
          resolve();
        }
      }, 120);
    });

    stopAudio(auctionAudioRef);
    const player = players[winningIndex];
    const winningNumber = player.auctionNumber;
    setHighlightedNumber(winningNumber);
    setSelectedNumber(winningNumber);
    setCurrentPlayer(player);
    setHiddenPlayer(null);
    setBidData({ teamId: player.teamId || '', amount: player.amount || '' });
    setFeedback(`Number ${winningNumber} selected — ${player.name} is live!`);
    setLoading(false);
  };

  const saveCategoryBid = async (sold) => {
    if (sold && !bidData.teamId) {
      setFeedback('Select a team before marking the player as sold.');
      return;
    }

    const response = await fetch(`${API}/auction/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: categoryKey,
        playerId: currentPlayer._id,
        amount: bidData.amount,
        teamId: bidData.teamId,
        status: sold ? 'sold' : 'unsold'
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setFeedback(data.message || 'Unable to save bid');
      return;
    }

    if (sold) {
      if (playerSoldAudio) {
        stopAudio(soldAudioRef);
        soldAudioRef.current = new Audio(playerSoldAudio);
        soldAudioRef.current.loop = true;
        soldAudioRef.current.play().catch(() => {});
      }
      const winningTeam = teams.find((team) => team._id === bidData.teamId);
      setSoldCelebration({
        playerName: currentPlayer.name,
        playerImage: currentPlayer.image,
        teamName: winningTeam?.name || '',
        teamLogo: winningTeam?.logo || '',
        amount: bidData.amount
      });
      await refreshCategories();
      soldTimerRef.current = setTimeout(() => {
        stopAudio(soldAudioRef);
        setSoldCelebration(null);
        setCurrentPlayer(null);
        setHiddenPlayer(null);
        setSelectedNumber(null);
        setHighlightedNumber(null);
        setBidData({ teamId: '', amount: '' });
        setFeedback('');
      }, SOLD_SOUND_DURATION_MS);
      return;
    }

    setFeedback(data.message);
    setCurrentPlayer(null);
    setHiddenPlayer(null);
    setSelectedNumber(null);
    setHighlightedNumber(null);
    setBidData({ teamId: '', amount: '' });
    await refreshCategories();
  };

  const closePlayerCard = () => {
    if (currentPlayer && !soldCelebration) {
      setHiddenPlayer(currentPlayer);
      setCurrentPlayer(null);
      setFeedback(`${currentPlayer.name} is still pending. Use Reshow Player to continue.`);
      return;
    }
    stopAudio(auctionAudioRef);
    stopAudio(soldAudioRef);
    if (soldTimerRef.current) clearTimeout(soldTimerRef.current);
    setCurrentPlayer(null);
    setSelectedNumber(null);
    setHighlightedNumber(null);
    setBidData({ teamId: '', amount: '' });
    setFeedback('');
  };

  const reshowPlayerCard = () => {
    if (!hiddenPlayer) return;
    setCurrentPlayer(hiddenPlayer);
    setHiddenPlayer(null);
    setFeedback(`${hiddenPlayer.name} is live for bidding.`);
  };

  const openMvpPlayer = (player) => {
    if (currentPlayer || hiddenPlayer) return;
    setCurrentPlayer(player);
    setSelectedNumber(player.auctionNumber);
    setBidData({ teamId: '', amount: player.amount || '' });
    setFeedback(`${player.name} is live for ${mvpMode ? 'MVP ' : ''}bidding.`);
  };

  if (!category && categories.length) {
    return <main className="panel"><h2>Category not found</h2><Link to="/">Back to categories</Link></main>;
  }

  return (
    <main className="category-auction-page">
      <section className="panel number-panel">
        <div className="page-heading">
          <div>
            <span className="eyebrow">CATEGORY AUCTION</span>
            <h2>{categoryLabels[categoryKey] || 'Players'}</h2>
            <p>{directCardMode ? `${players.length} players available. Select a player card to begin bidding.` : `${players.length} players available. Each number represents one player.`}</p>
          </div>
          <Link className="back-link" to="/">Back to categories</Link>
        </div>

        {directCardMode ? (
          <div className="mvp-player-grid">
            {players.map((player) => {
              const previousTeam = player.previouslyPlayedIn || player.playedIn || '';
              return (
                <button className={`mvp-player-card ${mvpMode ? 'premium' : 'standard'}`} type="button" key={player._id} onClick={() => openMvpPlayer(player)} disabled={Boolean(currentPlayer) || Boolean(hiddenPlayer)}>
                  <img src={resolveAssetUrl(player.image || 'https://via.placeholder.com/300')} alt={player.name} />
                  <div>
                    <span>{mvpMode ? '★ MVP' : categoryLabels[player.category]}</span>
                    <h3>{player.name}</h3>
                    <p>{getPlayerRoleDetails(player)}</p>
                    {previousTeam ? <div className="previously-played-badge">🏏 Previously Played In: <strong>{previousTeam}</strong></div> : null}
                    <strong>Base Price: {Number(player.amount || 0).toLocaleString()} Points</strong>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <>
            <div className="number-grid">
              {players.map((player) => {
                const number = player.auctionNumber;
                return <div className={`player-number ${highlightedNumber === number ? 'highlighted' : ''} ${selectedNumber === number ? 'winner' : ''}`} key={player._id}>{number}</div>;
              })}
            </div>
            <button className="primary start-number-button" onClick={startNumberAuction} disabled={!players.length || loading || Boolean(currentPlayer) || Boolean(hiddenPlayer)}>
              {loading ? `Selecting #${highlightedNumber || 1}...` : currentPlayer ? `Player #${selectedNumber} selected` : 'Start Auction'}
            </button>
          </>
        )}

        {!players.length ? <div className="empty-state"><h3>No players available</h3><p>Add players to begin this category.</p></div> : null}
        {hiddenPlayer ? (
          <button className="reshow-player-button" type="button" onClick={reshowPlayerCard}>
            {mvpMode ? `Reshow MVP — ${hiddenPlayer.name}` : `Reshow Player #${selectedNumber} — ${hiddenPlayer.name}`}
          </button>
        ) : null}
        {feedback ? <p className="feedback">{feedback}</p> : null}
      </section>

      {currentPlayer ? (
        <div className="player-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Selected player ${currentPlayer.name}`}>
          <section className="panel selected-player-card player-reveal">
            {auctionLogo ? <img className="auction-card-logo" src={resolveAssetUrl(auctionLogo)} alt="RMPL logo" /> : null}
            <button className="modal-close" type="button" onClick={closePlayerCard} aria-label="Close player card">×</button>
            {!mvpMode ? <div className="selected-number-badge">#{selectedNumber}</div> : null}
            <div className="player-image-wrap">
              <img src={resolveAssetUrl(currentPlayer.image || 'https://via.placeholder.com/300x300')} alt={currentPlayer.name} />
            </div>
            <div className="player-card-details">
            {mvpMode
              ? <span className="mvp-live-badge">★ MOST VALUABLE PLAYER ★</span>
              : <span className={`category-live-badge ${currentPlayer.category}`}>★ {categoryLabels[currentPlayer.category]?.toUpperCase()} ★</span>}
              <h2>{currentPlayer.name}</h2>
              <p>{getPlayerRoleDetails(currentPlayer)}</p>
              {(currentPlayer.previouslyPlayedIn || currentPlayer.playedIn) ? <div className="previously-played-badge modal-highlight">🏏 Previously Played In: <strong>{currentPlayer.previouslyPlayedIn || currentPlayer.playedIn}</strong></div> : null}
              <strong className="starting-bid">Base Price: {Number(currentPlayer.amount || 0).toLocaleString()} Points</strong>
              <div className="bid-form">
                <select value={bidData.teamId} onChange={(event) => setBidData({ ...bidData, teamId: event.target.value })}>
                  <option value="">Select team</option>
                  {teams.map((team) => {
                    const biddingClosed = playerLimitEnabled && maxPlayersPerTeam > 0 && Number(team.playerCount || 0) >= maxPlayersPerTeam;
                    return <option key={team._id} value={team._id} disabled={biddingClosed}>{team.name} — {biddingClosed ? 'BIDDING CLOSED' : `${Number(team.remainingPurse || 0).toLocaleString()} Points left`}</option>;
                  })}
                </select>
                <input type="number" value={bidData.amount} onChange={(event) => setBidData({ ...bidData, amount: event.target.value })} placeholder="Final bid amount" />
                <div className="bid-actions">
                  <button onClick={() => saveCategoryBid(true)}>Sold</button>
                  <button className="ghost" onClick={() => saveCategoryBid(false)}>Unsold</button>
                </div>
              </div>
            </div>
          </section>
          {soldCelebration ? (
            <div className={`sold-celebration ${mvpMode ? 'mvp-sold-celebration' : ''}`}>
              {soldCelebration.teamLogo ? <img className="sold-team-backdrop" src={soldCelebration.teamLogo} alt="" aria-hidden="true" /> : null}
              <div className="confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} />)}</div>
              <span className="sold-title">{mvpMode ? 'MVP SOLD!' : 'SOLD!'}</span>
              {mvpMode ? <span className="mvp-crown">♛</span> : null}
              <div className="celebration-matchup">
                <img src={resolveAssetUrl(soldCelebration.playerImage || 'https://via.placeholder.com/160')} alt={soldCelebration.playerName} />
                <span>→</span>
                {soldCelebration.teamLogo ? <img src={soldCelebration.teamLogo} alt={soldCelebration.teamName} /> : <div className="team-logo-fallback">{soldCelebration.teamName.charAt(0)}</div>}
              </div>
              <h2>{soldCelebration.playerName}</h2>
              <p>sold to</p>
              <h1>{soldCelebration.teamName}</h1>
              <strong>{Number(soldCelebration.amount || 0).toLocaleString()} Points</strong>
            </div>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

function RegistrationPage({ onRegistered, registeredCount, logo }) {
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [uploadedFiles, setUploadedFiles] = useState({ image: false, paymentReceipt: false });
  const [registrationSuccess, setRegistrationSuccess] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setFeedback('');

    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      setSubmitting(false);
      return;
    }

    if (!selectedRoles.length) {
      setFeedback('Please select at least one role for the player.');
      setSubmitting(false);
      return;
    }

    const formData = new FormData(form);
    formData.set('roles', JSON.stringify(selectedRoles));

    try {
      const response = await fetch(`${API}/players/register`, {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Entry not done. Please try again.');
      setFeedback('Registration submitted successfully. Your player will appear in the auction after approval.');
      setRegistrationSuccess({ name: formData.get('name') });
      form.reset();
      setSelectedRoles([]);
      setUploadedFiles({ image: false, paymentReceipt: false });
      if (onRegistered) onRegistered();
    } catch (error) {
      setFeedback(error.message || 'Entry not done. Backend error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRole = (role) => {
    setSelectedRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]);
  };

  return (
    <main className="panel registration-page">
      <div className="page-heading">
        <div className="registration-heading">
          {logo ? <img className="registration-logo" src={resolveAssetUrl(logo)} alt="RMPL logo" /> : null}
          <div>
            <span className="eyebrow">PLAYER REGISTRATION</span>
            <h2>Register Your Player</h2>
            <p>{registeredCount} player{registeredCount === 1 ? '' : 's'} already registered.</p>
          </div>
        </div>
        
      </div>

      <form className="registration-form" onSubmit={handleSubmit}>
        <label>Player Name*<input name="name" placeholder=" Name"required /></label>
        <label>Phone Number*<input name="phone" type="tel" placeholder=" Phone No." required /></label>
        <label>Previously Played In*<input name="playedIn" placeholder=" Team (if not played write New)" required /></label>

        <fieldset className="full-field role-fieldset">
          <legend>Select Role*</legend>
          <div className="role-options">
            {['Right Hand Batsman', 'Left Hand Batsman', 'Right arm Pace Bowler','Left arm Pace Bowler', 'Right arm Spin Bowler', 'Left arm Spin Bowler', 'Wicket Keeper', 'All Rounder'].map((role) => (
              <label key={role} className="role-chip">
                <input type="checkbox" checked={selectedRoles.includes(role)} onChange={() => toggleRole(role)} />
                <span>{role}</span>
              </label>
            ))} 
          </div>
          <small>Wicket Keeper always goes to the Wicket Keeper category, even with other roles. Batting and bowling together go to All Rounder.</small>
        </fieldset>

        <label className="registration-upload-field">
          <span>Upload Player Photo* {uploadedFiles.image ? <strong className="upload-success-tick" aria-label="Player photo selected">✓</strong> : null}</span>
          <input name="image" type="file" accept="image/*" required onChange={(event) => setUploadedFiles((current) => ({ ...current, image: Boolean(event.target.files?.length) }))} />
        </label>
        <label className="registration-upload-field">
          <span>Upload Payment Receipt* {uploadedFiles.paymentReceipt ? <strong className="upload-success-tick" aria-label="Payment receipt selected">✓</strong> : null}</span>
          <input name="paymentReceipt" type="file" accept="image/*,.pdf" required onChange={(event) => setUploadedFiles((current) => ({ ...current, paymentReceipt: Boolean(event.target.files?.length) }))} />
        </label>
        <legend>Check before submitting
          <p>Changes Not Allowed after submitting</p>
        </legend>
        <button type="submit" disabled={submitting}>{submitting ? 'Submitting...' : 'Register Player'}</button>
        {feedback ? <p className="feedback">{feedback}</p> : null}
      </form>

      {registrationSuccess ? (
        <div className="registration-success-backdrop" role="dialog" aria-modal="true" aria-labelledby="registration-success-title">
          <section className="registration-success-popup">
            {logo ? <img src={resolveAssetUrl(logo)} alt="RMPL logo" /> : null}
            <span className="registration-success-icon" aria-hidden="true">✓</span>
            <h2 id="registration-success-title">Registration Successful!</h2>
            <p><strong>{registrationSuccess.name}</strong> has been registered successfully.</p>
            <div className="registration-upload-confirmations">
              <span>✓ Player photo uploaded</span>
              <span>✓ Payment receipt uploaded</span>
            </div>
            <p className="registration-approval-note">The player will appear in the auction after approval.</p>
            <button type="button" onClick={() => setRegistrationSuccess(null)}>Register Another Player</button>
          </section>
        </div>
      ) : null}

    </main>
  );
}

function App() {
  const location = useLocation();
  const isStandaloneRegistrationRoute = location.pathname === '/register' || location.pathname === '/register-form';
  const [categories, setCategories] = useState([]);
  const [settings, setSettings] = useState({ backgroundImage: '', logo: '', auctionStartAudio: '', playerSoldAudio: '' });
  const [playerLimitEnabled, setPlayerLimitEnabled] = useState(false);
  const [auctionCardSelectionEnabled, setAuctionCardSelectionEnabled] = useState(false);
  const [teams, setTeams] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('allrounder');
  const [pendingRegistrations, setPendingRegistrations] = useState([]);
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [bidData, setBidData] = useState({ team: '', amount: '' });
  const [status, setStatus] = useState('ready');
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [excelFile, setExcelFile] = useState(null);
  const [savingPlayer, setSavingPlayer] = useState(false);
  const [excelColumns, setExcelColumns] = useState(defaultExcelColumns);
  const [showMoreNav, setShowMoreNav] = useState(false);
  const [settingsFeedback, setSettingsFeedback] = useState('');
  const [routeLoading, setRouteLoading] = useState(true);
  const backendVersionRef = useRef(null);

  const loadData = async () => {
    const [categoryResponse, settingsResponse, teamsResponse, pendingResponse] = await Promise.all([
      fetch(`${API}/categories`),
      fetch(`${API}/settings`),
      fetch(`${API}/teams`),
      fetch(`${API}/players/registrations/pending`)
    ]);

    const categoriesData = await categoryResponse.json();
    const settingsData = await settingsResponse.json();
    const teamsData = await teamsResponse.json();
    const pendingData = await pendingResponse.json();
    setCategories(categoriesData.categories || []);
    setSettings(settingsData);
    setPlayerLimitEnabled(Boolean(settingsData.playerLimitEnabled));
    setAuctionCardSelectionEnabled(Boolean(settingsData.auctionCardSelectionEnabled));
    setTeams(teamsData.teams || []);
    setPendingRegistrations(pendingData.registrations || []);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    let active = true;

    const checkForBackendChanges = async () => {
      try {
        const response = await fetch(`${API}/data-version`, { cache: 'no-store' });
        if (!response.ok) return;
        const { version } = await response.json();
        if (!active) return;

        if (backendVersionRef.current === null) {
          backendVersionRef.current = version;
        } else if (backendVersionRef.current !== version) {
          await loadData();
          backendVersionRef.current = version;
          window.dispatchEvent(new Event(LIVE_DATA_CHANGED_EVENT));
        }
      } catch {
        // Leave the current page usable while the backend is unavailable.
      }
    };

    checkForBackendChanges();
    const interval = window.setInterval(checkForBackendChanges, 2000);
    window.addEventListener('focus', checkForBackendChanges);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', checkForBackendChanges);
    };
  }, []);

  useEffect(() => {
    setRouteLoading(true);
    const loadingTimer = setTimeout(() => setRouteLoading(false), ROUTE_LOADING_DURATION_MS);
    return () => clearTimeout(loadingTimer);
  }, [location.pathname]);

  const categorySummary = useMemo(() => {
    return categories.map((item) => ({
      ...item,
      label: categoryLabels[item.key]
    }));
  }, [categories]);

  const activePlayers = categories.find((item) => item.key === selectedCategory)?.players || [];

  const selectRandomPlayer = async () => {
    setLoading(true);
    setCurrentPlayer(null);
    setStatus('selecting');
    setFeedback('');
    try {
      const [response] = await Promise.all([
        fetch(`${API}/auction/select`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: selectedCategory })
        }),
        new Promise((resolve) => setTimeout(resolve, 1400))
      ]);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setCurrentPlayer(data.player);
      setBidData({ team: data.player?.team || '', amount: data.player?.amount || '' });
      setStatus('revealed');
      setFeedback(`${data.player?.name} is now live for bidding.`);
    } catch (error) {
      setFeedback('No player available to auction in this category.');
      setStatus('ready');
    } finally {
      setLoading(false);
    }
  };

  const saveBid = async (sold = false) => {
    if (!currentPlayer) return;
    const payload = {
      category: selectedCategory,
      playerId: currentPlayer._id,
      amount: bidData.amount,
      team: bidData.team,
      status: sold ? 'sold' : 'unsold'
    };

    const response = await fetch(`${API}/auction/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    setFeedback(data.message);
    setCurrentPlayer(null);
    setBidData({ team: '', amount: '' });
    setStatus('ready');
    await loadData();
  };

  const importExcel = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setExcelFile(file);

    const formData = new FormData();
    formData.append('excelFile', file);
    Object.entries(excelColumns).forEach(([key, value]) => formData.append(key, value));

    const response = await fetch(`${API}/excel/import`, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    setFeedback(data.message || 'Excel imported');
    await loadData();
  };

  const addPlayer = async (event) => {
    event.preventDefault();
    setSavingPlayer(true);
    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const response = await fetch(`${API}/players`, {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);

      setFeedback(data.message);
      setSelectedCategory(data.player.category);
      form.reset();
      await loadData();
    } catch (error) {
      setFeedback(error.message || 'Unable to add player');
    } finally {
      setSavingPlayer(false);
    }
  };

  const approveRegistration = async (player) => {
    if (!window.confirm(`Approve ${player.name} for auction?`)) return;

    try {
      const response = await fetch(`${API}/players/${player._id}/approve`, { method: 'PATCH' });
      const data = await response.json();
      setFeedback(data.message || 'Registration approved');
      if (response.ok) await loadData();
    } catch (error) {
      setFeedback(error.message || 'Unable to approve registration');
    }
  };

  const exportExcel = async () => {
    window.open(`${API}/export/excel`, '_blank');
  };

  const downloadExcelTemplate = () => {
    window.open(`${API}/excel/template?${new URLSearchParams(excelColumns)}`, '_blank');
  };

  const updateSettings = async (event) => {
    event.preventDefault();
    setSettingsFeedback('Saving settings...');
    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch(`${API}/settings`, {
        method: 'POST',
        body: formData
      });
      const nextSettings = await response.json();
      if (!response.ok) throw new Error(nextSettings.message || 'Unable to save settings');
      setSettings(nextSettings);
      setSettingsFeedback('Settings saved successfully.');
      await loadData();
    } catch (error) {
      setSettingsFeedback(error.message || 'Settings could not be saved.');
    }
  };

  return (
    <div className="app-shell" style={{ backgroundImage: settings.backgroundImage ? `url(${resolveAssetUrl(settings.backgroundImage)})` : 'none' }}>
      {routeLoading ? (
        <div className="rmpl-loader" role="status" aria-live="polite" aria-label="Loading RMPL">
          <div className="rmpl-spinner">
            {settings.logo ? (
              <div className="rmpl-logo-3d">
                <img className="front" src={resolveAssetUrl(settings.logo)} alt="RMPL logo" />
                <img className="back" src={resolveAssetUrl(settings.logo)} alt="" aria-hidden="true" />
              </div>
            ) : <span>RMPL</span>}
          </div>
          <p>Loading auction...</p>
        </div>
      ) : null}
      {!isStandaloneRegistrationRoute ? <header className="topbar">
        <div className="brand">
          {settings.logo ? <img src={resolveAssetUrl(settings.logo)} alt="logo" className="logo" /> : null}
          <div>
            <h1>RMPL Auction</h1>
            <p>Raipur Malayalee Premier Leagure</p>
          </div>
        </div>
        <nav>
          <Link to="/">Auction</Link>
          <Link to="/purse">Purse Value</Link>
          <div className="more-nav">
            <button type="button" className={`more-nav-button ${showMoreNav ? 'active' : ''}`} onClick={() => setShowMoreNav((visible) => !visible)} aria-expanded={showMoreNav}>
              More <span>{showMoreNav ? '▲' : '▼'}</span>
            </button>
            {showMoreNav ? <div className="more-nav-menu">
              <Link to="/players" onClick={() => setShowMoreNav(false)}>Players</Link>
              <Link to="/selected" onClick={() => setShowMoreNav(false)}>Selected Players</Link>
              <Link to="/unsold" onClick={() => setShowMoreNav(false)}>Unsold Players</Link>
              <Link to="/teams" onClick={() => setShowMoreNav(false)}>Teams</Link>
              <Link to="/register" onClick={() => setShowMoreNav(false)}>Register Player</Link>
              <Link to="/approvals" onClick={() => setShowMoreNav(false)}>Approvals</Link>
              <Link to="/excel" onClick={() => setShowMoreNav(false)}>Excel</Link>
              <Link to="/video" onClick={() => setShowMoreNav(false)}>Welcome Video</Link>
              <Link to="/testimonials" onClick={() => setShowMoreNav(false)}>Previous Events</Link>
              <Link to="/settings" onClick={() => setShowMoreNav(false)}>Settings</Link>
            </div> : null}
          </div>
        </nav>
      </header> : null}

      <Routes>
        <Route path="/" element={
          <main className="main-grid">
            <section className="categories-panel">
              <h2>Categories</h2>
              <div className="category-cards">
                {categorySummary.map((item) => (
                  <Link key={item.key} to={item.key === 'mvp' ? '/mvp' : `/category/${item.key}`} className={`cat-card ${item.key === 'mvp' ? 'mvp-category-card' : ''}`} onClick={() => setSelectedCategory(item.key)}>
                    <div className="category-image-wrap">
                      {settings.categoryImages?.[item.key] || item.players?.[0]?.image
                        ? <img src={resolveAssetUrl(settings.categoryImages?.[item.key] || item.players[0].image)} alt={`${item.label} category`} />
                        : <div className="category-image-placeholder">{item.label.charAt(0)}</div>}
                    </div>
                    <div className="category-card-content">
                      <span>{item.label}</span>
                      <strong className="category-count">{item.count}</strong>
                      <small>players available</small>
                    </div>
                  </Link>
                ))}
              </div>

              <div className="action-row">
                <button className="ghost" onClick={exportExcel}>Export Excel</button>
              </div>

              {feedback ? <p className="feedback">{feedback}</p> : null}

            </section>

          </main>
        } />

        <Route path="/register" element={<RegistrationPage onRegistered={loadData} logo={settings.logo} registeredCount={pendingRegistrations.length + categories.reduce((count, category) => count + (category.players?.filter((player) => player.source === 'registration').length || 0), 0)} />} />
        <Route path="/register-form" element={<RegistrationPage onRegistered={loadData} logo={settings.logo} registeredCount={pendingRegistrations.length + categories.reduce((count, category) => count + (category.players?.filter((player) => player.source === 'registration').length || 0), 0)} />} />
        <Route path="/approvals" element={<main className="panel approvals-page"><div className="page-heading"><div><span className="eyebrow">APPROVAL PANEL</span><h2>Pending registrations</h2><p>Review player signups and approve them for auction.</p></div><Link className="back-link" to="/">Back to auction</Link></div><section className="pending-registrations-panel"><div className="pending-registrations-header"><div><span className="eyebrow">PENDING</span><h3>Player approvals</h3></div><span className="pending-count-badge">{pendingRegistrations.length}</span></div>{pendingRegistrations.length ? <div className="pending-registrations-list">{pendingRegistrations.map((player) => <article className="pending-registration-card" key={player._id}><div className="pending-registration-main"><h4>{player.name}</h4><p><strong>Phone:</strong> {player.phone || '—'}</p>{player.registrationRoles?.length ? <p><strong>Roles:</strong> {player.registrationRoles.join(', ')}</p> : null}{player.previouslyPlayedIn || player.playedIn ? <p><strong>Previously played:</strong> {player.previouslyPlayedIn || player.playedIn}</p> : null}{player.details ? <p>{player.details}</p> : null}{player.paymentReceipt ? <p><a href={resolveAssetUrl(player.paymentReceipt)} target="_blank" rel="noreferrer">View payment receipt</a></p> : null}</div><button type="button" onClick={() => approveRegistration(player)}>Approve</button></article>)}</div> : <p className="pending-empty">No pending registrations right now.</p>}</section>{feedback ? <p className="feedback">{feedback}</p> : null}</main>} />
        <Route path="/category/:categoryKey" element={<CategoryAuctionPage categories={categories} refreshCategories={loadData} teams={teams} auctionStartAudio={settings.auctionStartAudio} playerSoldAudio={settings.playerSoldAudio} auctionLogo={settings.logo} playerLimitEnabled={settings.playerLimitEnabled} maxPlayersPerTeam={Number(settings.maxPlayersPerTeam || 0)} cardSelectionEnabled={settings.auctionCardSelectionEnabled} />} />
        <Route path="/mvp" element={<CategoryAuctionPage categories={categories} refreshCategories={loadData} teams={teams} auctionStartAudio={settings.auctionStartAudio} playerSoldAudio={settings.playerSoldAudio} auctionLogo={settings.logo} playerLimitEnabled={settings.playerLimitEnabled} maxPlayersPerTeam={Number(settings.maxPlayersPerTeam || 0)} fixedCategoryKey="mvp" mvpMode />} />
        <Route path="/selected" element={<SelectedPlayersPage refreshCategories={loadData} teams={teams} />} />
        <Route path="/unsold" element={<UnsoldPlayersPage teams={teams} refreshData={loadData} settings={settings} />} />
        <Route path="/teams" element={<TeamsPage teams={teams} refreshData={loadData} />} />
        <Route path="/teams/:teamId" element={<TeamPlayersPage teams={teams} />} />
        <Route path="/purse" element={<PurseValuePage teams={teams} />} />

        <Route path="/players" element={<PlayersPage refreshData={loadData} />} />
        <Route path="/video" element={<WelcomeVideoPage settings={settings} refreshData={loadData} />} />
        <Route path="/testimonials" element={<TestimonialsPage />} />

        <Route path="/settings" element={
          <main className="panel settings-page">
            <div className="page-heading">
              <div><span className="eyebrow">SYSTEM CONFIGURATION</span><h2>Settings</h2><p>Manage dashboard branding, sounds, and category artwork.</p></div>
              <Link className="back-link" to="/">Back to auction</Link>
            </div>
            <form className="settings-form" onSubmit={updateSettings}>
              <section className="settings-section">
                <div className="settings-section-heading"><span>01</span><div><h3>Branding</h3><p>Images used across the complete auction dashboard.</p></div></div>
                <div className="settings-fields-grid">
                  <label>Background Image<input type="file" name="backgroundImage" accept="image/*" /></label>
                  <label>Dashboard Logo{settings.logo ? <img className="settings-logo-preview" src={resolveAssetUrl(settings.logo)} alt="Current dashboard logo" /> : null}<input type="file" name="logo" accept="image/*" /></label>
                </div>
              </section>
              <section className="settings-section">
                <div className="settings-section-heading"><span>02</span><div><h3>Auction Sounds</h3><p>Preview and replace sounds used during auction events.</p></div></div>
                <div className="settings-fields-grid">
                  <label>Auction Start Sound<input type="file" name="auctionStartAudio" accept="audio/*" />{settings.auctionStartAudio ? <audio className="audio-preview" src={resolveAssetUrl(settings.auctionStartAudio)} controls /> : null}</label>
                  <label>Player Sold Sound<input type="file" name="playerSoldAudio" accept="audio/*" />{settings.playerSoldAudio ? <audio className="audio-preview" src={resolveAssetUrl(settings.playerSoldAudio)} controls /> : null}</label>
                </div>
              </section>
              <section className="settings-section">
                <div className="settings-section-heading"><span>03</span><div><h3>Category Images</h3><p>Upload separate artwork for each category card.</p></div></div>
                <div className="category-settings-grid">
                  {Object.entries(categoryLabels).map(([key, label]) => <label className="category-image-setting" key={key}>{label}{settings.categoryImages?.[key] ? <img src={resolveAssetUrl(settings.categoryImages[key])} alt={`${label} category`} /> : null}<input type="file" name={`categoryImage_${key}`} accept="image/*" /></label>)}
                </div>
              </section>
              <section className="settings-section">
                <div className="settings-section-heading"><span>04</span><div><h3>Players Per Team</h3><p>Automatically close bidding for teams whose squad reaches the selected size.</p></div></div>
                <div className="player-limit-setting">
                  <label className="settings-toggle">
                    <input type="checkbox" name="playerLimitEnabled" checked={playerLimitEnabled} onChange={(event) => setPlayerLimitEnabled(event.target.checked)} />
                    <span className="toggle-track"><i /></span>
                    <strong>{playerLimitEnabled ? 'Player limit enabled' : 'Player limit disabled'}</strong>
                  </label>
                  <label className="limit-number-field">Maximum Players Per Team<input type="number" name="maxPlayersPerTeam" min="1" max="100" defaultValue={settings.maxPlayersPerTeam || 15} disabled={!playerLimitEnabled} required={playerLimitEnabled} /></label>
                  <p>{playerLimitEnabled ? 'Teams at the limit cannot bid for another player.' : 'There is currently no squad-size restriction.'}</p>
                </div>
              </section>
              <section className="settings-section">
                <div className="settings-section-heading"><span>05</span><div><h3>Auction Selection Mode</h3><p>Choose between clickable player cards and random numbered selection.</p></div></div>
                <div className="player-limit-setting">
                  <label className="settings-toggle">
                    <input type="checkbox" name="auctionCardSelectionEnabled" checked={auctionCardSelectionEnabled} onChange={(event) => setAuctionCardSelectionEnabled(event.target.checked)} />
                    <span className="toggle-track"><i /></span>
                    <strong>{auctionCardSelectionEnabled ? 'Player card selection enabled' : 'Numbered random auction enabled'}</strong>
                  </label>
                  <p>{auctionCardSelectionEnabled ? 'Click a visible player card to begin bidding.' : 'Use Start Auction to randomly select a permanent player number.'}</p>
                </div>
              </section>
              <div className="settings-save-bar"><span>Changes apply after saving.</span><button type="submit">Save All Settings</button></div>
            </form>
            {settingsFeedback ? <p className={`settings-feedback ${settingsFeedback.includes('successfully') ? 'success' : settingsFeedback.includes('Saving') ? 'saving' : ''}`} role="status">{settingsFeedback}</p> : null}
          </main>
        } />

        <Route path="/excel" element={
          <main className="panel">
            <h2>Excel Import / Export</h2>
            <p>Choose your Excel column names, download the matching template, and import it here.</p>
            <div className="excel-column-grid">
              {Object.entries(excelColumns).map(([key, value]) => (
                <label key={key}>
                  {key.replace('Column', '').replace(/^\w/, (letter) => letter.toUpperCase())} column
                  <input
                    value={value}
                    onChange={(event) => setExcelColumns({ ...excelColumns, [key]: event.target.value })}
                    required
                  />
                </label>
              ))}
            </div>
            <div className="action-row">
              <button type="button" onClick={downloadExcelTemplate}>Download Import Template</button>
              <button type="button" className="ghost" onClick={() => setExcelColumns(defaultExcelColumns)}>Reset Column Names</button>
            </div>
            <label className="upload-box">
              <span>{excelFile ? excelFile.name : 'Choose Excel file to import players'}</span>
              <input type="file" accept=".xlsx,.xls" onChange={importExcel} />
            </label>
            <div className="excel-preview">
              <p>Imported file: {excelFile ? excelFile.name : 'None selected'}</p>
              <button onClick={exportExcel}>Export Team-wise Excel</button>
            </div>
          </main>
        } />
      </Routes>
    </div>
  );
}

export default App;
