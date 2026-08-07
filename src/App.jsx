import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import {
  MatchDetailsPage,
  MatchesPage,
  RegistrationLiveMatches,
  ScorerDashboardPage,
  ScorerMatchPage,
  clearScorerSessionToken
} from './Scoring';

const API_ORIGIN = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const API = `${API_ORIGIN}/api`;
const AUCTION_SOUND_DURATION_MS = 5000;
const SOLD_SOUND_DURATION_MS = 5000;
const LIVE_DATA_POLL_INTERVAL_MS = 2000;
const LIVE_DATA_FALLBACK_DELAY_MS = 3000;
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

const formatRegistrationDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
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
    const matchesSearch = [player.auctionNumber, player.name, player.age, player.category, player.playedIn, player.team, player.details, player.sold ? 'sold' : player.unsold ? 'unsold' : 'available'].join(' ').toLowerCase().includes(query.toLowerCase());
    return matchesCategory && matchesSearch;
  });
  return <main className="panel">
    <div className="page-heading"><div><span className="eyebrow">PLAYER DATABASE</span><h2>Players</h2></div><div className="page-heading-actions"><button onClick={() => { setEditing(null); setPlayerImagePreview(''); setShowForm(!showForm); }}>{showForm ? 'Close Form' : 'Add Player'}</button><Link className="back-link" to="/">Back</Link></div></div>
    {showForm || editing ? <form className="manual-player-form player-editor form-reveal" onSubmit={save} key={editing?._id || 'new'}>
      <div className="full-field player-form-image-preview">{playerImagePreview ? <img src={resolveAssetUrl(playerImagePreview)} alt="Player preview" /> : <div><span>Image Preview</span><small>Upload an image or enter an image URL</small></div>}</div>
      <label>Name<input name="name" defaultValue={editing?.name || ''} required /></label>
      <label>Age<input name="age" type="number" inputMode="numeric" min="1" step="1" defaultValue={editing?.age || ''} /></label>
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
    <div className="all-players-grid">{filtered.map((player) => <article className="database-player-card" key={player._id}><img src={resolveAssetUrl(player.image || 'https://via.placeholder.com/240')} alt={player.name} /><div className="database-player-details"><span className={`result-status ${player.sold ? 'sold' : player.unsold ? 'unsold' : 'available'}`}>{player.sold ? 'SOLD' : player.unsold ? 'UNSOLD' : 'AVAILABLE'}</span><h3>#{player.auctionNumber} · {player.name}</h3><p>{categoryLabels[player.category]}</p><p><strong>Age:</strong> {player.age || '—'}</p><p><strong>Played In:</strong> {player.playedIn || (!player.sold ? player.team : '') || '—'}</p><p>{player.details}</p><strong>{Number(player.amount || 0).toLocaleString()} Points</strong><div className="management-actions"><button onClick={() => { setEditing(player); setShowForm(true); window.scrollTo(0, 0); }}>Edit</button><button className="danger-button" onClick={() => remove(player)}>Delete</button></div></div></article>)}</div>
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
        {item.winnerName || item.winnerImage ? <div className="previous-winner">{item.winnerImage ? <img src={resolveAssetUrl(item.winnerImage)} alt={item.winnerName} /> : null}<div><small>PREVIOUS WINNER</small><strong>{item.winnerName || 'Winner'}</strong></div></div> : null}
        <button className="danger-button" onClick={() => removeItem(item)}>Delete</button>
      </div>
    </article>)}</div>
  </main>;
}

function TeamPlayersPage({ teams }) {
  const { teamId } = useParams();
  const team = teams.find((item) => item._id === teamId);
  if (!team) return <main className="panel">Loading team...</main>;
  return <main className="panel"><div className="page-heading"><div className="team-detail-title">{team.logo ? <img src={resolveAssetUrl(team.logo)} alt={team.name} /> : null}<div><span className="eyebrow">TEAM SQUAD</span><h2>{team.name}</h2><p>{team.playerCount} players</p></div></div><Link to="/teams" className="back-link">Back</Link></div><div className="team-detail-stats"><span>Opening <strong>{Number(team.purse).toLocaleString()} Points</strong></span><span>Spent <strong>{Number(team.spent).toLocaleString()} Points</strong></span><span>Remaining <strong>{Number(team.remainingPurse).toLocaleString()} Points</strong></span></div><div className="team-squad-grid">{(team.players || []).map((player) => <article className="squad-player-card" key={player._id}><img src={resolveAssetUrl(player.image)} alt={player.name} /><div><span></span><h3>{player.name}</h3><p>{categoryLabels[player.category]}</p><p><strong>Age:</strong> {player.age || '—'}</p><strong>{Number(player.amount).toLocaleString()} Points</strong></div></article>)}</div></main>;
}

