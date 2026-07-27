import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import './scoring.css';

const API_ORIGIN = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const API = `${API_ORIGIN}/api`;
const LIVE_DATA_CHANGED_EVENT = 'rmpl-live-data-changed';
const SCORER_TOKEN_KEY = 'rmpl-scorer-token';
const LEGACY_SCORER_PASSWORD_KEY = 'rmpl-scorer-pin';
const LIVE_STATUSES = new Set(['live', 'in_progress', 'in-progress', 'ongoing', 'innings_break', 'innings-break', 'awaiting_awards']);
const COMPLETE_STATUSES = new Set(['completed', 'complete', 'finished']);

const idOf = (value) => {
  if (!value) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return String(value._id || value.id || value.playerId || value.teamId || '');
};

const textOf = (value, fallback = '—') => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value.name || value.title || value.label || fallback;
  return String(value);
};

const statusKey = (match) => String(match?.status || 'scheduled').trim().toLowerCase();
const isLiveMatch = (match) => LIVE_STATUSES.has(statusKey(match));
const isCompleteMatch = (match) => COMPLETE_STATUSES.has(statusKey(match));
const isDraftMatch = (match) => ['draft', 'scheduled', 'upcoming', 'ready'].includes(statusKey(match));

const resolveAssetUrl = (value) => {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/uploads/')) return API_ORIGIN ? `${API_ORIGIN}${value}` : value;
  return value;
};