function MatchRecordsPage() {
  const [matches, setMatches] = useState([]);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState('');
  const [downloadingId, setDownloadingId] = useState('');
  const [feedback, setFeedback] = useState('');

  const loadMatches = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API}/matches?limit=100`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to load saved matches.');
      setMatches(data.matches || []);
      setFeedback('');
    } catch (error) {
      setFeedback(error.message || 'Unable to load saved matches.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadMatches(); }, []);
  useLiveDataRefresh(loadMatches);

  const downloadMatchExcel = async (match) => {
    const matchId = match._id || match.id;
    setDownloadingId(matchId);
    setFeedback('');
    try {
      const response = await fetch(`${API}/matches/${matchId}/excel`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Unable to download match Excel.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'match-record.xlsx';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setFeedback(error.message || 'Unable to download match Excel.');
    } finally {
      setDownloadingId('');
    }
  };

  const deleteMatch = async (match) => {
    if (!password) {
      setFeedback('Enter the scorer password before deleting a match record.');
      return;
    }
    const label = match.title || `${match.teamA?.name || 'Team A'} vs ${match.teamB?.name || 'Team B'}`;
    if (!window.confirm(`Delete "${label}" permanently? All innings, scores, and ball history for this match will be removed.`)) return;
    setDeletingId(match._id || match.id);
    setFeedback('');
    try {
      const response = await fetch(`${API}/matches/${match._id || match.id}`, {
        method: 'DELETE',
        headers: { 'x-scorer-pin': password }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to delete match record.');
      setMatches((current) => current.filter((item) => (item._id || item.id) !== (match._id || match.id)));
      setPassword('');
      setFeedback(data.message || 'Match record deleted permanently.');
      window.dispatchEvent(new CustomEvent(LIVE_DATA_CHANGED_EVENT, { detail: { path: `/api/matches/${match._id || match.id}` } }));
    } catch (error) {
      setFeedback(error.message || 'Unable to delete match record.');
    } finally {
      setDeletingId('');
    }
  };

  return (
    <main className="panel match-records-page">
      <div className="page-heading">
        <div><span className="eyebrow">SAVED SCORING DATA</span><h2>Match Records</h2><p>Every scorer match is saved in the database and appears here and in the scorer console.</p></div>
        <Link className="back-link" to="/auction">Back to auction</Link>
      </div>
      <section className="match-record-auth">
        <label>Scorer password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Required only for deletion" />
        </label>
        <Link to="/scorer">Open scorer console</Link>
      </section>
      {feedback ? <p className="feedback" role="status">{feedback}</p> : null}
      {loading ? <p>Loading saved match records...</p> : null}
      {!loading && !matches.length ? <p className="empty-state">No saved match records.</p> : null}
      <div className="match-record-list">
        {matches.map((match) => {
          const matchId = match._id || match.id;
          const teamA = match.teamA?.name || 'Team A';
          const teamB = match.teamB?.name || 'Team B';
          const inningsScores = match.inningsSummaries || [];
          const manOfMatch = match.awards?.manOfMatch || match.awards?.manOfTheMatch;
          return <article key={matchId} className="match-record-row">
            <div>
              <h3>{match.title || `${teamA} vs ${teamB}`}</h3>
              <p>{teamA} vs {teamB} · {match.oversPerInnings || '—'} overs</p>
              <small>{match.scheduledAt ? new Date(match.scheduledAt).toLocaleString() : 'Schedule not set'}</small>
              {match.result?.text ? <p className="match-record-result"><strong>Result:</strong> {match.result.text}</p> : null}
              {inningsScores.length ? <div className="match-record-innings">
                {inningsScores.map((innings, index) => <span key={innings.number || index}>
                  <strong>{innings.battingTeam?.name || `Innings ${index + 1}`}</strong>
                  <b>{Number(innings.totalRuns || 0)}/{Number(innings.wickets || 0)}</b>
                  <small>({innings.overs || '0.0'} ov)</small>
                </span>)}
              </div> : null}
              {manOfMatch ? <p className="match-record-award"><strong>Man of the Match:</strong> {manOfMatch.name || manOfMatch.player?.name || 'Not selected'}</p> : null}
            </div>
            <div className="match-record-actions">
              <Link to={`/scorer/${matchId}`}>View in scorer</Link>
              <button type="button" disabled={downloadingId === matchId} onClick={() => downloadMatchExcel(match)}>
                {downloadingId === matchId ? 'Downloading...' : 'Download Excel'}
              </button>
              <button className="danger-button" type="button" disabled={deletingId === matchId} onClick={() => deleteMatch(match)}>
                {deletingId === matchId ? 'Deleting...' : 'Delete record'}
              </button>
            </div>
          </article>;
        })}
      </div>
    </main>
  );
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
  return <main className="panel"><div className="page-heading"><div><span className="eyebrow">AUCTION HOLDING AREA</span><h2>Unsold Players</h2></div><Link className="back-link" to="/">Back</Link></div><div className="all-players-grid">{players.map((player) => <article className="database-player-card" key={player._id}><img src={resolveAssetUrl(player.image)} alt={player.name} /><div><span className="result-status unsold">UNSOLD</span><h3>#{player.auctionNumber} · {player.name}</h3><p><strong>Age:</strong> {player.age || '—'}</p><p><strong>Base Price:</strong> {Number(player.amount || 0).toLocaleString()} Points</p><div className="management-actions"><button onClick={() => { setSelling(player); setSale({ teamId: '', amount: player.amount || '' }); }}>Sell Player</button><button className="ghost" onClick={() => restore(player)}>Return to Auction</button></div></div></article>)}</div>
    {selling ? <div className="player-modal-backdrop">{settings.logo ? <img className="player-modal-logo" src={settings.logo} alt="" /> : null}<form className="panel selected-player-card player-reveal" onSubmit={sell}><button className="modal-close" type="button" onClick={() => setSelling(null)}>×</button><div className="selected-number-badge">#{selling.auctionNumber}</div><div className="player-image-wrap"><img src={selling.image} alt={selling.name} /></div><div className="player-card-details"><span className="unsold-live-badge">UNSOLD PLAYER</span><h2>{selling.name}</h2><p><strong>Age:</strong> {selling.age || '—'}</p><p>{selling.details}</p><strong className="starting-bid">Base Price: {Number(selling.amount || 0).toLocaleString()} Points</strong><div className="bid-form"><select required value={sale.teamId} onChange={(event) => setSale({ ...sale, teamId: event.target.value })}><option value="">Select team</option>{teams.map((team) => <option value={team._id} key={team._id}>{team.name} — {Number(team.remainingPurse).toLocaleString()} Points</option>)}</select><input required type="number" value={sale.amount} onChange={(event) => setSale({ ...sale, amount: event.target.value })} /><button>Confirm Sold</button></div></div></form></div> : null}
    {celebration ? <div className="player-modal-backdrop"><div className="sold-celebration">{celebration.team?.logo ? <img className="sold-team-backdrop" src={resolveAssetUrl(celebration.team.logo)} alt="" /> : null}<span className="sold-title">SOLD!</span><h2>{celebration.player.name}</h2><p>sold to</p><h1>{celebration.team?.name}</h1><strong>{Number(celebration.amount).toLocaleString()} Points</strong></div></div> : null}
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
                  <p><strong>Age:</strong> {player.age || '—'}</p>
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
              <label>Age<input name="age" type="number" inputMode="numeric" min="1" step="1" defaultValue={editingPlayer.age || ''} /></label>
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
  const minimumAvailableBasePrice = useMemo(() => {
    const prices = categories.flatMap((item) => item.players || [])
      .filter((player) => player._id !== currentPlayer?._id)
      .map((player) => Number(player.amount || 0))
      .filter((amount) => amount > 0);
    return prices.length ? Math.min(...prices) : 0;
  }, [categories, currentPlayer?._id]);
  const teamBidDetails = useMemo(() => teams.map((team) => {
    const purse = Number(team.purse || 0);
    const spent = Number(team.spent || 0);
    const remaining = Number(team.remainingPurse || 0);
    const bought = Number(team.playerCount || 0);
    const slotsLeft = playerLimitEnabled && maxPlayersPerTeam > 0 ? Math.max(0, maxPlayersPerTeam - bought) : null;
    const reserve = slotsLeft === null ? 0 : Math.max(0, slotsLeft - 1) * minimumAvailableBasePrice;
    return { ...team, purse, spent, remaining, bought, slotsLeft, maxBid: Math.max(0, remaining - reserve), spentPercent: purse > 0 ? Math.min(100, (spent / purse) * 100) : 0 };
  }), [teams, playerLimitEnabled, maxPlayersPerTeam, minimumAvailableBasePrice]);
  const selectedTeamBid = teamBidDetails.find((team) => team._id === bidData.teamId);

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
    if (sold && selectedTeamBid && Number(bidData.amount || 0) > selectedTeamBid.maxBid) {
      setFeedback(`Maximum safe bid for ${selectedTeamBid.name} is ${selectedTeamBid.maxBid.toLocaleString()} Points.`);
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
                  <img src={resolveAssetUrl(player.image || 'https://via.placeholder.com/300')} alt={player.name} loading="lazy" decoding="async" />
                  <div>
                    <span>{mvpMode ? '★ MVP' : categoryLabels[player.category]}</span>
                    <h3>{player.name}</h3>
                    <p><strong>Age:</strong> {player.age || '—'}</p>
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
          <section className="panel selected-player-card player-reveal with-team-finances">
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
              <p><strong>Age:</strong> {currentPlayer.age || '—'}</p>
              <p>{getPlayerRoleDetails(currentPlayer)}</p>
              {(currentPlayer.previouslyPlayedIn || currentPlayer.playedIn) ? <div className="previously-played-badge modal-highlight">🏏 Previously Played In: <strong>{currentPlayer.previouslyPlayedIn || currentPlayer.playedIn}</strong></div> : null}
              <strong className="starting-bid">Base Price: {Number(currentPlayer.amount || 0).toLocaleString()} Points</strong>
              <div className="bid-form">
                <select value={bidData.teamId} onChange={(event) => setBidData({ ...bidData, teamId: event.target.value })}>
                  <option value="">Select team</option>
                  {teamBidDetails.map((team) => {
                    const biddingClosed = team.slotsLeft === 0;
                    return <option key={team._id} value={team._id} disabled={biddingClosed}>{team.name} — {biddingClosed ? 'BIDDING CLOSED' : `${team.remaining.toLocaleString()} Points left`}</option>;
                  })}
                </select>
                <input type="number" min="0" max={selectedTeamBid?.maxBid} value={bidData.amount} onChange={(event) => setBidData({ ...bidData, amount: event.target.value })} placeholder="Final bid amount" />
                {selectedTeamBid ? <p className="bid-limit-note">Safe bid limit: <strong>{selectedTeamBid.maxBid.toLocaleString()} Points</strong>{selectedTeamBid.slotsLeft !== null ? ` · ${selectedTeamBid.slotsLeft} squad slots left` : ''}</p> : null}
                <div className="bid-actions">
                  <button onClick={() => saveCategoryBid(true)}>Sold</button>
                  <button className="ghost" onClick={() => saveCategoryBid(false)}>Unsold</button>
                </div>
              </div>
            </div>
            <aside className="auction-team-finances" aria-label="Team purse balances">
              <div className="auction-team-finances-heading"><strong>Team balances</strong><span>Live purse & expenses</span></div>
              {teamBidDetails.map((team) => (
                <button type="button" className={`auction-team-balance ${bidData.teamId === team._id ? 'selected' : ''}`} key={team._id} onClick={() => team.slotsLeft !== 0 && setBidData({ ...bidData, teamId: team._id })} disabled={team.slotsLeft === 0}>
                  <div className="auction-team-row">
                    {team.logo ? <img src={resolveAssetUrl(team.logo)} alt="" /> : <span className="small-team-logo">{team.name.charAt(0)}</span>}
                    <span><strong>{team.name}</strong><small>{team.bought} bought{team.slotsLeft !== null ? ` · ${team.slotsLeft} left` : ''}</small></span>
                    <strong>{team.remaining.toLocaleString()}</strong>
                  </div>
                  <div className="auction-expense-track"><i style={{ width: `${team.spentPercent}%` }} /></div>
                  <div className="auction-team-meta"><span>Spent {team.spent.toLocaleString()}</span><span>Limit {team.maxBid.toLocaleString()}</span></div>
                </button>
              ))}
            </aside>
          </section>
          {soldCelebration ? (
            <div className={`sold-celebration ${mvpMode ? 'mvp-sold-celebration' : ''}`}>
              {soldCelebration.teamLogo ? <img className="sold-team-backdrop" src={resolveAssetUrl(soldCelebration.teamLogo)} alt="" aria-hidden="true" /> : null}
              <div className="confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} />)}</div>
              <span className="sold-title">{mvpMode ? 'MVP SOLD!' : 'SOLD!'}</span>
              {mvpMode ? <span className="mvp-crown">♛</span> : null}
              <div className="celebration-matchup">
                <img src={resolveAssetUrl(soldCelebration.playerImage || 'https://via.placeholder.com/160')} alt={soldCelebration.playerName} />
                <span>→</span>
                {soldCelebration.teamLogo ? <img src={resolveAssetUrl(soldCelebration.teamLogo)} alt={soldCelebration.teamName} /> : <div className="team-logo-fallback">{soldCelebration.teamName.charAt(0)}</div>}
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
  const formRef = useRef(null);
  const submissionLockRef = useRef(false);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [uploadedFiles, setUploadedFiles] = useState({ image: false, paymentReceipt: false });
  const [registrationSuccess, setRegistrationSuccess] = useState(null);

  const closeRegistrationSuccess = () => {
    setRegistrationSuccess(null);
    setFeedback('');
    formRef.current?.reset();
    setSelectedRoles([]);
    setUploadedFiles({ image: false, paymentReceipt: false });
    window.requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      formRef.current?.querySelector('input[name="name"]')?.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    if (!registrationSuccess) return undefined;
    const timeout = window.setTimeout(closeRegistrationSuccess, 5000);
    return () => window.clearTimeout(timeout);
  }, [registrationSuccess]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submissionLockRef.current) return;
    submissionLockRef.current = true;
    setSubmitting(true);
    setUploadProgress(0);
    setFeedback('');

    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      setSubmitting(false);
      submissionLockRef.current = false;
      return;
    }

    if (!selectedRoles.length) {
      setFeedback('Please select at least one role for the player.');
      setSubmitting(false);
      submissionLockRef.current = false;
      return;
    }

    const formData = new FormData(form);
    formData.set('roles', JSON.stringify(selectedRoles));

    try {
      const data = await new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('POST', `${API}/players/register`);
        request.responseType = 'json';
        request.timeout = 180000;
        request.upload.addEventListener('progress', (progressEvent) => {
          if (!progressEvent.lengthComputable) return;
          setUploadProgress(Math.min(100, Math.round((progressEvent.loaded / progressEvent.total) * 100)));
        });
        request.addEventListener('load', () => {
          const responseData = request.response || {};
          if (request.status >= 200 && request.status < 300) resolve(responseData);
          else reject(new Error(responseData.message || 'Entry not done. Please try again.'));
        });
        request.addEventListener('error', () => reject(new Error('Upload failed. Check your internet connection and try again.')));
        request.addEventListener('timeout', () => reject(new Error('Upload timed out. Please try again with a stable connection.')));
        request.addEventListener('abort', () => reject(new Error('Upload was cancelled.')));
        request.send(formData);
      });
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
      setUploadProgress(0);
      submissionLockRef.current = false;
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

      <RegistrationLiveMatches />

      <form ref={formRef} className="registration-form" onSubmit={handleSubmit} aria-busy={submitting}>
        <label>Player Name*<input name="name" placeholder=" Name"required /></label>
        <label>Age*<input name="age" type="number" inputMode="numeric" min="1" step="1" placeholder=" Age" required /></label>
        <label>Phone Number*<input name="phone" type="tel" placeholder=" Phone No." required /></label>
        <label>Previously Played In*<input name="playedIn" placeholder=" Team (if not played write New)" required /></label>
        <label>T-Shirt Size*
          <input name="tshirtSize" type="number" inputMode="numeric" min="1" step="1" placeholder=" Size (e.g. 40)" required />
        </label>

        <fieldset className="full-field role-fieldset">
          <legend>Select Role*</legend>
          <div className="role-options">
            {['Wicket Keeper','Right Hand Batsman', 'Left Hand Batsman', 'Right arm Pace Bowler','Left arm Pace Bowler', 'Right arm Spin Bowler', 'Left arm Spin Bowler',  'All Rounder'].map((role) => (
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
        <button type="submit" disabled={submitting}>
          {submitting ? (uploadProgress < 100 ? `Uploading… ${uploadProgress}%` : 'Processing…') : 'Register Player'}
        </button>
        {submitting ? (
          <div className="registration-upload-progress full-field" role="progressbar" aria-label="Registration upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={uploadProgress}>
            <span style={{ width: `${uploadProgress}%` }} />
            <strong>{uploadProgress < 100 ? `${uploadProgress}% uploaded` : 'Upload complete — saving registration'}</strong>
          </div>
        ) : null}
        {feedback ? <p className="feedback">{feedback}</p> : null}
        <footer className="register-footer">Raipur Malayalee Premier League <p>Designed by KVM</p></footer>
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
            <button type="button" onClick={closeRegistrationSuccess}>Register Another Player</button>
          </section>
        </div>
      ) : null}

    </main>
  );
}

function RegistrationDataPage() {
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState(null);

  const loadRegistrations = async () => {
    try {
      const response = await fetch(`${API}/players/registrations`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to load registration data');
      setRegistrations(data.registrations || []);
      setFeedback('');
    } catch (error) {
      setFeedback(error.message || 'Unable to load registration data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRegistrations();
  }, []);
  useLiveDataRefresh(loadRegistrations);

  useEffect(() => {
    if (!preview) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [preview]);

  const filteredRegistrations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return registrations;
    return registrations.filter((player) => [
      player.name,
      player.age,
      player.phone,
      player.tshirtSize,
      player.registrationStatus,
      player.previouslyPlayedIn,
      player.playedIn,
      ...(player.registrationRoles || [])
    ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery)));
  }, [query, registrations]);

  return (
    <main className="panel registration-data-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">REGISTRATION RECORDS</span>
          <h2>Player Registration Data</h2>
          <p>View submitted player photos, details, and payment receipts.</p>
        </div>
        <Link className="back-link" to="/">Back to auction</Link>
      </div>
      <div className="registration-data-summary">
        <strong>{registrations.length}</strong>
        <span>Total registrations</span>
      </div>
      <label className="registration-data-search">
        <span>Search</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, phone, role, team, or status" />
        {query ? <button type="button" onClick={() => setQuery('')}>Clear</button> : null}
      </label>
      {feedback ? <p className="feedback">{feedback}</p> : null}
      {loading ? <p className="empty-state">Loading registration data…</p> : filteredRegistrations.length ? (
        <div className="registration-data-grid">
          {filteredRegistrations.map((player) => {
            const playerImageUrl = resolveAssetUrl(player.image);
            const receiptUrl = resolveAssetUrl(player.paymentReceipt);
            const receiptIsPdf = /\.pdf(?:$|\?)/i.test(receiptUrl);
            return (
              <article className="registration-data-card" key={player._id}>
                <div className="registration-data-card-heading">
                  <div className="registered-player-placeholder">{player.name?.charAt(0) || '?'}</div>
                  <div>
                    <h3>{player.name}</h3>
                    <small>{formatRegistrationDate(player.createdAt)}</small>
                  </div>
                  <span className={`registration-data-status ${player.registrationStatus === 'approved' ? 'approved' : 'pending'}`}>
                    {player.registrationStatus === 'approved' ? 'APPROVED' : 'PENDING'}
                  </span>
                </div>
                <div className="registration-data-details">
                  <p><strong>Age:</strong> {player.age || '—'}</p>
                  <p><strong>Phone:</strong> {player.phone || '—'}</p>
                  <p><strong>T-Shirt size:</strong> {player.tshirtSize || '—'}</p>
                  <p><strong>Previously played:</strong> {player.previouslyPlayedIn || player.playedIn || 'New player'}</p>
                  {player.registrationRoles?.length ? <p><strong>Roles:</strong> {player.registrationRoles.join(', ')}</p> : null}
                </div>
                <div className="registration-data-actions">
                  <button type="button" disabled={!playerImageUrl} onClick={() => setPreview({ url: playerImageUrl, title: `${player.name} — Player Photo`, isPdf: false })}>View Player Photo</button>
                  <button type="button" disabled={!receiptUrl} onClick={() => setPreview({ url: receiptUrl, title: `${player.name} — Payment Receipt`, isPdf: receiptIsPdf })}>View Receipt</button>
                </div>
              </article>
            );
          })}
        </div>
      ) : <p className="empty-state">{registrations.length ? 'No registrations match your search.' : 'No player registrations found.'}</p>}
      {preview ? (
        <div className="registration-preview-backdrop" role="dialog" aria-modal="true" aria-label={preview.title} onClick={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
          <section className="registration-preview">
            <header className="registration-preview-header">
              <h3>{preview.title}</h3>
              <button type="button" onClick={() => setPreview(null)} aria-label="Close preview">Close <span aria-hidden="true">×</span></button>
            </header>
            {preview.isPdf ? <iframe src={preview.url} title={preview.title} /> : <img src={preview.url} alt={preview.title} />}
            <a href={preview.url} target="_blank" rel="noreferrer">Open full size</a>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function App() {
  const location = useLocation();
  const normalizedPath = location.pathname.length > 1
    ? location.pathname.replace(/\/+$/, '')
    : location.pathname;
  const isStandaloneRegistrationRoute = normalizedPath === '/register' || normalizedPath === '/register-form';
  const isScoringOnlyRoute = /^\/(?:matches|scorer)(?:\/|$)/.test(normalizedPath);
  const isStandaloneRoute = isStandaloneRegistrationRoute || isScoringOnlyRoute;
  const shouldLoadAuctionData = !isStandaloneRoute && normalizedPath !== '/';
  const cachedBootstrap = useMemo(() => {
    try {
      const cached = JSON.parse(sessionStorage.getItem('rmpl-auction-bootstrap') || 'null');
      return cached && Date.now() - Number(cached.cachedAt || 0) < 30 * 60 * 1000 ? cached : null;
    } catch { return null; }
  }, []);
  const [categories, setCategories] = useState(cachedBootstrap?.categories || []);
  const [settings, setSettings] = useState(cachedBootstrap?.settings || { backgroundImage: '', logo: '', auctionStartAudio: '', playerSoldAudio: '' });
  const [publicRegistrationCount, setPublicRegistrationCount] = useState(0);
  const [playerLimitEnabled, setPlayerLimitEnabled] = useState(Boolean(cachedBootstrap?.settings?.playerLimitEnabled));
  const [auctionCardSelectionEnabled, setAuctionCardSelectionEnabled] = useState(Boolean(cachedBootstrap?.settings?.auctionCardSelectionEnabled));
  const [teams, setTeams] = useState(cachedBootstrap?.teams || []);
  const [selectedCategory, setSelectedCategory] = useState('allrounder');
  const [pendingRegistrations, setPendingRegistrations] = useState(cachedBootstrap?.pendingRegistrations || []);
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
  const [scorerPasswordFeedback, setScorerPasswordFeedback] = useState('');
  const [changingScorerPassword, setChangingScorerPassword] = useState(false);
  const [routeLoading, setRouteLoading] = useState(!cachedBootstrap);
  const backendVersionRef = useRef(null);
  const auctionVersionRef = useRef(null);
  const loadDataPromiseRef = useRef(null);
  const loadDataQueuedRef = useRef(false);

  const loadData = (queueIfBusy = true) => {
    if (loadDataPromiseRef.current) {
      if (queueIfBusy) loadDataQueuedRef.current = true;
      return loadDataPromiseRef.current;
    }

    let request;
    request = (async () => {
      const response = await fetch(`${API}/bootstrap`, { cache: 'no-store' });
      let data;

      if (response.status === 404) {
        const [categoryResponse, settingsResponse, teamsResponse, pendingResponse, versionResponse] = await Promise.all([
          fetch(`${API}/categories`),
          fetch(`${API}/settings`),
          fetch(`${API}/teams`),
          fetch(`${API}/players/registrations/pending`),
          fetch(`${API}/data-version`, { cache: 'no-store' })
        ]);
        if (![categoryResponse, settingsResponse, teamsResponse, pendingResponse].every((item) => item.ok)) {
          throw new Error('Unable to load auction data');
        }
        const [categoriesData, settingsData, teamsData, pendingData, versionData] = await Promise.all([
          categoryResponse.json(),
          settingsResponse.json(),
          teamsResponse.json(),
          pendingResponse.json(),
          versionResponse.ok ? versionResponse.json() : Promise.resolve({})
        ]);
        data = {
          version: versionData.version,
          categories: categoriesData.categories,
          settings: settingsData,
          teams: teamsData.teams,
          pendingRegistrations: pendingData.registrations
        };
      } else {
        data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to load auction data');
      }

      const nextSettings = data.settings || {};
      setCategories(data.categories || []);
      setSettings(nextSettings);
      setPlayerLimitEnabled(Boolean(nextSettings.playerLimitEnabled));
      setAuctionCardSelectionEnabled(Boolean(nextSettings.auctionCardSelectionEnabled));
      setTeams(data.teams || []);
      setPendingRegistrations(data.pendingRegistrations || []);
      try {
        sessionStorage.setItem('rmpl-auction-bootstrap', JSON.stringify({
          ...data,
          cachedAt: Date.now()
        }));
      } catch {
        // Storage can be unavailable or full; live data still remains usable.
      }

      const nextVersion = Number(data.version);
      if (Number.isFinite(nextVersion)) {
        backendVersionRef.current = Math.max(
          Number(backendVersionRef.current || 0),
          nextVersion
        );
      }
      const nextAuctionVersion = Number(data.auctionVersion ?? data.version);
      if (Number.isFinite(nextAuctionVersion)) {
        const knownAuctionVersion = Number(auctionVersionRef.current || 0);
        if (knownAuctionVersion > nextAuctionVersion) {
          loadDataQueuedRef.current = true;
        } else {
          auctionVersionRef.current = nextAuctionVersion;
        }
      }
      return true;
    })()
      .catch((error) => {
        console.error('Auction data refresh failed:', error);
        return false;
      })
      .finally(() => {
        if (loadDataPromiseRef.current === request) {
          loadDataPromiseRef.current = null;
        }
        if (loadDataQueuedRef.current) {
          loadDataQueuedRef.current = false;
          loadData(false);
        }
      });

    loadDataPromiseRef.current = request;
    return request;
  };

  const loadPublicRegistrationSummary = async () => {
    try {
      const response = await fetch(`${API}/public/registration-summary`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to load registration summary');
      setPublicRegistrationCount(Number(data.registrationCount || 0));
      setSettings((current) => ({
        ...current,
        logo: data.logo || current.logo || '',
        backgroundImage: data.backgroundImage || current.backgroundImage || ''
      }));
    } catch {
      // Registration and match pages remain usable if public branding is unavailable.
    }
  };

  useEffect(() => {
    let active = true;
    if (isStandaloneRoute) {
      setRouteLoading(false);
      setPendingRegistrations([]);
      loadPublicRegistrationSummary();
      return () => { active = false; };
    }
    if (!shouldLoadAuctionData) {
      setRouteLoading(false);
      return () => { active = false; };
    }

    setRouteLoading(!cachedBootstrap);
    loadData(false).finally(() => {
      if (active) setRouteLoading(false);
    });
    return () => {
      active = false;
    };
  }, [isStandaloneRoute, shouldLoadAuctionData]);

  useEffect(() => {
    let active = true;
    let checkInFlight = false;
    let pollInterval = null;
    let fallbackTimer = null;
    let eventSource = null;

    const handleBackendVersion = (version, detail = {}) => {
      const nextVersion = Number(version);
      if (!active || !Number.isFinite(nextVersion)) return;
      const nextAuctionVersion = Number(detail.auctionVersion);

      if (backendVersionRef.current === null) {
        backendVersionRef.current = nextVersion;
        if (Number.isFinite(nextAuctionVersion)) auctionVersionRef.current = nextAuctionVersion;
        return;
      }
      if (backendVersionRef.current === nextVersion) return;

      const previousAuctionVersion = auctionVersionRef.current;
      backendVersionRef.current = nextVersion;
      if (Number.isFinite(nextAuctionVersion)) auctionVersionRef.current = nextAuctionVersion;
      window.dispatchEvent(new CustomEvent(LIVE_DATA_CHANGED_EVENT, { detail }));
      const changedPath = String(detail.path || '');
      const isMatchChange = changedPath.startsWith('/api/matches');
      const isSettingsChange = changedPath.startsWith('/api/settings');
      const auctionChanged = Number.isFinite(nextAuctionVersion)
        ? previousAuctionVersion !== null && nextAuctionVersion !== previousAuctionVersion
        : !isMatchChange;
      const shouldRefreshPublicSummary = (isStandaloneRegistrationRoute && auctionChanged)
        || (isScoringOnlyRoute && (isSettingsChange || (!changedPath && auctionChanged)));
      if (shouldRefreshPublicSummary) {
        loadPublicRegistrationSummary();
      }
      if (shouldLoadAuctionData && auctionChanged) loadData();
    };

    const checkForBackendChanges = async () => {
      if (checkInFlight || document.hidden) return;
      checkInFlight = true;
      try {
        const response = await fetch(`${API}/data-version`, { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        handleBackendVersion(data.version, data);
      } catch {
        // Leave the current page usable while the backend is unavailable.
      } finally {
        checkInFlight = false;
      }
    };

    const stopPolling = () => {
      if (pollInterval) {
        window.clearInterval(pollInterval);
        pollInterval = null;
      }
    };

    const startPolling = () => {
      if (pollInterval) return;
      checkForBackendChanges();
      pollInterval = window.setInterval(checkForBackendChanges, LIVE_DATA_POLL_INTERVAL_MS);
    };

    if (typeof window.EventSource === 'function') {
      eventSource = new window.EventSource(`${API}/live-events`);
      eventSource.addEventListener('version', (event) => {
        try {
          const detail = JSON.parse(event.data);
          handleBackendVersion(detail.version, detail);
        } catch {
          // A malformed event should not stop fallback refreshes.
        }
      });
      eventSource.onopen = () => {
        if (fallbackTimer) {
          window.clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        stopPolling();
      };
      eventSource.onerror = startPolling;
      fallbackTimer = window.setTimeout(startPolling, LIVE_DATA_FALLBACK_DELAY_MS);
    } else {
      startPolling();
    }

    window.addEventListener('focus', checkForBackendChanges);

    return () => {
      active = false;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      stopPolling();
      eventSource?.close();
      window.removeEventListener('focus', checkForBackendChanges);
    };
  }, [isScoringOnlyRoute, isStandaloneRegistrationRoute, shouldLoadAuctionData]);

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

  const changeScorerPassword = async (event) => {
    event.preventDefault();
    if (changingScorerPassword) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const currentPassword = String(formData.get('currentScorerPassword') || '');
    const newPassword = String(formData.get('newScorerPassword') || '');
    const confirmPassword = String(formData.get('confirmScorerPassword') || '');

    if (newPassword !== confirmPassword) {
      setScorerPasswordFeedback('New scorer passwords do not match.');
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      setScorerPasswordFeedback('New scorer password must be between 8 and 128 characters.');
      return;
    }
    if (newPassword === currentPassword) {
      setScorerPasswordFeedback('Choose a new scorer password that is different from the current password.');
      return;
    }

    setChangingScorerPassword(true);
    setScorerPasswordFeedback('Changing scorer password...');
    try {
      const response = await fetch(`${API}/scorer/password`, {
        method: 'PATCH',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'x-scorer-pin': currentPassword
        },
        body: JSON.stringify({ newPassword })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to change scorer password.');

      clearScorerSessionToken();
      form.reset();
      setScorerPasswordFeedback(`${data.message || 'Scorer password changed successfully.'} Sign in to the scorer again with the new password.`);
    } catch (error) {
      setScorerPasswordFeedback(error.message || 'Unable to change scorer password.');
    } finally {
      setChangingScorerPassword(false);
    }
  };

  return (
    <div className={`app-shell ${isScoringOnlyRoute ? 'scoring-only-route' : ''}`} style={{ backgroundImage: settings.backgroundImage ? `url(${resolveAssetUrl(settings.backgroundImage)})` : 'none' }}>
      {routeLoading && !isStandaloneRoute ? (
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
      {!isStandaloneRoute ? <header className="topbar">
        <div className="brand">
          {settings.logo ? <img src={resolveAssetUrl(settings.logo)} alt="logo" className="logo" /> : null}
          <div>
            <h1>RMPL Auction</h1>
            <p>Raipur Malayalee Premier Leagure</p>
          </div>
        </div>
        <nav>
          <Link to="/auction">Auction</Link>
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
              <Link to="/registration-data" onClick={() => setShowMoreNav(false)}>Registration Data</Link>
              <Link to="/approvals" onClick={() => setShowMoreNav(false)}>Approvals</Link>
              <Link to="/excel" onClick={() => setShowMoreNav(false)}>Excel</Link>
              <Link to="/video" onClick={() => setShowMoreNav(false)}>Welcome Video</Link>
              <Link to="/testimonials" onClick={() => setShowMoreNav(false)}>Previous Events</Link>
              <Link to="/match-records" onClick={() => setShowMoreNav(false)}>Match Records</Link>
              <Link to="/settings" onClick={() => setShowMoreNav(false)}>Settings</Link>
            </div> : null}
          </div>
        </nav>
      </header> : null}

      <Routes>
        <Route path="/" element={<Navigate to="/register" replace />} />
        <Route path="/auction" element={
          <main className="main-grid">
            <section className="categories-panel">
              <h2>Categories</h2>
              <div className="category-cards">
                {categorySummary.map((item) => (
                  <Link key={item.key} to={item.key === 'mvp' ? '/mvp' : `/category/${item.key}`} className={`cat-card ${item.key === 'mvp' ? 'mvp-category-card' : ''}`} onClick={() => setSelectedCategory(item.key)}>
                    <div className="category-image-wrap">
                      {settings.categoryImages?.[item.key] || item.players?.[0]?.image
                        ? <img src={resolveAssetUrl(settings.categoryImages?.[item.key] || item.players[0].image)} alt={`${item.label} category`} loading="lazy" decoding="async" />
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

        <Route path="/register" element={<RegistrationPage onRegistered={loadPublicRegistrationSummary} logo={settings.logo} registeredCount={publicRegistrationCount} />} />
        <Route path="/register-form" element={<RegistrationPage onRegistered={loadPublicRegistrationSummary} logo={settings.logo} registeredCount={publicRegistrationCount} />} />
        <Route path="/matches" element={<MatchesPage logo={settings.logo} backgroundImage={settings.backgroundImage} />} />
        <Route path="/matches/:matchId" element={<MatchDetailsPage logo={settings.logo} backgroundImage={settings.backgroundImage} />} />
        <Route path="/scorer" element={<ScorerDashboardPage logo={settings.logo} backgroundImage={settings.backgroundImage} />} />
        <Route path="/scorer/:matchId" element={<ScorerMatchPage logo={settings.logo} backgroundImage={settings.backgroundImage} />} />
        <Route path="/registration-data" element={<RegistrationDataPage />} />
        <Route path="/approvals" element={<main className="panel approvals-page"><div className="page-heading"><div><span className="eyebrow">APPROVAL PANEL</span><h2>Pending registrations</h2><p>Review player signups and approve them for auction.</p></div><Link className="back-link" to="/">Back to auction</Link></div><section className="pending-registrations-panel"><div className="pending-registrations-header"><div><span className="eyebrow">PENDING</span><h3>Player approvals</h3></div><span className="pending-count-badge">{pendingRegistrations.length}</span></div>{pendingRegistrations.length ? <div className="pending-registrations-list">{pendingRegistrations.map((player) => <article className="pending-registration-card" key={player._id}><div className="pending-registration-main"><h4>{player.name}</h4><p><strong>Age:</strong> {player.age || '—'}</p><p><strong>Phone:</strong> {player.phone || '—'}</p><p><strong>T-Shirt size:</strong> {player.tshirtSize || '—'}</p>{player.registrationRoles?.length ? <p><strong>Roles:</strong> {player.registrationRoles.join(', ')}</p> : null}{player.previouslyPlayedIn || player.playedIn ? <p><strong>Previously played:</strong> {player.previouslyPlayedIn || player.playedIn}</p> : null}{player.details ? <p>{player.details}</p> : null}{player.paymentReceipt ? <p><a href={resolveAssetUrl(player.paymentReceipt)} target="_blank" rel="noreferrer">View payment receipt</a></p> : null}</div><button type="button" onClick={() => approveRegistration(player)}>Approve</button></article>)}</div> : <p className="pending-empty">No pending registrations right now.</p>}</section>{feedback ? <p className="feedback">{feedback}</p> : null}</main>} />
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
        <Route path="/match-records" element={<MatchRecordsPage />} />

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
            <section className="settings-section scorer-password-section">
              <div className="settings-section-heading"><span>06</span><div><h3>Scorer Password</h3><p>Change the private password used to open and operate the live scoring console.</p></div></div>
              <form className="scorer-password-form" onSubmit={changeScorerPassword}>
                <label>Current scorer password
                  <input
                    type="password"
                    name="currentScorerPassword"
                    autoComplete="current-password"
                    maxLength="128"
                    spellCheck="false"
                    required
                  />
                </label>
                <label>New scorer password
                  <input
                    type="password"
                    name="newScorerPassword"
                    autoComplete="new-password"
                    minLength="8"
                    maxLength="128"
                    aria-describedby="scorer-password-guidance"
                    spellCheck="false"
                    required
                  />
                </label>
                <label>Confirm new password
                  <input
                    type="password"
                    name="confirmScorerPassword"
                    autoComplete="new-password"
                    minLength="8"
                    maxLength="128"
                    spellCheck="false"
                    required
                  />
                </label>
                <p id="scorer-password-guidance" className="scorer-password-guidance">Use 8–128 characters. The current password is verified securely and is never added to the branding settings upload.</p>
                <button type="submit" disabled={changingScorerPassword}>{changingScorerPassword ? 'Changing password...' : 'Change Scorer Password'}</button>
              </form>
              {scorerPasswordFeedback ? <p className={`settings-feedback scorer-password-feedback ${scorerPasswordFeedback.toLowerCase().includes('changed') ? 'success' : scorerPasswordFeedback.includes('Changing') ? 'saving' : ''}`} role="status">{scorerPasswordFeedback}</p> : null}
            </section>
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