const createRequestId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `score-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const readStoredScorerToken = () => {
  try {
    sessionStorage.removeItem(LEGACY_SCORER_PASSWORD_KEY);
    return sessionStorage.getItem(SCORER_TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

const saveScorerToken = (token) => {
  try {
    sessionStorage.removeItem(LEGACY_SCORER_PASSWORD_KEY);
    if (token) sessionStorage.setItem(SCORER_TOKEN_KEY, String(token));
    else sessionStorage.removeItem(SCORER_TOKEN_KEY);
  } catch {
    // A blocked session store should not prevent in-memory scorer authentication.
  }
};

export const clearScorerSessionToken = () => saveScorerToken('');

if (typeof window !== 'undefined') {
  try {
    window.sessionStorage.removeItem(LEGACY_SCORER_PASSWORD_KEY);
  } catch {
    // Ignore browsers that disable session storage.
  }
}

async function readResponse(response) {
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json')
    ? await response.json()
    : { message: await response.text() };
  if (!response.ok) {
    const error = new Error(data.message || 'The request could not be completed.');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function apiRequest(path, options = {}, scorerAuth = null) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (scorerAuth?.token) headers.set('x-scorer-token', scorerAuth.token);
  else if (scorerAuth?.legacyPassword) headers.set('x-scorer-pin', scorerAuth.legacyPassword);
  const response = await fetch(`${API}${path}`, {
    cache: options.method && options.method !== 'GET' ? 'no-store' : options.cache,
    ...options,
    headers
  });
  return readResponse(response);
}

async function fetchAllMatches(query = '') {
  const base = new URLSearchParams(query);
  base.set('limit', base.get('limit') || '100');
  base.set('page', '1');
  const first = await apiRequest(`/matches?${base}`, { cache: 'no-store' });
  const matches = [...(first.matches || [])];
  const pages = numberOf(first.pagination?.pages, first.pagination?.totalPages, 1);
  const remaining = Array.from(
    { length: Math.max(0, Math.min(pages, 10) - 1) },
    (_, index) => index + 2
  );
  const pageResults = await Promise.all(remaining.map((page) => {
    const params = new URLSearchParams(base);
    params.set('page', String(page));
    return apiRequest(`/matches?${params}`, { cache: 'no-store' });
  }));
  pageResults.forEach((data) => matches.push(...(data.matches || [])));
  return { ...first, matches };
}

const dispatchScoringChange = (matchId = '', sourceId = '') => {
  window.dispatchEvent(new CustomEvent(LIVE_DATA_CHANGED_EVENT, {
    detail: { path: matchId ? `/api/matches/${matchId}` : '/api/matches', matchId, sourceId }
  }));
};

const teamFromMatch = (match, side) => {
  const direct = match?.[side];
  if (direct && typeof direct === 'object') return direct;
  const snapshot = match?.[`${side}Snapshot`] || match?.teams?.[side === 'teamA' ? 0 : 1];
  if (snapshot && typeof snapshot === 'object') return snapshot;
  return {
    _id: match?.[`${side}Id`] || direct || '',
    name: match?.[`${side}Name`] || (side === 'teamA' ? 'Team A' : 'Team B'),
    logo: match?.[`${side}Logo`] || ''
  };
};

const inningsList = (match) => {
  if (Array.isArray(match?.innings) && match.innings.length) return match.innings;
  return Array.isArray(match?.inningsSummaries) ? match.inningsSummaries : [];
};

const currentInningsOf = (match) => {
  const detailed = Array.isArray(match?.innings) ? match.innings : [];
  if (detailed.length) {
    const currentIndex = Math.min(
      Math.max(0, Number(match?.currentInningsIndex || 0)),
      detailed.length - 1
    );
    return detailed[currentIndex];
  }
  if (match?.currentInnings && typeof match.currentInnings === 'object') return match.currentInnings;
  const list = inningsList(match);
  if (!list.length) return null;
  const reference = Number(match?.currentInningsNumber ?? match?.currentInnings);
  if (Number.isFinite(reference) && reference > 0) {
    return list.find((innings) => Number(innings.number || innings.inningsNumber) === reference)
      || list[reference - 1]
      || list[list.length - 1];
  }
  return list[list.length - 1];
};

const inningsBattingTeamId = (innings) => idOf(
  innings?.battingTeam || innings?.battingTeamId || innings?.team || innings?.teamId
);

const numberOf = (...values) => {
  const match = values.find((value) => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value)));
  return match === undefined ? 0 : Number(match);
};

const inningsRuns = (innings) => numberOf(
  innings?.runs,
  innings?.totalRuns,
  innings?.summary?.totalRuns,
  innings?.score?.runs,
  innings?.score?.total
);

const inningsWickets = (innings) => numberOf(
  innings?.wickets,
  innings?.wicketsLost,
  innings?.summary?.wickets,
  innings?.score?.wickets
);

const inningsBalls = (innings) => numberOf(
  innings?.legalBalls,
  innings?.balls,
  innings?.ballsBowled,
  innings?.summary?.legalBalls,
  innings?.score?.balls
);

const oversFromBalls = (balls) => `${Math.floor(numberOf(balls) / 6)}.${numberOf(balls) % 6}`;

const inningsOvers = (innings) => {
  if (innings?.overs !== undefined && innings?.overs !== null && innings?.overs !== '') return String(innings.overs);
  if (innings?.summary?.overs !== undefined && innings?.summary?.overs !== null) return String(innings.summary.overs);
  return oversFromBalls(inningsBalls(innings));
};

const inningsForTeam = (match, team) => {
  const teamId = idOf(team);
  return inningsList(match).find((innings) => inningsBattingTeamId(innings) === teamId)
    || (idOf(teamFromMatch(match, 'teamA')) === teamId ? match?.teamAScore : match?.teamBScore)
    || null;
};

const scoreText = (innings, includeOvers = true) => {
  if (!innings) return 'Yet to bat';
  const score = `${inningsRuns(innings)}/${inningsWickets(innings)}`;
  return includeOvers ? `${score} (${inningsOvers(innings)} ov)` : score;
};

const formatDateTime = (value) => {
  if (!value) return 'Time to be announced';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

const displayStatus = (match) => {
  const key = statusKey(match);
  if (key === 'awaiting_awards') return 'Awaiting awards';
  if (LIVE_STATUSES.has(key)) return key.includes('break') ? 'Innings break' : 'Live';
  if (COMPLETE_STATUSES.has(key)) return 'Completed';
  if (key === 'draft') return 'Ready to start';
  return key.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const setIfCurrentRevision = (setter, nextMatch) => {
  if (!nextMatch) return;
  setter((current) => {
    if (!current || idOf(current) !== idOf(nextMatch)) return nextMatch;
    const currentRevision = Number(current.revision);
    const nextRevision = Number(nextMatch.revision);
    if (Number.isFinite(currentRevision) && Number.isFinite(nextRevision) && nextRevision < currentRevision) {
      return current;
    }
    return nextMatch;
  });
};

const playerName = (entry, fallback = '—') => {
  if (!entry) return fallback;
  if (typeof entry === 'string') return entry;
  return entry.playerName
    || entry.name
    || entry.player?.name
    || entry.batter?.name
    || entry.bowler?.name
    || entry.snapshot?.name
    || fallback;
};

const playerId = (entry) => idOf(entry?.player || entry?.batter || entry?.bowler || entry);

const battingRows = (innings) => (
  innings?.battingScorecard
  || innings?.batting
  || innings?.batters
  || innings?.batsmen
  || []
);

const bowlingRows = (innings) => (
  innings?.bowlingScorecard
  || innings?.bowling
  || innings?.bowlers
  || []
);

const deliveryList = (innings, match) => (
  innings?.deliveries
  || innings?.ballsList
  || match?.deliveries
  || []
);

const bowlerLimitStatus = (match, innings, bowler) => {
  const maximumOvers = Number(match?.maxOversPerBowler || 0);
  const bowlerId = idOf(bowler);
  const legalBalls = deliveryList(innings, match).reduce((total, delivery) => (
    total + (idOf(delivery?.bowler || delivery?.bowlerId) === bowlerId && delivery?.isLegal !== false ? 1 : 0)
  ), 0);
  const maximumBalls = maximumOvers * 6;
  return {
    legalBalls,
    overs: oversFromBalls(legalBalls),
    maximumOvers,
    remainingBalls: maximumOvers ? Math.max(0, maximumBalls - legalBalls) : null,
    exhausted: Boolean(maximumOvers && legalBalls >= maximumBalls)
  };
};

const currentParticipantId = (match, innings, role) => idOf(
  innings?.[role]
  || innings?.[`current${role.charAt(0).toUpperCase()}${role.slice(1)}`]
  || match?.[role]
  || match?.[`current${role.charAt(0).toUpperCase()}${role.slice(1)}`]
  || match?.summary?.[role]
);

const playersForMatchTeam = (match, options, team) => {
  const teamId = idOf(team);
  const snapshot = [match?.teamA, match?.teamB, ...(match?.teams || [])]
    .find((item) => idOf(item) === teamId);
  const savedPlayers = snapshot?.players
    || match?.lineups?.[teamId]
    || match?.squads?.[teamId]
    || [];
  return savedPlayers.length ? savedPlayers : playersForTeam(options, teamId);
};

const hasSavedAwards = (match) => Boolean(
  match?.awards?.manOfMatch
  || match?.awards?.manOfTheMatch
  || match?.awards?.manOfMatchPlayerId
  || match?.manOfMatch
);

const wicketDetails = (delivery) => {
  const wicket = delivery?.wicket;
  if (!wicket) return null;
  if (wicket === true) return { kind: delivery.wicketType || 'wicket', dismissedBatterId: idOf(delivery.dismissedBatter) };
  return wicket;
};

const deliveryRuns = (delivery) => numberOf(
  delivery?.totalRuns,
  delivery?.runs?.total,
  delivery?.runsTotal,
  numberOf(delivery?.runsOffBat, delivery?.runs?.bat)
    + numberOf(
      delivery?.extras?.wide,
      delivery?.extras?.wides,
      delivery?.runs?.extras
    )
);

const deliveryLabel = (delivery) => {
  if (wicketDetails(delivery)) return 'W';
  const extras = delivery?.extras || {};
  if (numberOf(extras.wide, extras.wides) > 0) return `${numberOf(extras.wide, extras.wides)}wd`;
  if (numberOf(extras.noBall, extras.noBalls) > 0) return `${numberOf(extras.noBall, extras.noBalls)}nb`;
  if (numberOf(extras.bye, extras.byes) > 0) return `${numberOf(extras.bye, extras.byes)}b`;
  if (numberOf(extras.legBye, extras.legByes) > 0) return `${numberOf(extras.legBye, extras.legByes)}lb`;
  return String(deliveryRuns(delivery));
};

const commentaryText = (delivery) => {
  if (delivery?.commentary) return delivery.commentary;
  if (delivery?.note) return delivery.note;
  const batter = delivery?.strikerName || playerName(delivery?.striker || delivery?.batter, 'Batter');
  const bowler = delivery?.bowlerName || playerName(delivery?.bowler, 'Bowler');
  const wicket = wicketDetails(delivery);
  if (wicket) return `${bowler} to ${batter} — wicket (${textOf(wicket.kind, 'dismissed')}).`;
  const total = deliveryRuns(delivery);
  return `${bowler} to ${batter} — ${total} run${total === 1 ? '' : 's'}.`;
};

const celebrationForDelivery = (delivery) => {
  if (!delivery) return null;
  if (wicketDetails(delivery)) {
    return { type: 'wicket', label: 'WICKET!', detail: 'The wicket is down' };
  }
  const batRuns = numberOf(delivery?.runsOffBat, delivery?.runs?.bat);
  if (batRuns === 6) return { type: 'six', label: 'SIX!', detail: 'Maximum!' };
  if (batRuns === 4) return { type: 'four', label: 'FOUR!', detail: 'Boundary!' };
  return null;
};

const latestMatchDelivery = (match) => {
  const innings = currentInningsOf(match);
  const deliveries = deliveryList(innings, match);
  return deliveries[deliveries.length - 1] || null;
};

function useDeliveryCelebration(match) {
  const [celebration, setCelebration] = useState(null);
  const baselineRef = useRef({ matchId: '', key: '' });

  const latest = latestMatchDelivery(match);
  const matchId = idOf(match);
  const deliveryKey = latest
    ? [
      idOf(latest) || latest.sequence || latest.displayBall || deliveryList(currentInningsOf(match), match).length,
      numberOf(latest?.runsOffBat, latest?.runs?.bat),
      wicketDetails(latest)?.kind || ''
    ].join(':')
    : '';

  useEffect(() => {
    if (!matchId) return undefined;
    if (baselineRef.current.matchId !== matchId) {
      baselineRef.current = { matchId, key: deliveryKey };
      setCelebration(null);
      return undefined;
    }
    if (!deliveryKey || baselineRef.current.key === deliveryKey) return undefined;

    baselineRef.current.key = deliveryKey;
    const next = celebrationForDelivery(latest);
    if (!next) {
      setCelebration(null);
      return undefined;
    }

    setCelebration({ ...next, key: `${matchId}:${deliveryKey}:${Date.now()}` });
    const timer = window.setTimeout(() => setCelebration(null), 2600);
    return () => window.clearTimeout(timer);
  }, [deliveryKey, matchId]);

  return celebration;
}

function DeliveryCelebration({ celebration }) {
  if (!celebration) return null;
  const particles = Array.from({ length: celebration.type === 'wicket' ? 12 : 20 });
  return (
    <div className={`delivery-celebration ${celebration.type}`} key={celebration.key} role="status" aria-live="assertive">
      <div className="celebration-glow" />
      <div className="celebration-particles" aria-hidden="true">
        {particles.map((_, index) => <i style={{ '--particle': index }} key={index} />)}
      </div>
      <div className="celebration-mark" aria-hidden="true">
        {celebration.type === 'wicket' ? <span className="celebration-stumps">|||</span> : <span>{celebration.type === 'six' ? '6' : '4'}</span>}
      </div>
      <strong>{celebration.label}</strong>
      <small>{celebration.detail}</small>
    </div>
  );
}

const ordinal = (value) => {
  const number = Number(value);
  const remainder = number % 100;
  if (remainder >= 11 && remainder <= 13) return `${number}th`;
  if (number % 10 === 1) return `${number}st`;
  if (number % 10 === 2) return `${number}nd`;
  if (number % 10 === 3) return `${number}rd`;
  return `${number}th`;
};

const playerFromMatch = (match, playerId) => {
  const targetId = idOf(playerId);
  return [match?.teamA, match?.teamB, ...(match?.teams || [])]
    .flatMap((team) => team?.players || [])
    .find((player) => idOf(player) === targetId);
};

function useViewerPlayerAnnouncements(match) {
  const [announcement, setAnnouncement] = useState(null);
  const baselineRef = useRef({ matchId: '', inningsId: '', activeIds: [], wicketKey: '' });
  const pendingWicketRef = useRef(false);
  const queueRef = useRef([]);
  const displayingRef = useRef(false);
  const timerRef = useRef(null);
  const showNextRef = useRef(null);

  showNextRef.current = () => {
    const next = queueRef.current.shift();
    if (!next) {
      displayingRef.current = false;
      setAnnouncement(null);
      return;
    }
    displayingRef.current = true;
    setAnnouncement(next);
    timerRef.current = window.setTimeout(() => {
      setAnnouncement(null);
      displayingRef.current = false;
      showNextRef.current?.();
    }, next.duration || 3600);
  };

  const enqueue = (...items) => {
    queueRef.current.push(...items.filter(Boolean));
    if (!displayingRef.current) showNextRef.current?.();
  };

  const innings = currentInningsOf(match);
  const matchId = idOf(match);
  const inningsId = idOf(innings) || String(match?.currentInningsIndex ?? '');
  const strikerId = currentParticipantId(match, innings, 'striker');
  const nonStrikerId = currentParticipantId(match, innings, 'nonStriker');
  const activeIds = [strikerId, nonStrikerId].filter(Boolean);
  const latest = latestMatchDelivery(match);
  const wicket = wicketDetails(latest);
  const wicketKey = wicket && wicket.countsAsWicket !== false
    ? `${idOf(latest) || latest?.sequence || deliveryList(innings, match).length}:${idOf(wicket.dismissedBatterId || wicket.dismissedBatter)}`
    : '';

  useEffect(() => {
    if (!matchId || !innings) return;
    const previous = baselineRef.current;
    if (previous.matchId !== matchId || previous.inningsId !== inningsId) {
      baselineRef.current = { matchId, inningsId, activeIds, wicketKey };
      pendingWicketRef.current = false;
      return;
    }

    const announcements = [];
    if (wicketKey && wicketKey !== previous.wicketKey) {
      const dismissedId = idOf(wicket?.dismissedBatterId || wicket?.dismissedBatter);
      const scorecardRow = battingRows(innings).find((row) => playerId(row) === dismissedId);
      const dismissed = { ...playerFromMatch(match, dismissedId), ...scorecardRow };
      announcements.push({
        type: 'wicket',
        key: `out:${wicketKey}`,
        player: dismissed,
        title: `${playerName(dismissed, 'Batter')} is out`,
        detail: textOf(wicket?.kind, 'Dismissed').replace(/\b\w/g, (letter) => letter.toUpperCase()),
        stats: `${numberOf(scorecardRow?.runs)} runs · ${numberOf(scorecardRow?.balls)} balls`,
        duration: 3200
      });
      pendingWicketRef.current = true;
    }

    const previousIds = new Set(previous.activeIds);
    const incomingId = activeIds.find((playerIdValue) => !previousIds.has(playerIdValue));
    if (incomingId && pendingWicketRef.current) {
      const rows = battingRows(innings);
      const scorecardRow = rows.find((row) => playerId(row) === incomingId);
      const incoming = { ...playerFromMatch(match, incomingId), ...scorecardRow };
      const rowIndex = rows.findIndex((row) => playerId(row) === incomingId);
      const position = Number.isInteger(scorecardRow?.appearanceOrder)
        ? Number(scorecardRow.appearanceOrder) + 1
        : rowIndex + 1;
      announcements.push({
        type: 'incoming',
        key: `incoming:${inningsId}:${incomingId}:${position}`,
        player: incoming,
        title: playerName(incoming, 'New batter'),
        detail: incoming.category || incoming.battingStyle || 'Batter',
        stats: position > 0 ? `Coming in at ${ordinal(position)}` : 'Next batter',
        duration: 4600
      });
      pendingWicketRef.current = false;
    }

    baselineRef.current = { matchId, inningsId, activeIds, wicketKey };
    if (announcements.length) enqueue(...announcements);
  }, [match?.revision, matchId, inningsId, strikerId, nonStrikerId, wicketKey]);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    queueRef.current = [];
  }, []);

  return announcement;
}

function ViewerPlayerAnnouncement({ announcement }) {
  if (!announcement) return null;
  const player = announcement.player || {};
  return (
    <div className={`viewer-player-announcement ${announcement.type}`} role="status" aria-live="assertive">
      <section key={announcement.key}>
        <span className="viewer-announcement-label">{announcement.type === 'wicket' ? 'WICKET' : 'NEW BATTER'}</span>
        <div className="viewer-announcement-player">
          <PlayerPhoto player={player} size="large" />
          <div>
            <h2>{announcement.title}</h2>
            <p>{announcement.detail}</p>
            <strong>{announcement.stats}</strong>
          </div>
        </div>
        {announcement.type === 'incoming' ? <small>Now walking to the crease</small> : <small>The next batter will be announced shortly</small>}
      </section>
    </div>
  );
}

function useWinnerCelebration(match) {
  const [winner, setWinner] = useState(null);
  const baselineRef = useRef({ matchId: '', complete: false });
  const matchId = idOf(match);
  const complete = isCompleteMatch(match);

  useEffect(() => {
    if (!matchId) return undefined;
    const previous = baselineRef.current;
    if (previous.matchId !== matchId) {
      baselineRef.current = { matchId, complete };
      setWinner(null);
      return undefined;
    }
    baselineRef.current = { matchId, complete };
    if (previous.complete || !complete) return undefined;

    const winnerTeamId = idOf(match?.result?.winnerTeamId);
    const winningTeam = [teamFromMatch(match, 'teamA'), teamFromMatch(match, 'teamB')]
      .find((team) => idOf(team) === winnerTeamId);
    setWinner({
      key: `${matchId}:${match?.revision || Date.now()}`,
      team: winningTeam,
      tie: Boolean(match?.result?.tie),
      result: match?.result?.text || (winningTeam ? `${textOf(winningTeam.name)} won` : 'Match tied'),
      manOfMatch: match?.awards?.manOfMatch || match?.awards?.manOfTheMatch || match?.manOfMatch
    });
    const timer = window.setTimeout(() => setWinner(null), 7200);
    return () => window.clearTimeout(timer);
  }, [complete, matchId, match?.revision]);

  return winner;
}

function WinnerCelebration({ winner }) {
  if (!winner) return null;
  return (
    <div className="winner-celebration" role="status" aria-live="assertive">
      <section key={winner.key}>
        <span className="cricket-kicker">{winner.tie ? 'MATCH COMPLETE' : 'MATCH WINNER'}</span>
        {winner.team ? <TeamMark team={winner.team} size="large" /> : <span className="winner-trophy" aria-hidden="true">★</span>}
        <h2>{winner.tie ? 'Match tied' : textOf(winner.team?.name, 'Winner')}</h2>
        <p>{winner.result}</p>
        {winner.manOfMatch ? (
          <article>
            <PlayerPhoto player={winner.manOfMatch} size="medium" />
            <span><small>MAN OF THE MATCH</small><strong>{playerName(winner.manOfMatch)}</strong></span>
          </article>
        ) : null}
      </section>
    </div>
  );
}

function useScoringLiveRefresh(refresh, {
  matchId = '',
  connectStream = true,
  intervalMs = 4000,
  sourceId = ''
} = {}) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    let active = true;
    let interval = null;
    let fallbackTimer = null;
    let refreshTimer = null;
    let source = null;
    let hasStreamBaseline = false;

    const shouldRefresh = (detail = {}) => {
      if (sourceId && detail?.sourceId === sourceId) return false;
      if (!detail?.path && !detail?.matchId) return true;
      const changedPath = String(detail.path || '');
      const isMasterDataChange = ['/api/teams', '/api/players', '/api/settings']
        .some((path) => changedPath.startsWith(path));
      if (isMasterDataChange) return true;
      if (!changedPath.startsWith('/api/matches')) return false;
      if (!matchId) return true;
      if (detail.matchId) return String(detail.matchId) === String(matchId);
      const pathMatch = changedPath.match(/\/api\/matches\/([^/?]+)/);
      return pathMatch ? decodeURIComponent(pathMatch[1]) === String(matchId) : true;
    };

    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        if (active) refreshRef.current({ quiet: true });
      }, 120);
    };

    const onLocalChange = (event) => {
      if (active && shouldRefresh(event.detail)) scheduleRefresh();
    };

    const stopPolling = () => {
      if (interval) window.clearInterval(interval);
      interval = null;
    };

    const startPolling = () => {
      if (interval) return;
      interval = window.setInterval(() => {
        if (!document.hidden) scheduleRefresh();
      }, intervalMs);
    };

    window.addEventListener(LIVE_DATA_CHANGED_EVENT, onLocalChange);

    if (connectStream && typeof window.EventSource === 'function') {
      source = new window.EventSource(`${API}/live-events`);
      source.addEventListener('version', (event) => {
        try {
          const detail = JSON.parse(event.data);
          if (!hasStreamBaseline && !detail.path && !detail.matchId) {
            hasStreamBaseline = true;
            return;
          }
          hasStreamBaseline = true;
          if (shouldRefresh(detail)) scheduleRefresh();
        } catch {
          scheduleRefresh();
        }
      });
      source.onopen = () => {
        if (fallbackTimer) window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
        stopPolling();
      };
      source.onerror = startPolling;
      fallbackTimer = window.setTimeout(startPolling, 3000);
    } else if (connectStream) {
      startPolling();
    }

    const onFocus = scheduleRefresh;
    window.addEventListener('focus', onFocus);

    return () => {
      active = false;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      if (refreshTimer) window.clearTimeout(refreshTimer);
      stopPolling();
      source?.close();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(LIVE_DATA_CHANGED_EVENT, onLocalChange);
    };
  }, [connectStream, intervalMs, matchId, sourceId]);
}

function TeamMark({ team, size = 'medium' }) {
  const logo = resolveAssetUrl(team?.logo || team?.teamLogo);
  return logo
    ? <img className={`cricket-team-mark ${size}`} src={logo} alt="" />
    : <span className={`cricket-team-fallback ${size}`} aria-hidden="true">{textOf(team?.name, 'T').charAt(0)}</span>;
}

function PlayerPhoto({ player, size = 'small' }) {
  const image = resolveAssetUrl(player?.image || player?.player?.image || player?.photo);
  const name = playerName(player, 'Player');
  return image
    ? <img className={`scoring-player-photo ${size}`} src={image} alt="" loading="lazy" />
    : <span className={`scoring-player-photo fallback ${size}`} aria-hidden="true">{name.charAt(0).toUpperCase()}</span>;
}

function MatchStatus({ match }) {
  return <span className={`cricket-status ${isLiveMatch(match) ? 'live' : isCompleteMatch(match) ? 'complete' : 'upcoming'}`}>
    {isLiveMatch(match) ? <i aria-hidden="true" /> : null}
    {displayStatus(match)}
  </span>;
}

function MatchCard({ match, compact = false, scorer = false }) {
  const teamA = teamFromMatch(match, 'teamA');
  const teamB = teamFromMatch(match, 'teamB');
  const link = scorer ? `/scorer/${match._id || match.id}` : `/matches/${match._id || match.id}`;
  const result = match.result?.summary || match.result?.text || match.result || match.resultText;
  const manOfMatch = match.awards?.manOfMatch || match.awards?.manOfTheMatch || match.manOfMatch;

  return (
    <article className={`cricket-match-card ${compact ? 'compact' : ''}`}>
      <header>
        <MatchStatus match={match} />
        <span>{match.oversPerInnings || match.oversLimit || '—'} overs{match.maxOversPerBowler ? ` · ${match.maxOversPerBowler}/bowler` : ''}</span>
      </header>
      <div className="cricket-match-card-title">
        <strong>{match.title || `${textOf(teamA.name)} vs ${textOf(teamB.name)}`}</strong>
        {!compact ? <small>{match.venue || formatDateTime(match.scheduledAt || match.startTime)}</small> : null}
      </div>
      <div className="cricket-card-team">
        <TeamMark team={teamA} size={compact ? 'small' : 'medium'} />
        <span>{textOf(teamA.name)}</span>
        <strong>{scoreText(inningsForTeam(match, teamA), false)}</strong>
      </div>
      <div className="cricket-card-team">
        <TeamMark team={teamB} size={compact ? 'small' : 'medium'} />
        <span>{textOf(teamB.name)}</span>
        <strong>{scoreText(inningsForTeam(match, teamB), false)}</strong>
      </div>
      {result ? <p className="cricket-card-result">{textOf(result)}</p> : null}
      {isCompleteMatch(match) && manOfMatch ? <p className="cricket-card-award"><span>★</span> Man of the Match: <strong>{playerName(manOfMatch)}</strong></p> : null}
      <Link className="cricket-view-button" to={link}>{scorer ? 'Open scorer' : 'View more'} <span aria-hidden="true">→</span></Link>
    </article>
  );
}

function AuctionBrandingBackdrop({ backgroundImage }) {
  const image = resolveAssetUrl(backgroundImage);
  return image
    ? <div className="cricket-auction-backdrop" style={{ backgroundImage: `url(${JSON.stringify(image)})` }} aria-hidden="true" />
    : null;
}

function CricketShell({ logo, backgroundImage, scorer = false, onLogout, children }) {
  return (
    <div className={`cricket-shell ${scorer ? 'scorer-shell' : ''} ${backgroundImage ? 'has-auction-branding' : ''}`}>
      <AuctionBrandingBackdrop backgroundImage={backgroundImage} />
      <header className="cricket-topbar">
        <Link className="cricket-brand" to={scorer ? '/scorer' : '/matches'}>
          {logo ? <img src={resolveAssetUrl(logo)} alt="RMPL logo" /> : <span className="cricket-brand-ball" aria-hidden="true" />}
          <span>
            <strong>RMPL {scorer ? 'Scorer' : 'Match Centre'}</strong>
            <small>{scorer ? 'Live scoring console' : 'Every ball. Every match.'}</small>
          </span>
        </Link>
        <nav aria-label={scorer ? 'Scorer navigation' : 'Match centre navigation'}>
          <Link to={scorer ? '/scorer' : '/matches'}>{scorer ? 'Matches' : 'Match centre'}</Link>
          {!scorer ? <Link to="/register">Registration</Link> : null}
          {scorer && onLogout ? <button type="button" onClick={onLogout}>Lock scorer</button> : null}
        </nav>
      </header>
      {children}
      <footer className="cricket-footer">Raipur Malayalee Premier League · Official scoring</footer>
    </div>
  );
}

export function RegistrationLiveMatches({ connectStream = false }) {
  const [matches, setMatches] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const loadGenerationRef = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    try {
      const data = await apiRequest('/matches?status=live&limit=50', { cache: 'no-store' });
      if (generation !== loadGenerationRef.current) return;
      const rows = (data.matches || []).filter(isLiveMatch);
      setMatches(rows);
    } catch {
      // The registration form must stay usable when the score service is unavailable.
    } finally {
      if (generation === loadGenerationRef.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    return () => { loadGenerationRef.current += 1; };
  }, [load]);
  useScoringLiveRefresh(load, { connectStream, intervalMs: 5000 });

  if (!loaded && !matches.length) {
    return <section className="registration-live-matches is-loading" aria-label="Live matches"><span className="score-skeleton" /></section>;
  }

  return (
    <section className="registration-live-matches" aria-labelledby="registration-live-title">
      <header>
        <div>
          <span className="cricket-kicker">{matches.length ? '● LIVE NOW' : 'MATCH CENTRE'}</span>
          <h3 id="registration-live-title">{matches.length ? 'Matches happening now' : 'Follow every match live'}</h3>
        </div>
        <Link to="/matches">All matches <span aria-hidden="true">→</span></Link>
      </header>
      {matches.length ? (
        <div className="registration-live-scroll">
          {matches.map((match) => <MatchCard key={match._id || match.id} match={match} compact />)}
        </div>
      ) : <p className="registration-no-live">No match is live right now. Open Match Centre for fixtures and previous results.</p>}
    </section>
  );
}

export function MatchesPage({ logo, backgroundImage }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const loadGenerationRef = useRef(0);

  const load = useCallback(async ({ quiet = false } = {}) => {
    const generation = ++loadGenerationRef.current;
    if (!quiet) setLoading(true);
    try {
      const data = await fetchAllMatches();
      if (generation !== loadGenerationRef.current) return;
      setMatches(data.matches || []);
      setError('');
    } catch (loadError) {
      if (generation !== loadGenerationRef.current) return;
      if (!quiet) setError(loadError.message || 'Unable to load matches.');
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => { loadGenerationRef.current += 1; };
  }, [load]);
  useScoringLiveRefresh(load, { connectStream: false });

  const counts = useMemo(() => ({
    all: matches.length,
    live: matches.filter(isLiveMatch).length,
    completed: matches.filter(isCompleteMatch).length,
    upcoming: matches.filter((match) => !isLiveMatch(match) && !isCompleteMatch(match)).length
  }), [matches]);

  const orderedMatches = useMemo(() => [...matches].sort((left, right) => {
    const rank = (match) => (isLiveMatch(match) ? 0 : isCompleteMatch(match) ? 2 : 1);
    return rank(left) - rank(right)
      || new Date(right.updatedAt || right.scheduledAt || 0)
        - new Date(left.updatedAt || left.scheduledAt || 0);
  }), [matches]);

  const visible = useMemo(() => orderedMatches.filter((match) => {
    if (filter === 'live') return isLiveMatch(match);
    if (filter === 'completed') return isCompleteMatch(match);
    if (filter === 'upcoming') return !isLiveMatch(match) && !isCompleteMatch(match);
    return true;
  }), [filter, orderedMatches]);

  return (
    <CricketShell logo={logo} backgroundImage={backgroundImage}>
      <main className="cricket-page match-centre-page">
        <section className="match-centre-hero">
          <div>
            <span className="cricket-kicker">RMPL MATCH CENTRE</span>
            <h1>Live scores and match history</h1>
            <p>Follow every delivery, full scorecard and result from one place.</p>
          </div>
          <div className="match-centre-live-count">
            <strong>{counts.live}</strong>
            <span>live match{counts.live === 1 ? '' : 'es'}</span>
          </div>
        </section>

        <div className="match-filter-tabs" role="tablist" aria-label="Filter matches">
          {[
            ['all', 'All'],
            ['live', 'Live'],
            ['upcoming', 'Upcoming'],
            ['completed', 'Previous']
          ].map(([key, label]) => (
            <button
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={filter === key ? 'active' : ''}
              onClick={() => setFilter(key)}
              key={key}
            >
              {label}<span>{counts[key]}</span>
            </button>
          ))}
        </div>

        {loading ? <ScoreLoading label="Loading matches…" /> : null}
        {error && !matches.length ? <ScoreError message={error} retry={load} /> : null}
        {!loading && !error && !visible.length ? <ScoreEmpty title="No matches here yet" text="Matches will appear as soon as the scorer creates them." /> : null}
        {visible.length ? <div className="match-centre-grid">{visible.map((match) => <MatchCard key={match._id || match.id} match={match} />)}</div> : null}
      </main>
    </CricketShell>
  );
}

function ScoreLoading({ label = 'Loading score…' }) {
  return <div className="score-loading" role="status"><span /><p>{label}</p></div>;
}

function ScoreError({ message, retry }) {
  return <div className="score-state-card error"><span aria-hidden="true">!</span><h2>Score unavailable</h2><p>{message}</p>{retry ? <button type="button" onClick={() => retry()}>Try again</button> : null}</div>;
}

function ScoreEmpty({ title, text }) {
  return <div className="score-state-card"><span className="empty-wicket" aria-hidden="true">|||</span><h2>{title}</h2><p>{text}</p></div>;
}

function PublicScoreHero({ match }) {
  const teamA = teamFromMatch(match, 'teamA');
  const teamB = teamFromMatch(match, 'teamB');
  const current = currentInningsOf(match);
  const result = match.result?.summary || match.result?.text || match.result || match.resultText;
  const target = numberOf(current?.target, current?.summary?.target, match?.target);
  const requiredRuns = current?.requiredRuns ?? current?.summary?.requiredRuns;
  const remainingBalls = current?.ballsRemaining ?? current?.summary?.ballsRemaining;
  const required = requiredRuns !== undefined && requiredRuns !== null
    ? `${requiredRuns} needed from ${remainingBalls ?? '—'} balls`
    : '';
  const tossWinner = [teamA, teamB].find((team) => idOf(team) === idOf(match?.toss?.winnerTeamId));

  return (
    <section className="public-score-hero">
      <header>
        <div><MatchStatus match={match} /><span>{match.venue || 'Venue to be announced'}</span></div>
        <small>{formatDateTime(match.scheduledAt || match.startTime)}</small>
      </header>
      <h1>{match.title || `${textOf(teamA.name)} vs ${textOf(teamB.name)}`}</h1>
      {tossWinner && match?.toss?.decision ? <p className="public-toss">{textOf(tossWinner.name)} won the toss and chose to {match.toss.decision}</p> : null}
      <div className="public-score-teams">
        <div className={inningsBattingTeamId(current) === idOf(teamA) ? 'batting' : ''}>
          <TeamMark team={teamA} size="large" />
          <span>{textOf(teamA.name)}</span>
          <strong>{scoreText(inningsForTeam(match, teamA), false)}</strong>
          <small>{inningsForTeam(match, teamA) ? `${inningsOvers(inningsForTeam(match, teamA))} overs` : 'Yet to bat'}</small>
        </div>
        <span className="score-versus">VS</span>
        <div className={inningsBattingTeamId(current) === idOf(teamB) ? 'batting' : ''}>
          <TeamMark team={teamB} size="large" />
          <span>{textOf(teamB.name)}</span>
          <strong>{scoreText(inningsForTeam(match, teamB), false)}</strong>
          <small>{inningsForTeam(match, teamB) ? `${inningsOvers(inningsForTeam(match, teamB))} overs` : 'Yet to bat'}</small>
        </div>
      </div>
      {result ? <p className="public-score-result">{textOf(result)}</p> : null}
      {!result && target > 0 ? <p className="public-score-equation">Target {target}{required ? ` · ${required}` : ''}</p> : null}
    </section>
  );
}

function LiveNowPanel({ match, innings }) {
  if (!innings || !isLiveMatch(match)) return null;
  const batters = battingRows(innings);
  const bowlers = bowlingRows(innings);
  const strikerId = currentParticipantId(match, innings, 'striker');
  const nonStrikerId = currentParticipantId(match, innings, 'nonStriker');
  const bowlerId = currentParticipantId(match, innings, 'bowler');
  const striker = batters.find((row) => playerId(row) === strikerId) || batters.find((row) => row.isStriker);
  const nonStriker = batters.find((row) => playerId(row) === nonStrikerId) || batters.find((row) => !row.isOut && playerId(row) !== playerId(striker));
  const bowler = bowlers.find((row) => playerId(row) === bowlerId) || bowlers[bowlers.length - 1];
  const allDeliveries = deliveryList(innings, match);
  const latestOverNumber = allDeliveries.length
    ? deliveryOverNumber(allDeliveries[allDeliveries.length - 1])
    : 0;
  const recent = allDeliveries.filter((delivery) => deliveryOverNumber(delivery) === latestOverNumber);
  const overRuns = recent.reduce((total, delivery) => total + deliveryRuns(delivery), 0);
  const overWickets = recent.reduce((total, delivery) => {
    const wicket = wicketDetails(delivery);
    return total + (wicket && wicket.countsAsWicket !== false ? 1 : 0);
  }, 0);
  const overLegalBalls = recent.filter((delivery) => delivery?.isLegal !== false).length;
  const overComplete = overLegalBalls >= 6;

  return (
    <section className="live-now-panel">
      <header><span className="live-pulse" /> <strong>Live now</strong><small>Score updates automatically</small></header>
      <div className="live-player-grid">
        <div>
          <span>Batters</span>
          {[striker, nonStriker].filter(Boolean).map((row, index) => (
            <p key={playerId(row) || index}>
              <PlayerPhoto player={row} />
              <strong>{playerName(row)}{playerId(row) === strikerId || row.isStriker ? ' *' : ''}</strong>
              <span>{numberOf(row.runs)} <small>({numberOf(row.balls)}b)</small></span>
            </p>
          ))}
        </div>
        <div>
          <span>Bowler</span>
          {bowler ? <p><PlayerPhoto player={bowler} /><strong>{playerName(bowler)}</strong><span>{numberOf(bowler.wickets)}/{numberOf(bowler.runs, bowler.runsConceded)} <small>({bowler.overs || oversFromBalls(bowler.balls)} ov)</small></span></p> : <p>Waiting for bowler</p>}
        </div>
      </div>
      {recent.length ? <div className="recent-over" aria-label={`Over ${latestOverNumber + 1} deliveries`}>
        <div className="recent-over-heading">
          <span>{overComplete ? `Over ${latestOverNumber + 1} complete` : 'This over'}</span>
          <strong>{overRuns} runs · {overWickets} wicket{overWickets === 1 ? '' : 's'} · {overLegalBalls} legal balls</strong>
        </div>
        <div className="recent-deliveries">
          {recent.map((delivery, index) => <i className={wicketDetails(delivery) ? 'wicket' : ''} key={delivery._id || delivery.id || index}>{deliveryLabel(delivery)}</i>)}
        </div>
      </div> : null}
    </section>
  );
}

function BattingTable({ innings }) {
  const allRows = battingRows(innings);
  const hasParticipationFlags = allRows.some((row) => Object.prototype.hasOwnProperty.call(row, 'didBat'));
  const rows = hasParticipationFlags
    ? allRows.filter((row) => row.didBat || row.isStriker || row.isNonStriker)
    : allRows;
  return (
    <div className="score-table-wrap">
      <table className="score-table">
        <thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
        <tbody>
          {rows.length ? rows.map((row, index) => {
            const runs = numberOf(row.runs);
            const balls = numberOf(row.balls);
            const strikeRate = row.strikeRate ?? (balls ? ((runs / balls) * 100).toFixed(1) : '0.0');
            return <tr key={playerId(row) || index}><td><strong>{playerName(row)}</strong><small>{row.dismissal || row.status || (row.isOut ? 'out' : 'not out')}</small></td><td><strong>{runs}</strong></td><td>{balls}</td><td>{numberOf(row.fours)}</td><td>{numberOf(row.sixes)}</td><td>{strikeRate}</td></tr>;
          }) : <tr><td colSpan="6" className="table-empty">Batting scorecard will appear after play begins.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function BowlingTable({ innings }) {
  const rows = bowlingRows(innings);
  return (
    <div className="score-table-wrap">
      <table className="score-table">
        <thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>WD</th><th>NB</th><th>Eco</th></tr></thead>
        <tbody>
          {rows.length ? rows.map((row, index) => {
            const balls = numberOf(row.balls, row.legalBalls);
            const conceded = numberOf(row.runsConceded, row.runs);
            const economy = row.economy ?? (balls ? (conceded / (balls / 6)).toFixed(2) : '0.00');
            return <tr key={playerId(row) || index}><td><strong>{playerName(row)}</strong></td><td>{row.overs || oversFromBalls(balls)}</td><td>{numberOf(row.maidens)}</td><td>{conceded}</td><td><strong>{numberOf(row.wickets)}</strong></td><td>{numberOf(row.wides)}</td><td>{numberOf(row.noBalls)}</td><td>{economy}</td></tr>;
          }) : <tr><td colSpan="8" className="table-empty">Bowling figures will appear after play begins.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function InningsScorecard({ match, innings, number }) {
  const teamA = teamFromMatch(match, 'teamA');
  const battingTeam = inningsBattingTeamId(innings) === idOf(teamA) ? teamA : teamFromMatch(match, 'teamB');
  const extras = innings?.extras || {};
  const fallOfWickets = innings?.fallOfWickets || [];
  const didNotBat = innings?.didNotBat || [];
  const partnership = innings?.partnership;
  return (
    <section className="innings-scorecard">
      <header>
        <div><TeamMark team={battingTeam} size="small" /><span><strong>{textOf(battingTeam.name)}</strong><small>Innings {number}</small></span></div>
        <strong>{scoreText(innings)}</strong>
      </header>
      <h3>Batting</h3>
      <BattingTable innings={innings} />
      <div className="innings-totals">
        <span>Extras <strong>{numberOf(innings?.extrasTotal, extras.total, Object.values(extras).reduce((sum, value) => sum + numberOf(value), 0))}</strong><small>WD {numberOf(extras.wide)} · NB {numberOf(extras.noBall)} · B {numberOf(extras.bye)} · LB {numberOf(extras.legBye)} · P {numberOf(extras.penalty)}</small></span>
        <span>Total <strong>{inningsRuns(innings)}/{inningsWickets(innings)}</strong></span>
      </div>
      {fallOfWickets.length ? <div className="innings-detail-line"><strong>Fall of wickets</strong><span>{fallOfWickets.map((item) => `${item.wicket}-${item.score} (${item.playerName || 'Batter'}, ${item.over || '—'})`).join(' · ')}</span></div> : null}
      {partnership && (partnership.runs || partnership.balls) ? <div className="innings-detail-line"><strong>Current partnership</strong><span>{numberOf(partnership.runs)} runs from {numberOf(partnership.balls)} balls</span></div> : null}
      {didNotBat.length ? <div className="innings-detail-line"><strong>Did not bat</strong><span>{didNotBat.map((player) => playerName(player)).join(', ')}</span></div> : null}
      <h3>Bowling</h3>
      <BowlingTable innings={innings} />
    </section>
  );
}

const deliveryOverNumber = (delivery) => {
  const direct = Number(delivery?.overNumber ?? delivery?.over);
  if (Number.isInteger(direct) && direct >= 0) return direct;
  const label = String(delivery?.displayBall || delivery?.overLabel || delivery?.ballLabel || '');
  const parsed = Number(label.split('.')[0]);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
};

function commentaryOvers(match) {
  const innings = inningsList(match);
  const currentInningsIndex = Math.min(
    Math.max(0, Number(match?.currentInningsIndex || 0)),
    Math.max(0, innings.length - 1)
  );
  const groups = [];

  innings.forEach((inningsItem, inningsIndex) => {
    const byOver = new Map();
    deliveryList(inningsItem, match).forEach((delivery, deliveryIndex) => {
      const overNumber = deliveryOverNumber(delivery);
      const group = byOver.get(overNumber) || {
        inningsNumber: Number(inningsItem?.number || inningsIndex + 1),
        inningsIndex,
        overNumber,
        deliveries: [],
        runs: 0,
        wickets: 0,
        legalBalls: 0
      };
      const wicket = wicketDetails(delivery);
      group.deliveries.push({ ...delivery, deliveryIndex });
      group.runs += deliveryRuns(delivery);
      group.wickets += wicket && wicket.countsAsWicket !== false ? 1 : 0;
      group.legalBalls += delivery?.isLegal === false ? 0 : 1;
      byOver.set(overNumber, group);
    });

    const inningsGroups = [...byOver.values()].sort((left, right) => left.overNumber - right.overNumber);
    const inningsFinished = Boolean(
      inningsItem?.terminal
      || inningsItem?.summary?.terminal
      || COMPLETE_STATUSES.has(String(inningsItem?.status || '').toLowerCase())
      || inningsIndex < currentInningsIndex
      || isCompleteMatch(match)
    );
    inningsGroups.forEach((group, groupIndex) => {
      const isLatest = groupIndex === inningsGroups.length - 1;
      group.completed = group.legalBalls >= 6 || (isLatest && inningsFinished);
      group.current = inningsIndex === currentInningsIndex && isLatest && !group.completed;
      groups.push(group);
    });
  });

  return groups.reverse();
}

function CommentaryDeliveries({ group }) {
  return (
    <div className="commentary-list">
      {group.deliveries.map((delivery, index) => (
        <article key={delivery._id || delivery.id || `${group.inningsNumber}-${group.overNumber}-${delivery.deliveryIndex ?? index}`}>
          <strong>{delivery.displayBall || delivery.overLabel || delivery.ballLabel || `${delivery.over ?? '—'}.${delivery.ball ?? '—'}`}</strong>
          <i className={wicketDetails(delivery) ? 'wicket' : ''}>{deliveryLabel(delivery)}</i>
          <p>{commentaryText(delivery)}</p>
        </article>
      ))}
    </div>
  );
}

function OverCommentaryHeading({ group }) {
  return (
    <>
      <span className="over-commentary-title">
        <small>Innings {group.inningsNumber}</small>
        <strong>Over {group.overNumber + 1}</strong>
        {group.current ? <em>THIS OVER</em> : null}
      </span>
      <span className="over-commentary-summary">
        <strong>{group.runs} run{group.runs === 1 ? '' : 's'}</strong>
        <small>{group.wickets} wicket{group.wickets === 1 ? '' : 's'} · {group.legalBalls} legal balls</small>
      </span>
    </>
  );
}

function CommentaryPanel({ match }) {
  const groups = commentaryOvers(match);
  const deliveryCount = groups.reduce((total, group) => total + group.deliveries.length, 0);

  return (
    <section className="commentary-panel">
      <header><div><span className="cricket-kicker">OVER BY OVER</span><h2>Live commentary</h2></div><span>{deliveryCount} deliveries</span></header>
      {groups.length ? <div className="commentary-overs">
        {groups.map((group) => (
          group.current ? (
            <section className="over-commentary current" key={`${group.inningsNumber}-${group.overNumber}`}>
              <header><OverCommentaryHeading group={group} /></header>
              <CommentaryDeliveries group={group} />
            </section>
          ) : (
            <details className="over-commentary completed" key={`${group.inningsNumber}-${group.overNumber}`}>
              <summary><OverCommentaryHeading group={group} /><i aria-hidden="true">⌄</i></summary>
              <CommentaryDeliveries group={group} />
            </details>
          )
        ))}
      </div> : <p className="commentary-empty">Ball-by-ball updates will appear when scoring begins.</p>}
    </section>
  );
}

function AwardsPanel({ match }) {
  if (!isCompleteMatch(match) && !match.awards) return null;
  const manOfMatch = match.awards?.manOfMatch || match.awards?.manOfTheMatch || match.manOfMatch;
  const bestBowler = match.awards?.bestBowler || match.bestBowler;
  const winningTeam = [teamFromMatch(match, 'teamA'), teamFromMatch(match, 'teamB')]
    .find((team) => idOf(team) === idOf(match?.result?.winnerTeamId));
  if (!manOfMatch && !bestBowler) return null;
  return (
    <section className="match-awards">
      <header><span className="cricket-kicker">MATCH HONOURS</span><h2>Stars of the match</h2></header>
      <div>
        {winningTeam ? <article className="match-winning-team"><TeamMark team={winningTeam} size="large" /><small>Match Winner</small><strong>{textOf(winningTeam.name)}</strong><p>{match?.result?.text || ''}</p></article> : null}
        {manOfMatch ? <article><span aria-hidden="true">★</span><small>Man of the Match</small><strong>{playerName(manOfMatch)}</strong>{manOfMatch.image || manOfMatch.player?.image ? <img src={resolveAssetUrl(manOfMatch.image || manOfMatch.player.image)} alt="" /> : null}</article> : null}
        {bestBowler ? <article><span aria-hidden="true">W</span><small>Best Bowler</small><strong>{playerName(bestBowler)}</strong>{bestBowler.image || bestBowler.player?.image ? <img src={resolveAssetUrl(bestBowler.image || bestBowler.player.image)} alt="" /> : null}</article> : null}
      </div>
    </section>
  );
}

export function MatchDetailsPage({ logo, backgroundImage }) {
  const { matchId } = useParams();
  const loadGenerationRef = useRef(0);
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeInnings, setActiveInnings] = useState(0);

  const load = useCallback(async ({ quiet = false } = {}) => {
    const generation = ++loadGenerationRef.current;
    if (!quiet) setLoading(true);
    try {
      const data = await apiRequest(`/matches/${matchId}`, { cache: 'no-store' });
      if (generation !== loadGenerationRef.current) return;
      setIfCurrentRevision(setMatch, data.match || data);
      setError('');
    } catch (loadError) {
      if (generation !== loadGenerationRef.current) return;
      if (!quiet) setError(loadError.message || 'Unable to load this match.');
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    setMatch(null);
    setError('');
    setActiveInnings(0);
    load();
  }, [load]);
  useScoringLiveRefresh(load, { matchId, connectStream: false, intervalMs: 3000 });

  const innings = inningsList(match);
  useEffect(() => {
    if (!innings.length) return;
    const currentIndex = Number(match?.currentInningsIndex);
    setActiveInnings(Number.isInteger(currentIndex)
      ? Math.min(Math.max(0, currentIndex), innings.length - 1)
      : innings.length - 1);
  }, [matchId, innings.length, match?.currentInningsIndex]);
  const selectedInnings = innings[activeInnings] || innings[innings.length - 1] || null;
  const celebration = useDeliveryCelebration(match);
  const playerAnnouncement = useViewerPlayerAnnouncements(match);
  const winnerCelebration = useWinnerCelebration(match);

  return (
    <CricketShell logo={logo} backgroundImage={backgroundImage}>
      <DeliveryCelebration celebration={celebration?.type === 'wicket' ? null : celebration} />
      <ViewerPlayerAnnouncement announcement={playerAnnouncement} />
      <WinnerCelebration winner={winnerCelebration} />
      <main className="cricket-page match-detail-page">
        <Link className="cricket-back-link" to="/matches">← All matches</Link>
        {loading ? <ScoreLoading /> : null}
        {error && !match ? <ScoreError message={error} retry={load} /> : null}
        {match ? <>
          <PublicScoreHero match={match} />
          <LiveNowPanel match={match} innings={currentInningsOf(match)} />
          <AwardsPanel match={match} />
          {innings.length ? (
            <section className="scorecard-section">
              <header><div><span className="cricket-kicker">FULL SCORECARD</span><h2>Innings</h2></div>
                {innings.length > 1 ? <div className="innings-tabs">{innings.map((item, index) => <button type="button" className={activeInnings === index ? 'active' : ''} onClick={() => setActiveInnings(index)} key={item._id || index}>Innings {index + 1}</button>)}</div> : null}
              </header>
              <InningsScorecard match={match} innings={selectedInnings} number={activeInnings + 1} />
            </section>
          ) : <ScoreEmpty title="Match not started" text="The full scorecard will appear as soon as the first delivery is recorded." />}
          <CommentaryPanel match={match} />
        </> : null}
      </main>
    </CricketShell>
  );
}

function useScorerSession() {
  const [token, setToken] = useState(() => readStoredScorerToken());
  const [legacyPassword, setLegacyPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(Boolean(token));
  const [error, setError] = useState('');

  const establishSession = useCallback((data, { existingToken = '', fallbackPassword = '' } = {}) => {
    const nextToken = String(data?.token || existingToken || '');
    if (data?.authenticated === false || (!nextToken && !fallbackPassword && data?.authenticated !== true)) {
      throw new Error(data?.message || 'Scorer authentication failed.');
    }

    if (nextToken) saveScorerToken(nextToken);
    else saveScorerToken('');
    setToken(nextToken);
    setLegacyPassword(nextToken ? '' : fallbackPassword);
    setExpiresAt(data?.expiresAt || '');
    setAuthenticated(true);
  }, []);

  const verify = useCallback(async (candidate) => {
    const password = String(candidate || '');
    if (!password) {
      setError('Enter the scorer password.');
      return false;
    }
    setChecking(true);
    setError('');
    try {
      const data = await apiRequest('/scorer/session', {
        method: 'POST',
        body: JSON.stringify({ password })
      });
      establishSession(data, {
        fallbackPassword: data?.token ? '' : password
      });
      return true;
    } catch (sessionError) {
      saveScorerToken('');
      setToken('');
      setLegacyPassword('');
      setExpiresAt('');
      setAuthenticated(false);
      setError(sessionError.message || 'Invalid scorer password.');
      return false;
    } finally {
      setChecking(false);
    }
  }, [establishSession]);

  useEffect(() => {
    if (!token) {
      setChecking(false);
      return undefined;
    }

    let active = true;
    setChecking(true);
    apiRequest('/scorer/session', { method: 'POST' }, { token })
      .then((data) => {
        if (!active) return;
        establishSession(data, { existingToken: token });
        setError('');
      })
      .catch((sessionError) => {
        if (!active) return;
        saveScorerToken('');
        setToken('');
        setLegacyPassword('');
        setExpiresAt('');
        setAuthenticated(false);
        setError(sessionError.message || 'Scorer session expired. Enter the password again.');
      })
      .finally(() => {
        if (active) setChecking(false);
      });

    return () => { active = false; };
  }, []); // A saved token is verified once on protected-route mount, without resending a password.

  const logout = useCallback(() => {
    saveScorerToken('');
    setToken('');
    setLegacyPassword('');
    setExpiresAt('');
    setAuthenticated(false);
  }, []);

  useEffect(() => {
    if (!authenticated || !expiresAt) return undefined;
    const remaining = new Date(expiresAt).getTime() - Date.now();
    if (!Number.isFinite(remaining)) return undefined;
    if (remaining <= 0) {
      logout();
      return undefined;
    }
    const timeout = window.setTimeout(logout, Math.min(remaining, 2_147_000_000));
    return () => window.clearTimeout(timeout);
  }, [authenticated, expiresAt, logout]);

  const auth = useMemo(() => (
    token ? { token } : legacyPassword ? { legacyPassword } : null
  ), [legacyPassword, token]);

  return { auth, authenticated, checking, error, expiresAt, verify, logout };
}

function ScorerLogin({ logo, backgroundImage, session }) {
  const [candidate, setCandidate] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    await session.verify(candidate);
  };
  return (
    <div className={`scorer-login-page ${backgroundImage ? 'has-auction-branding' : ''}`}>
      <AuctionBrandingBackdrop backgroundImage={backgroundImage} />
      <section className="scorer-login-card">
        {logo ? <img src={resolveAssetUrl(logo)} alt="RMPL logo" /> : <span className="scorer-login-ball" aria-hidden="true" />}
        <span className="cricket-kicker">AUTHORIZED SCORERS ONLY</span>
        <h1>Open scoring console</h1>
        <p>Enter the scorer password to create matches and record every delivery.</p>
        <form onSubmit={submit}>
          <label>Scorer password<input type="password" autoComplete="current-password" value={candidate} onChange={(event) => setCandidate(event.target.value)} placeholder="Enter scorer password" autoFocus /></label>
          <button type="submit" disabled={session.checking}>{session.checking ? 'Checking…' : 'Unlock scorer'}</button>
          {session.error ? <p className="scorer-form-error" role="alert">{session.error}</p> : null}
        </form>
        <Link to="/matches">View public Match Centre</Link>
      </section>
    </div>
  );
}

function ScorerProtected({ logo, backgroundImage, children }) {
  const session = useScorerSession();
  if (session.checking && !session.authenticated) return <div className={`scorer-login-page ${backgroundImage ? 'has-auction-branding' : ''}`}><AuctionBrandingBackdrop backgroundImage={backgroundImage} /><ScoreLoading label="Checking scorer access…" /></div>;
  if (!session.authenticated) return <ScorerLogin logo={logo} backgroundImage={backgroundImage} session={session} />;
  return children(session);
}

const playersForTeam = (options, teamId) => (
  options.find((team) => idOf(team) === idOf(teamId))?.players || []
);

function ScorerDashboard({ logo, backgroundImage, session }) {
  const navigate = useNavigate();
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const loadGenerationRef = useRef(0);
  const [form, setForm] = useState({
    title: '',
    teamAId: '',
    teamBId: '',
    venue: '',
    scheduledAt: '',
    oversPerInnings: 10,
    maxOversPerBowler: 2,
    maxWickets: 10
  });
  const selectedTeamA = teams.find((team) => idOf(team) === form.teamAId);
  const selectedTeamB = teams.find((team) => idOf(team) === form.teamBId);
  const squadWicketLimit = selectedTeamA && selectedTeamB
    ? Math.max(1, Math.min(10, (selectedTeamA.players?.length || 0) - 1, (selectedTeamB.players?.length || 0) - 1))
    : 10;

  useEffect(() => {
    if (!selectedTeamA || !selectedTeamB) return;
    setForm((current) => {
      const nextWickets = Math.min(Number(current.maxWickets || squadWicketLimit), squadWicketLimit);
      return Number(current.maxWickets) === nextWickets ? current : { ...current, maxWickets: nextWickets };
    });
  }, [form.teamAId, form.teamBId, selectedTeamA?.players?.length, selectedTeamB?.players?.length, squadWicketLimit]);

  const loadDashboardData = useCallback(async ({ quiet = false } = {}) => {
    const generation = ++loadGenerationRef.current;
    if (!quiet) setLoading(true);
    try {
      const [matchesData, optionsData] = await Promise.all([
        fetchAllMatches(),
        apiRequest('/scoring/options', { cache: 'no-store' })
      ]);
      if (generation !== loadGenerationRef.current) return;
      setMatches(matchesData.matches || []);
      setTeams(optionsData.teams || []);
      setFeedback('');
    } catch (loadError) {
      if (generation !== loadGenerationRef.current) return;
      if (!quiet) setFeedback(loadError.message || 'Unable to load scoring data.');
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
    return () => { loadGenerationRef.current += 1; };
  }, [loadDashboardData]);
  useScoringLiveRefresh(loadDashboardData, { connectStream: false });

  const createMatch = async (event) => {
    event.preventDefault();
    if (!form.teamAId || !form.teamBId || form.teamAId === form.teamBId) {
      setFeedback('Choose two different teams.');
      return;
    }
    if ((selectedTeamA?.players?.length || 0) < 2 || (selectedTeamB?.players?.length || 0) < 2) {
      setFeedback('Each team needs at least two database players before a match can be created.');
      return;
    }
    setCreating(true);
    setFeedback('');
    try {
      const data = await apiRequest('/matches', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          oversPerInnings: Number(form.oversPerInnings),
          maxOversPerBowler: Number(form.maxOversPerBowler),
          maxWickets: Math.min(Number(form.maxWickets), squadWicketLimit),
          scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined
        })
      }, session.auth);
      const match = data.match || data;
      dispatchScoringChange(idOf(match));
      navigate(`/scorer/${idOf(match)}`);
    } catch (createError) {
      if (createError.status === 401 || createError.status === 403) session.logout();
      else setFeedback(createError.message || 'Unable to create match.');
    } finally {
      setCreating(false);
    }
  };

  const orderedMatches = useMemo(() => [...matches].sort((a, b) => {
    const rank = (item) => isLiveMatch(item) ? 0 : isDraftMatch(item) ? 1 : isCompleteMatch(item) ? 3 : 2;
    return rank(a) - rank(b) || new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
  }), [matches]);

  return (
    <CricketShell logo={logo} backgroundImage={backgroundImage} scorer onLogout={session.logout}>
      <main className="cricket-page scorer-dashboard">
        <section className="scorer-dashboard-hero">
          <div><span className="cricket-kicker">SCORING CONTROL</span><h1>Match scoring</h1><p>Each match keeps its own innings and delivery history, so multiple matches can run at the same time.</p></div>
          <button type="button" onClick={() => setShowCreate((shown) => !shown)}>{showCreate ? 'Close setup' : '+ Create match'}</button>
        </section>

        {showCreate ? <form className="create-match-form" onSubmit={createMatch}>
          <header><div><span>NEW MATCH</span><h2>Match setup</h2></div><small>Teams and players are loaded from the database.</small></header>
          <div className="create-match-grid">
            <label>Match title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Optional match title" /></label>
            <label>Venue<input value={form.venue} onChange={(event) => setForm({ ...form, venue: event.target.value })} placeholder="Ground or venue" /></label>
            <label>Team A*
              <select required value={form.teamAId} onChange={(event) => setForm({ ...form, teamAId: event.target.value })}>
                <option value="">Choose team</option>
                {teams.map((team) => <option value={idOf(team)} key={idOf(team)} disabled={idOf(team) === form.teamBId}>{team.name} ({team.players?.length || 0} players)</option>)}
              </select>
            </label>
            <label>Team B*
              <select required value={form.teamBId} onChange={(event) => setForm({ ...form, teamBId: event.target.value })}>
                <option value="">Choose team</option>
                {teams.map((team) => <option value={idOf(team)} key={idOf(team)} disabled={idOf(team) === form.teamAId}>{team.name} ({team.players?.length || 0} players)</option>)}
              </select>
            </label>
            <label>Overs per innings*<input required type="number" min="1" max="100" value={form.oversPerInnings} onChange={(event) => setForm({ ...form, oversPerInnings: event.target.value })} /></label>
            <label>Maximum overs per bowler*<input required type="number" min="1" max={Math.max(1, Number(form.oversPerInnings || 1))} value={form.maxOversPerBowler} onChange={(event) => setForm({ ...form, maxOversPerBowler: event.target.value })} /><small>Example: enter 3 to allow each bowler a maximum of 3 overs.</small></label>
            <label>Wickets per innings*<input required type="number" min="1" max={squadWicketLimit} value={form.maxWickets} onChange={(event) => setForm({ ...form, maxWickets: event.target.value })} /><small>Maximum {squadWicketLimit} for the selected squads.</small></label>
            <label className="create-date-field">Scheduled time<input type="datetime-local" value={form.scheduledAt} onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })} /></label>
          </div>
          {(form.teamAId || form.teamBId) ? <div className="team-roster-preview">
            {[form.teamAId, form.teamBId].filter(Boolean).map((teamId) => {
              const team = teams.find((item) => idOf(item) === teamId);
              return <div key={teamId}><strong>{team?.name}</strong><span>{(team?.players || []).map((player) => player.name).join(', ') || 'No sold players in this team yet.'}</span></div>;
            })}
          </div> : null}
          <button className="create-match-submit" type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create and open scorer'}</button>
        </form> : null}

        {feedback ? <p className="scorer-feedback" role="status">{feedback}</p> : null}
        {loading ? <ScoreLoading label="Loading scorer matches…" /> : null}
        {!loading && !orderedMatches.length ? <ScoreEmpty title="No matches created" text="Create the first match to start live scoring." /> : null}
        {orderedMatches.length ? <div className="scorer-match-grid">{orderedMatches.map((match) => <MatchCard match={match} scorer key={match._id || match.id} />)}</div> : null}
      </main>
    </CricketShell>
  );
}

export function ScorerDashboardPage({ logo, backgroundImage }) {
  return <ScorerProtected logo={logo} backgroundImage={backgroundImage}>{(session) => <ScorerDashboard logo={logo} backgroundImage={backgroundImage} session={session} />}</ScorerProtected>;
}

const emptyDelivery = {
  runsOffBat: 0,
  runningRuns: '',
  wide: 0,
  noBall: 0,
  bye: 0,
  legBye: 0,
  penalty: 0,
  wicket: false,
  wicketKind: 'bowled',
  dismissedBatterId: '',
  creditedToBowler: true,
  note: ''
};

function PlayerOption({ player, disabled = false, suffix = '' }) {
  return <option value={idOf(player)} disabled={disabled}>{player.name}{player.category ? ` · ${player.category}` : ''}{suffix}</option>;
}

function ParticipantSelectors({
  battingPlayers,
  bowlingPlayers,
  selection,
  onChange,
  disabled = false,
  disabledBowlerIds = new Set(),
  bowlerUsage = new Map(),
  prefix = ''
}) {
  const inputId = (name) => `${prefix}-${name}`;
  return (
    <div className="participant-selectors">
      <label htmlFor={inputId('striker')}>Striker
        <select id={inputId('striker')} disabled={disabled} value={selection.strikerId} onChange={(event) => onChange({ ...selection, strikerId: event.target.value })}>
          <option value="">Select striker</option>
          {battingPlayers.map((player) => <PlayerOption player={player} key={idOf(player)} />)}
        </select>
      </label>
      <label htmlFor={inputId('non-striker')}>Non-striker
        <select id={inputId('non-striker')} disabled={disabled} value={selection.nonStrikerId} onChange={(event) => onChange({ ...selection, nonStrikerId: event.target.value })}>
          <option value="">Select non-striker</option>
          {battingPlayers.map((player) => <PlayerOption player={player} key={idOf(player)} />)}
        </select>
      </label>
      <label htmlFor={inputId('bowler')}>Bowler
        <select id={inputId('bowler')} disabled={disabled} value={selection.bowlerId} onChange={(event) => onChange({ ...selection, bowlerId: event.target.value })}>
          <option value="">Select bowler</option>
          {bowlingPlayers.map((player) => {
            const usage = bowlerUsage.get(idOf(player));
            const suffix = usage?.maximumOvers ? ` · ${usage.overs}/${usage.maximumOvers} overs${usage.exhausted ? ' · limit reached' : ''}` : '';
            return <PlayerOption player={player} disabled={disabledBowlerIds.has(idOf(player))} suffix={suffix} key={idOf(player)} />;
          })}
        </select>
      </label>
    </div>
  );
}

function MatchRoster({ team, players }) {
  return <article className="scorer-roster-card">
    <header><TeamMark team={team} size="small" /><div><strong>{textOf(team?.name)}</strong><small>{players.length} players from database</small></div></header>
    <div>{players.length ? players.map((player) => <span key={idOf(player)}><PlayerPhoto player={player} /><i><strong>{player.name}</strong><small>{player.category || player.battingStyle || player.bowlingStyle || 'Player'}</small></i></span>) : <p>No players are assigned to this team.</p>}</div>
  </article>;
}

function ScorerSetup({ match, teams, pending, mutate }) {
  const teamA = teamFromMatch(match, 'teamA');
  const teamB = teamFromMatch(match, 'teamB');
  const teamAPlayers = playersForMatchTeam(match, teams, teamA);
  const teamBPlayers = playersForMatchTeam(match, teams, teamB);
  const [battingTeamId, setBattingTeamId] = useState(idOf(teamA));
  const [tossWinnerTeamId, setTossWinnerTeamId] = useState(idOf(teamA));
  const [tossDecision, setTossDecision] = useState('bat');
  const battingPlayers = battingTeamId === idOf(teamA) ? teamAPlayers : teamBPlayers;
  const bowlingPlayers = battingTeamId === idOf(teamA) ? teamBPlayers : teamAPlayers;
  const [selection, setSelection] = useState({ strikerId: '', nonStrikerId: '', bowlerId: '' });

  useEffect(() => {
    const otherTeamId = tossWinnerTeamId === idOf(teamA) ? idOf(teamB) : idOf(teamA);
    setBattingTeamId(tossDecision === 'bat' ? tossWinnerTeamId : otherTeamId);
  }, [tossDecision, tossWinnerTeamId, idOf(teamA), idOf(teamB)]);

  useEffect(() => {
    setSelection({ strikerId: '', nonStrikerId: '', bowlerId: '' });
  }, [battingTeamId]);

  const start = async (event) => {
    event.preventDefault();
    if (!selection.strikerId || !selection.nonStrikerId || !selection.bowlerId) return;
    if (selection.strikerId === selection.nonStrikerId) return;
    await mutate(`/matches/${idOf(match)}/start`, 'POST', {
      battingTeamId,
      tossWinnerTeamId,
      tossDecision,
      ...selection
    }, 'Match started. First ball is ready.');
  };

  return (
    <section className="scorer-setup-panel">
      <header><span className="scorer-step">1</span><div><span className="cricket-kicker">PRE-MATCH</span><h2>Select opening players</h2><p>Squads below come directly from the saved auction teams.</p></div></header>
      <div className="scorer-roster-grid"><MatchRoster team={teamA} players={teamAPlayers} /><MatchRoster team={teamB} players={teamBPlayers} /></div>
      <form onSubmit={start}>
        <div className="match-start-settings">
          <label>Toss winner
            <select value={tossWinnerTeamId} onChange={(event) => setTossWinnerTeamId(event.target.value)}>
              <option value={idOf(teamA)}>{textOf(teamA.name)}</option>
              <option value={idOf(teamB)}>{textOf(teamB.name)}</option>
            </select>
          </label>
          <label>Toss decision
            <select value={tossDecision} onChange={(event) => setTossDecision(event.target.value)}>
              <option value="bat">Bat</option>
              <option value="bowl">Bowl</option>
            </select>
          </label>
          <label>Batting first
            <select value={battingTeamId} onChange={(event) => setBattingTeamId(event.target.value)}>
              <option value={idOf(teamA)}>{textOf(teamA.name)}</option>
              <option value={idOf(teamB)}>{textOf(teamB.name)}</option>
            </select>
          </label>
        </div>
        <ParticipantSelectors prefix="start" battingPlayers={battingPlayers} bowlingPlayers={bowlingPlayers} selection={selection} onChange={setSelection} disabled={pending} />
        {selection.strikerId && selection.strikerId === selection.nonStrikerId ? <p className="scorer-form-error">Striker and non-striker must be different players.</p> : null}
        <button type="submit" disabled={pending || !selection.strikerId || !selection.nonStrikerId || !selection.bowlerId || selection.strikerId === selection.nonStrikerId}>{pending ? 'Starting…' : 'Start match'}</button>
      </form>
    </section>
  );
}

function BowlerLimitAdjustment({ match, pending, mutate }) {
  const currentLimit = Number(match?.maxOversPerBowler || 1);
  const [maximum, setMaximum] = useState(currentLimit);

  useEffect(() => {
    setMaximum(currentLimit);
  }, [currentLimit, idOf(match)]);

  const save = async (event) => {
    event.preventDefault();
    await mutate(
      `/matches/${idOf(match)}`,
      'PATCH',
      { maxOversPerBowler: Number(maximum) },
      `Bowler limit updated to ${maximum} over${Number(maximum) === 1 ? '' : 's'}.`
    );
  };

  return (
    <section className="bowler-limit-adjustment">
      <div>
        <span className="cricket-kicker">BOWLING RULE</span>
        <strong>Maximum overs per bowler</strong>
        <small>Can be adjusted during a live match, but never below overs already bowled.</small>
      </div>
      <form onSubmit={save}>
        <input
          aria-label="Maximum overs per bowler"
          type="number"
          min="1"
          max={Number(match?.oversPerInnings || 100)}
          value={maximum}
          onChange={(event) => setMaximum(event.target.value)}
          disabled={pending}
        />
        <button type="submit" disabled={pending || !maximum || Number(maximum) === currentLimit}>
          {pending ? 'Saving…' : 'Update limit'}
        </button>
      </form>
    </section>
  );
}

function LineupCorrection({ match, innings, battingPlayers, bowlingPlayers, pending, mutate, required = false }) {
  const current = useMemo(() => ({
    strikerId: currentParticipantId(match, innings, 'striker'),
    nonStrikerId: currentParticipantId(match, innings, 'nonStriker'),
    bowlerId: currentParticipantId(match, innings, 'bowler')
  }), [match, innings]);
  const [selection, setSelection] = useState(current);
  const [open, setOpen] = useState(false);
  const bowlerUsage = new Map(
    bowlingPlayers.map((player) => [idOf(player), bowlerLimitStatus(match, innings, player)])
  );
  const disabledBowlerIds = new Set(
    [...bowlerUsage.entries()].filter(([, usage]) => usage.exhausted).map(([playerId]) => playerId)
  );

  useEffect(() => { setSelection(current); }, [current.strikerId, current.nonStrikerId, current.bowlerId]);
  useEffect(() => {
    if (required) setOpen(true);
  }, [required]);

  const save = async (event) => {
    event.preventDefault();
    const ok = await mutate(`/matches/${idOf(match)}/lineup`, 'PATCH', selection, 'Active players updated.');
    if (ok) setOpen(false);
  };

  return (
    <section className={`lineup-correction ${open ? 'open' : ''}`}>
      <button type="button" className="lineup-toggle" onClick={() => setOpen((shown) => !shown)}>{open ? 'Close player correction' : 'Change striker / bowler'}</button>
      {open ? <form onSubmit={save}>
        <p>Use this only to correct the active players. It does not add a delivery.</p>
        <ParticipantSelectors prefix="correct" battingPlayers={battingPlayers} bowlingPlayers={bowlingPlayers} selection={selection} onChange={setSelection} disabled={pending} disabledBowlerIds={disabledBowlerIds} bowlerUsage={bowlerUsage} />
        <button type="submit" disabled={pending || !selection.strikerId || !selection.nonStrikerId || !selection.bowlerId || selection.strikerId === selection.nonStrikerId}>Save active players</button>
      </form> : null}
    </section>
  );
}

function NextBowlerPopup({
  match,
  innings,
  battingPlayers,
  bowlingPlayers,
  needsBatter,
  pending,
  mutate,
  open
}) {
  const deliveries = deliveryList(innings, match);
  const lastDelivery = deliveries[deliveries.length - 1];
  const previousBowlerId = idOf(lastDelivery?.bowler || lastDelivery?.bowlerId);
  const eligibleBowlers = bowlingPlayers.filter(
    (player) => !bowlerLimitStatus(match, innings, player).exhausted
  );
  const alternateBowlers = eligibleBowlers.filter((player) => idOf(player) !== previousBowlerId);
  const selectableBowlers = alternateBowlers.length ? alternateBowlers : eligibleBowlers;
  const [bowlerId, setBowlerId] = useState('');
  const [batterId, setBatterId] = useState('');

  useEffect(() => {
    if (open) {
      setBowlerId('');
      setBatterId('');
    }
  }, [open, idOf(innings), deliveries.length]);

  if (!open) return null;

  const submit = async (event) => {
    event.preventDefault();
    let strikerId = currentParticipantId(match, innings, 'striker');
    let nonStrikerId = currentParticipantId(match, innings, 'nonStriker');
    if (needsBatter && batterId) {
      if (!strikerId) strikerId = batterId;
      else if (!nonStrikerId) nonStrikerId = batterId;
    }
    await mutate(`/matches/${idOf(match)}/lineup`, 'PATCH', {
      strikerId,
      nonStrikerId,
      bowlerId
    }, 'Next bowler selected. The new over is ready.');
  };

  return (
    <div className="next-bowler-backdrop" role="presentation">
      <section className="next-bowler-popup" role="dialog" aria-modal="true" aria-labelledby="next-bowler-title">
        <span className="next-bowler-ball" aria-hidden="true">6</span>
        <span className="cricket-kicker">OVER COMPLETE</span>
        <h2 id="next-bowler-title">Select the next bowler</h2>
        <p>The score is saved. Choose a bowler before recording the next over.</p>
        <form onSubmit={submit}>
          <fieldset className="bowler-photo-picker">
            <legend>Next bowler</legend>
            {selectableBowlers.length ? <div>{selectableBowlers.map((player) => {
              const usage = bowlerLimitStatus(match, innings, player);
              return <button type="button" className={bowlerId === idOf(player) ? 'selected' : ''} aria-pressed={bowlerId === idOf(player)} onClick={() => setBowlerId(idOf(player))} key={`next-bowler-${idOf(player)}`}>
                <PlayerPhoto player={player} size="medium" />
                <span><strong>{playerName(player)}</strong><small>{usage.overs}{usage.maximumOvers ? ` / ${usage.maximumOvers}` : ''} overs</small></span>
              </button>;
            })}</div> : <p className="bowler-limit-error">Every available bowler has reached the configured over limit.</p>}
          </fieldset>
          {needsBatter ? <label>Next batter
            <select value={batterId} onChange={(event) => setBatterId(event.target.value)} required>
              <option value="">Choose batter</option>
              {battingPlayers.map((player) => <PlayerOption player={player} key={`next-over-batter-${idOf(player)}`} />)}
            </select>
          </label> : null}
          {previousBowlerId && alternateBowlers.length ? <small>The previous-over bowler is excluded. Players at their over limit are unavailable.</small> : null}
          <button type="submit" disabled={pending || !bowlerId || (needsBatter && !batterId)}>{pending ? 'Saving…' : 'Start next over'}</button>
        </form>
      </section>
    </div>
  );
}

function QuickScoring({ pending, terminal, submitDelivery, openAdvanced, advancedOpen = false }) {
  const score = (runsOffBat) => submitDelivery({ ...emptyDelivery, runsOffBat });
  return (
    <section className={`quick-scoring ${advancedOpen ? 'advanced-open' : ''}`}>
      <header><div><span className="cricket-kicker">NEXT DELIVERY</span><h2>Record ball</h2></div><button type="button" disabled={pending || terminal} className="advanced-score-toggle" onClick={openAdvanced}>Advanced entry</button></header>
      <div className="run-buttons">
        {[0, 1, 2, 3, 4, 6].map((runs) => <button type="button" className={runs === 4 || runs === 6 ? 'boundary' : ''} disabled={pending || terminal} onClick={() => score(runs)} key={runs}><strong>{runs}</strong><span>{runs === 0 ? 'Dot' : runs === 1 ? 'run' : 'runs'}</span></button>)}
      </div>
      <div className="extra-buttons">
        <button type="button" disabled={pending || terminal} onClick={() => submitDelivery({ ...emptyDelivery, wide: 1 })}>+ Wide</button>
        <button type="button" disabled={pending || terminal} onClick={() => submitDelivery({ ...emptyDelivery, noBall: 1 })}>+ No ball</button>
        <button type="button" disabled={pending || terminal} onClick={() => openAdvanced('wicket')}>Wicket</button>
        <button type="button" disabled={pending || terminal} onClick={() => openAdvanced('extras')}>Byes / more</button>
      </div>
      {pending ? <p className="delivery-saving"><span /> Saving delivery — controls are locked</p> : null}
    </section>
  );
}

function DeliveryEditor({ title, value, setValue, battingPlayers, pending, onSubmit, onCancel, submitLabel = 'Record delivery' }) {
  const update = (key, next) => setValue({ ...value, [key]: next });
  const changeWicketKind = (next) => {
    const bowlerKinds = new Set(['bowled', 'caught', 'lbw', 'stumped', 'hit wicket']);
    setValue({ ...value, wicketKind: next, creditedToBowler: bowlerKinds.has(next) });
  };
  return (
    <form className="delivery-editor" onSubmit={onSubmit}>
      <header><h3>{title}</h3>{onCancel ? <button type="button" onClick={onCancel} aria-label="Close editor">×</button> : null}</header>
      <div className="delivery-editor-grid">
        <label>Runs off bat<input type="number" min="0" max="6" value={value.runsOffBat} onChange={(event) => update('runsOffBat', event.target.value)} /></label>
        <label>Completed running runs<input type="number" min="0" max="12" value={value.runningRuns} onChange={(event) => update('runningRuns', event.target.value)} placeholder="Optional" /><small>Physical runs completed; extras stay separate.</small></label>
        <label>Wide<input type="number" min="0" max="20" value={value.wide} onChange={(event) => update('wide', event.target.value)} /></label>
        <label>No ball<input type="number" min="0" max="20" value={value.noBall} onChange={(event) => update('noBall', event.target.value)} /></label>
        <label>Bye<input type="number" min="0" max="20" value={value.bye} onChange={(event) => update('bye', event.target.value)} /></label>
        <label>Leg bye<input type="number" min="0" max="20" value={value.legBye} onChange={(event) => update('legBye', event.target.value)} /></label>
        <label>Penalty<input type="number" min="0" max="20" value={value.penalty} onChange={(event) => update('penalty', event.target.value)} /></label>
      </div>
      <label className="wicket-check"><input type="checkbox" checked={value.wicket} onChange={(event) => update('wicket', event.target.checked)} /><span>Wicket on this delivery</span></label>
      {value.wicket ? <div className="wicket-fields">
        <label>Dismissal
          <select value={value.wicketKind} onChange={(event) => changeWicketKind(event.target.value)}>
            {['bowled', 'caught', 'lbw', 'stumped', 'run out', 'hit wicket', 'obstructing field', 'hit ball twice'].map((kind) => <option value={kind} key={kind}>{kind.replace(/\b\w/g, (letter) => letter.toUpperCase())}</option>)}
          </select>
        </label>
        <label>Player out
          <select required value={value.dismissedBatterId} onChange={(event) => update('dismissedBatterId', event.target.value)}>
            <option value="">Select batter</option>
            {battingPlayers.map((player) => <PlayerOption player={player} key={idOf(player)} />)}
          </select>
        </label>
        <label className="credit-bowler"><input type="checkbox" checked={value.creditedToBowler} onChange={(event) => update('creditedToBowler', event.target.checked)} /><span>Credit wicket to bowler</span></label>
      </div> : null}
      <label>Scorer note<textarea rows="2" value={value.note} onChange={(event) => update('note', event.target.value)} placeholder="Optional ball note" /></label>
      <button className="delivery-submit" type="submit" disabled={pending || (value.wicket && !value.dismissedBatterId)}>{pending ? 'Saving…' : submitLabel}</button>
    </form>
  );
}

const deliveryToForm = (delivery) => {
  const extras = delivery?.extras || {};
  const wicket = wicketDetails(delivery);
  return {
    ...emptyDelivery,
    runsOffBat: numberOf(delivery?.runsOffBat, delivery?.runs?.bat),
    runningRuns: delivery?.runningRuns ?? '',
    wide: numberOf(extras.wide, extras.wides),
    noBall: numberOf(extras.noBall, extras.noBalls),
    bye: numberOf(extras.bye, extras.byes),
    legBye: numberOf(extras.legBye, extras.legByes),
    penalty: numberOf(extras.penalty),
    wicket: Boolean(wicket),
    wicketKind: wicket?.kind || 'bowled',
    dismissedBatterId: idOf(wicket?.dismissedBatter || wicket?.dismissedBatterId || delivery?.dismissedBatter),
    creditedToBowler: wicket?.creditedToBowler !== false,
    note: delivery?.note || ''
  };
};

const deliveryPayload = (form) => ({
  runsOffBat: Number(form.runsOffBat || 0),
  ...(form.runningRuns === '' ? {} : { runningRuns: Number(form.runningRuns || 0) }),
  extras: {
    wide: Number(form.wide || 0),
    noBall: Number(form.noBall || 0),
    bye: Number(form.bye || 0),
    legBye: Number(form.legBye || 0),
    penalty: Number(form.penalty || 0)
  },
  wicket: form.wicket
    ? {
      kind: form.wicketKind,
      dismissedBatterId: form.dismissedBatterId,
      creditedToBowler: Boolean(form.creditedToBowler)
    }
    : null,
  note: form.note?.trim() || ''
});

const deliveryValidationError = (form) => {
  const runs = Number(form.runsOffBat || 0);
  const wide = Number(form.wide || 0);
  const noBall = Number(form.noBall || 0);
  const bye = Number(form.bye || 0);
  const legBye = Number(form.legBye || 0);
  const penalty = Number(form.penalty || 0);
  const total = runs + wide + noBall + bye + legBye + penalty;
  const running = form.runningRuns === '' ? null : Number(form.runningRuns || 0);
  const kind = String(form.wicketKind || '').trim().toLowerCase().replace(/\s+/g, '-');
  const bowlerKinds = new Set(['bowled', 'caught', 'lbw', 'stumped', 'hit-wicket']);
  if (wide && noBall) return 'A delivery cannot be both a wide and a no ball.';
  if (bye && legBye) return 'Choose either byes or leg byes, not both.';
  if (wide && (runs || bye || legBye)) return 'Runs off the bat, byes and leg byes cannot be combined with a wide.';
  if (runs && (bye || legBye)) return 'Runs off the bat cannot be combined with byes or leg byes.';
  if (running !== null && running > total) return 'Completed running runs cannot exceed the total runs on this delivery.';
  if (form.wicket && form.creditedToBowler && !bowlerKinds.has(kind)) return 'This dismissal cannot be credited to the bowler.';
  if (form.wicket && noBall && !['run-out', 'obstructing-field', 'hit-ball-twice'].includes(kind)) {
    return 'Only a run out, obstructing the field, or hit ball twice can be recorded on a no ball.';
  }
  if (form.wicket && wide && !['run-out', 'stumped', 'hit-wicket', 'obstructing-field'].includes(kind)) {
    return 'This dismissal is not valid on a wide.';
  }
  return '';
};

function DeliveryHistory({ match, innings, battingPlayers, pending, mutate, allowUndo = true }) {
  const rows = deliveryList(innings, match);
  const inningsNumber = Number(innings?.number || 1);
  const groups = commentaryOvers(match).filter((group) => group.inningsNumber === inningsNumber);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyDelivery);

  useEffect(() => {
    setEditing(null);
  }, [idOf(innings)]);

  const beginEdit = (delivery) => {
    setEditing(delivery);
    setForm(deliveryToForm(delivery));
  };

  const save = async (event) => {
    event.preventDefault();
    const deliveryId = idOf(editing);
    const ok = await mutate(`/matches/${idOf(match)}/deliveries/${deliveryId}`, 'PATCH', deliveryPayload(form), 'Delivery corrected.');
    if (ok) setEditing(null);
  };

  const undo = async () => {
    if (!rows.length || !window.confirm('Undo the last recorded delivery?')) return;
    await mutate(`/matches/${idOf(match)}/deliveries/last`, 'DELETE', {}, 'Last delivery removed.');
  };

  return (
    <section className="delivery-history">
      <header><div><span className="cricket-kicker">SAVED INPUT</span><h2>Innings {innings?.number || ''} delivery log</h2></div>{allowUndo ? <button type="button" className="undo-delivery" disabled={pending || !rows.length} onClick={undo}>↶ Undo last ball</button> : null}</header>
      {editing ? <DeliveryEditor title="Correct delivery" value={form} setValue={setForm} battingPlayers={battingPlayers} pending={pending} onSubmit={save} onCancel={() => setEditing(null)} submitLabel="Save correction" /> : null}
      {groups.length ? <div className="delivery-history-overs">{groups.map((group) => {
        const deliveryRows = <div className="delivery-history-list">{group.deliveries.map((delivery, index) => (
          <article key={delivery._id || delivery.id || `${group.overNumber}-${delivery.deliveryIndex ?? index}`}>
            <span>{delivery.displayBall || delivery.overLabel || delivery.ballLabel || `${delivery.over ?? '—'}.${delivery.ball ?? '—'}`}</span>
            <i className={wicketDetails(delivery) ? 'wicket' : ''}>{deliveryLabel(delivery)}</i>
            <p>{commentaryText(delivery)}</p>
            <button type="button" disabled={pending} onClick={() => beginEdit(delivery)}>Edit</button>
          </article>
        ))}</div>;
        return group.current ? (
          <section className="over-commentary scorer-over current" key={`scorer-${group.inningsNumber}-${group.overNumber}`}>
            <header><OverCommentaryHeading group={group} /></header>
            {deliveryRows}
          </section>
        ) : (
          <details className="over-commentary scorer-over completed" key={`scorer-${group.inningsNumber}-${group.overNumber}`}>
            <summary><OverCommentaryHeading group={group} /><i aria-hidden="true">⌄</i></summary>
            {deliveryRows}
          </details>
        );
      })}</div> : <p className="commentary-empty">No delivery has been recorded in this innings.</p>}
    </section>
  );
}

function InningsTransition({ match, teams, pending, mutate }) {
  const teamA = teamFromMatch(match, 'teamA');
  const first = inningsList(match)[0];
  const battingTeamId = inningsBattingTeamId(first) === idOf(teamA) ? idOf(teamFromMatch(match, 'teamB')) : idOf(teamA);
  const battingPlayers = playersForMatchTeam(match, teams, battingTeamId);
  const bowlingTeamId = battingTeamId === idOf(teamA) ? idOf(teamFromMatch(match, 'teamB')) : idOf(teamA);
  const bowlingPlayers = playersForMatchTeam(match, teams, bowlingTeamId);
  const [selection, setSelection] = useState({ strikerId: '', nonStrikerId: '', bowlerId: '' });

  const submit = async (event) => {
    event.preventDefault();
    await mutate(`/matches/${idOf(match)}/next-innings`, 'POST', selection, 'Second innings started.');
  };

  return (
    <section className="innings-transition">
      <span className="scorer-step">2</span>
      <div><span className="cricket-kicker">INNINGS BREAK</span><h2>Set the chase</h2><p>Select the opening batters and bowler for the second innings.</p></div>
      <form onSubmit={submit}>
        <ParticipantSelectors prefix="next" battingPlayers={battingPlayers} bowlingPlayers={bowlingPlayers} selection={selection} onChange={setSelection} disabled={pending} />
        <button type="submit" disabled={pending || !selection.strikerId || !selection.nonStrikerId || !selection.bowlerId || selection.strikerId === selection.nonStrikerId}>{pending ? 'Starting…' : 'Start second innings'}</button>
      </form>
    </section>
  );
}

function CompleteMatchPanel({ match, teams, pending, mutate }) {
  const teamA = teamFromMatch(match, 'teamA');
  const teamB = teamFromMatch(match, 'teamB');
  const players = [
    ...playersForMatchTeam(match, teams, teamA),
    ...playersForMatchTeam(match, teams, teamB)
  ];
  const playersById = new Map(players.map((player) => [idOf(player), player]));
  const bowlerIds = new Set(inningsList(match).flatMap((innings) => (
    bowlingRows(innings).map((row) => playerId(row)).filter(Boolean)
  )));
  const bowlers = [...bowlerIds].map((id) => playersById.get(id)).filter(Boolean);
  const [awards, setAwards] = useState({
    manOfMatchPlayerId: idOf(match?.awards?.manOfMatch || match?.awards?.manOfTheMatch),
    bestBowlerPlayerId: idOf(match?.awards?.bestBowler)
  });

  const complete = async (event) => {
    event.preventDefault();
    const alreadyComplete = isCompleteMatch(match);
    if (!alreadyComplete && !window.confirm('Complete this match? Scoring will be locked after completion.')) return;
    await mutate(
      alreadyComplete ? `/matches/${idOf(match)}` : `/matches/${idOf(match)}/complete`,
      alreadyComplete ? 'PATCH' : 'POST',
      awards,
      alreadyComplete ? 'Match awards saved.' : 'Match completed and awards saved.'
    );
  };

  return (
    <section className="complete-match-panel">
      <span className="scorer-step">3</span>
      <div><span className="cricket-kicker">FINAL RESULT</span><h2>Complete match and save awards</h2><p>The result, Man of the Match and Best Bowler are saved permanently with this match.</p></div>
      <form onSubmit={complete}>
        <label>Man of the Match
          <select required value={awards.manOfMatchPlayerId} onChange={(event) => setAwards({ ...awards, manOfMatchPlayerId: event.target.value })}>
            <option value="">Select player</option>
            {players.map((player) => <PlayerOption player={player} key={`mom-${idOf(player)}`} />)}
          </select>
        </label>
        <label>Best Bowler
          <select required value={awards.bestBowlerPlayerId} onChange={(event) => setAwards({ ...awards, bestBowlerPlayerId: event.target.value })}>
            <option value="">Select bowler</option>
            {bowlers.map((player) => <PlayerOption player={player} key={`bowler-${idOf(player)}`} />)}
          </select>
        </label>
        <button type="submit" disabled={pending || !awards.manOfMatchPlayerId || !awards.bestBowlerPlayerId}>{pending ? 'Saving…' : isCompleteMatch(match) ? 'Save awards' : 'Complete match'}</button>
      </form>
    </section>
  );
}

function ScorerMatchConsole({ logo, backgroundImage, session }) {
  const { matchId } = useParams();
  const [match, setMatch] = useState(null);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [delivery, setDelivery] = useState(emptyDelivery);
  const mutationLockRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const deliveryRequestRef = useRef(null);
  const sourceIdRef = useRef(createRequestId());

  const load = useCallback(async ({ quiet = false } = {}) => {
    const generation = ++loadGenerationRef.current;
    if (!quiet) setLoading(true);
    try {
      const matchData = await apiRequest(`/matches/${matchId}`, { cache: 'no-store' });
      if (generation !== loadGenerationRef.current) return;
      setIfCurrentRevision(setMatch, matchData.match || matchData);
      setError('');
    } catch (loadError) {
      if (generation !== loadGenerationRef.current) return;
      if (!quiet) setError(loadError.message || 'Unable to open this match.');
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    loadGenerationRef.current += 1;
    setMatch(null);
    setFeedback('');
    setError('');
    setAdvancedOpen(false);
    setDelivery(emptyDelivery);
    deliveryRequestRef.current = null;
    apiRequest('/scoring/options', { cache: 'no-store' })
      .then((data) => setTeams(data.teams || []))
      .catch((optionsError) => {
        if (optionsError.status === 401 || optionsError.status === 403) session.logout();
        else setError(optionsError.message || 'Unable to load team players.');
      });
    load();
  }, [load]);
  useScoringLiveRefresh(load, {
    matchId,
    connectStream: false,
    intervalMs: 2500,
    sourceId: sourceIdRef.current
  });

  const mutate = useCallback(async (path, method, payload, successMessage) => {
    if (mutationLockRef.current || !match) return false;
    mutationLockRef.current = true;
    setPending(true);
    setFeedback('');
    try {
      const body = {
        ...payload,
        expectedRevision: match.revision
      };
      if (method === 'POST' && path.endsWith('/deliveries') && !body.clientRequestId) {
        body.clientRequestId = createRequestId();
      }
      const data = await apiRequest(path, {
        method,
        headers: { 'x-live-source': sourceIdRef.current },
        body: JSON.stringify(body)
      }, session.auth);
      if (data.match) setIfCurrentRevision(setMatch, data.match);
      else await load({ quiet: true });
      setFeedback(successMessage || data.message || 'Saved.');
      dispatchScoringChange(matchId, sourceIdRef.current);
      return true;
    } catch (mutationError) {
      if (mutationError.status === 401 || mutationError.status === 403) {
        session.logout();
      } else if (mutationError.status === 409) {
        setFeedback('The score changed in another scorer window. Latest match data has been loaded; please check it before trying again.');
        await load({ quiet: true });
      } else {
        setFeedback(mutationError.message || 'Scoring update failed.');
      }
      return false;
    } finally {
      mutationLockRef.current = false;
      setPending(false);
    }
  }, [load, match, matchId, session.auth]);

  const innings = currentInningsOf(match);
  const teamA = teamFromMatch(match, 'teamA');
  const battingTeamId = inningsBattingTeamId(innings);
  const battingTeam = battingTeamId === idOf(teamA) ? teamA : teamFromMatch(match, 'teamB');
  const bowlingTeam = battingTeamId === idOf(teamA) ? teamFromMatch(match, 'teamB') : teamA;
  const battingPlayers = playersForMatchTeam(match, teams, battingTeam);
  const bowlingPlayers = playersForMatchTeam(match, teams, bowlingTeam);
  const dismissedBatterIds = new Set(
    battingRows(innings).filter((player) => player.isOut).map((player) => playerId(player))
  );
  const availableBattingPlayers = battingPlayers.filter(
    (player) => !dismissedBatterIds.has(idOf(player))
  );
  const activeBatterIds = new Set([
    currentParticipantId(match, innings, 'striker'),
    currentParticipantId(match, innings, 'nonStriker')
  ].filter(Boolean));
  const activeBattingPlayers = availableBattingPlayers.filter(
    (player) => activeBatterIds.has(idOf(player))
  );
  const inningsComplete = Boolean(
    innings?.completed
    || innings?.terminal
    || innings?.summary?.terminal
    || COMPLETE_STATUSES.has(String(innings?.status || '').toLowerCase())
    || statusKey(match).includes('break')
    || statusKey(match) === 'awaiting_awards'
    || match?.summary?.terminal
  );
  const hasSecondInnings = inningsList(match).length > 1;
  const terminal = isCompleteMatch(match) || inningsComplete;
  const hasActiveBatters = Boolean(
    currentParticipantId(match, innings, 'striker')
    && currentParticipantId(match, innings, 'nonStriker')
  );
  const hasActiveBowler = Boolean(currentParticipantId(match, innings, 'bowler'));
  const needsBatter = Boolean(innings?.needsBatter ?? match?.summary?.needsBatter ?? !hasActiveBatters);
  const needsBowler = Boolean(innings?.needsBowler ?? match?.summary?.needsBowler ?? !hasActiveBowler);
  const canScore = match?.summary?.canScore ?? innings?.canScore ?? (!needsBatter && !needsBowler);
  const needsParticipants = !canScore || needsBatter || needsBowler;
  const currentOverGroup = commentaryOvers(match)
    .find((group) => group.inningsNumber === Number(innings?.number || 1));
  const showNextBowlerPopup = Boolean(
    !terminal
    && needsBowler
    && currentOverGroup?.completed
  );
  const confirmScorerExit = Boolean(match && !isDraftMatch(match) && !isCompleteMatch(match));
  const navigationBlocker = useBlocker(confirmScorerExit);

  useEffect(() => {
    if (navigationBlocker.state !== 'blocked') return;
    const shouldLeave = window.confirm(
      'Scoring is still in progress. Do you want to quit this scoring screen?'
    );
    if (shouldLeave) navigationBlocker.proceed();
    else navigationBlocker.reset();
  }, [navigationBlocker]);

  useEffect(() => {
    if (!confirmScorerExit) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
      
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [confirmScorerExit]);

  const guardedLogout = useCallback(() => {
    if (confirmScorerExit && !window.confirm(
      'Scoring is still in progress. Do you want to lock the scorer and quit?'
    )) return;
    session.logout();
  }, [confirmScorerExit, session.logout]);

  const submitDelivery = async (form) => {
    if (terminal || needsParticipants) return false;
    const validationError = deliveryValidationError(form);
    if (validationError) {
      setFeedback(validationError);
      setAdvancedOpen(true);
      return false;
    }
    const payload = deliveryPayload(form);
    const signature = JSON.stringify(payload);
    if (!deliveryRequestRef.current || deliveryRequestRef.current.signature !== signature) {
      deliveryRequestRef.current = { signature, clientRequestId: createRequestId() };
    }
    const ok = await mutate(`/matches/${matchId}/deliveries`, 'POST', {
      ...payload,
      clientRequestId: deliveryRequestRef.current.clientRequestId
    }, 'Delivery saved.');
    if (ok) {
      deliveryRequestRef.current = null;
      setDelivery(emptyDelivery);
      setAdvancedOpen(false);
    }
    return ok;
  };

  const openAdvanced = (mode) => {
    setDelivery({
      ...emptyDelivery,
      wicket: mode === 'wicket'
    });
    setAdvancedOpen(true);
  };

  const advancedSubmit = (event) => {
    event.preventDefault();
    submitDelivery(delivery);
  };
  const celebration = useDeliveryCelebration(match);
  const winnerCelebration = useWinnerCelebration(match);

  return (
    <CricketShell logo={logo} backgroundImage={backgroundImage} scorer onLogout={guardedLogout}>
      <DeliveryCelebration celebration={celebration} />
      <WinnerCelebration winner={winnerCelebration} />
      <NextBowlerPopup
        match={match}
        innings={innings}
        battingPlayers={availableBattingPlayers}
        bowlingPlayers={bowlingPlayers}
        needsBatter={needsBatter}
        pending={pending}
        mutate={mutate}
        open={showNextBowlerPopup}
      />
      <main className="cricket-page scorer-match-page">
        <div className="scorer-match-breadcrumb"><Link to="/scorer">← All scorer matches</Link></div>
        {loading ? <ScoreLoading label="Loading scoring console…" /> : null}
        {error && !match ? <ScoreError message={error} retry={load} /> : null}
        {match ? <>
          <PublicScoreHero match={match} />
          {feedback ? <p className={`scorer-feedback ${feedback.includes('another scorer') ? 'warning' : ''}`} role="status">{feedback}</p> : null}
          {isCompleteMatch(match) ? <section className="scorer-terminal"><span>✓</span><div><h2>Match completed</h2><p>New balls are locked. The result and awards are public, and authorized score corrections remain available below.</p></div></section> : null}
          {!isCompleteMatch(match) ? <BowlerLimitAdjustment match={match} pending={pending} mutate={mutate} /> : null}
          {isDraftMatch(match) ? <ScorerSetup match={match} teams={teams} pending={pending} mutate={mutate} /> : null}
          {!isDraftMatch(match) && innings && !inningsComplete && !isCompleteMatch(match) ? <>
            <LiveNowPanel match={match} innings={innings} />
            {needsParticipants ? <section className="scorer-action-needed" role="status"><span>!</span><div><strong>Player selection needed</strong><p>{needsBatter && needsBowler ? 'Select the next batter and bowler before recording another delivery.' : needsBatter ? 'Select the next batter before recording another delivery.' : 'Select the bowler for the new over before recording another delivery.'}</p></div></section> : null}
            <LineupCorrection match={match} innings={innings} battingPlayers={availableBattingPlayers} bowlingPlayers={bowlingPlayers} pending={pending} mutate={mutate} required={needsParticipants && !showNextBowlerPopup} />
            <QuickScoring pending={pending} terminal={terminal || needsParticipants} submitDelivery={submitDelivery} openAdvanced={openAdvanced} advancedOpen={advancedOpen} />
            {advancedOpen ? <DeliveryEditor title="Advanced delivery" value={delivery} setValue={setDelivery} battingPlayers={activeBattingPlayers.length ? activeBattingPlayers : availableBattingPlayers} pending={pending} onSubmit={advancedSubmit} onCancel={() => setAdvancedOpen(false)} /> : null}
          </> : null}
          {innings && !isCompleteMatch(match) ? <DeliveryHistory match={match} innings={innings} battingPlayers={battingPlayers} pending={pending} mutate={mutate} /> : null}
          {!isCompleteMatch(match) && inningsComplete && !hasSecondInnings ? <InningsTransition match={match} teams={teams} pending={pending} mutate={mutate} /> : null}
          {((!isCompleteMatch(match) && inningsComplete && hasSecondInnings) || (isCompleteMatch(match) && !hasSavedAwards(match))) ? <CompleteMatchPanel match={match} teams={teams} pending={pending} mutate={mutate} /> : null}
          <section className="scorer-full-scorecard">
            <header><span className="cricket-kicker">MATCH RECORD</span><h2>Saved scorecards</h2></header>
            {inningsList(match).map((item, index) => {
              const itemBattingTeamId = inningsBattingTeamId(item);
              const itemBattingPlayers = playersForMatchTeam(match, teams, itemBattingTeamId);
              const isCurrentInnings = index === Number(match.currentInningsIndex || 0);
              const showHistoricalEditor = isCompleteMatch(match) || !isCurrentInnings;
              return <div className="scorer-innings-record" key={item._id || index}>
                <InningsScorecard match={match} innings={item} number={index + 1} />
                {showHistoricalEditor ? <DeliveryHistory match={match} innings={item} battingPlayers={itemBattingPlayers} pending={pending} mutate={mutate} allowUndo={false} /> : null}
              </div>;
            })}
          </section>
        </> : null}
      </main>
    </CricketShell>
  );
}

export function ScorerMatchPage({ logo, backgroundImage }) {
  return <ScorerProtected logo={logo} backgroundImage={backgroundImage}>{(session) => <ScorerMatchConsole logo={logo} backgroundImage={backgroundImage} session={session} />}</ScorerProtected>;
}
