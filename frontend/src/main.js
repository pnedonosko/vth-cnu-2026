import './style.css';
import SEED_AGENTS from './assets/agents-seed.json';

const ROSTER_SERVICE = import.meta.env.VITE_ROSTER_SERVICE_URL;
const ANALYTICS_SERVICE = import.meta.env.VITE_ANALYTICS_SERVICE_URL;
const MODE_NAME = import.meta.env.VITE_MODE_NAME || 'Development';
let CURRENT_USER_ID = localStorage.getItem('user_id') || 'p-001';

// Resolves a HAL link href to an absolute URL. Server may emit either a
// service-relative href ("/api/v1/rosters/...") or an absolute cross-service href
// ("http://analytics.../submit"). The client must not know which service owns a
// link — that is the whole point of following _links.
export function resolveHalUrl(href) {
    return /^https?:\/\//i.test(href) ? href : `${ROSTER_SERVICE}${href}`;
}

const CLOUD_TIMEOUT_MS = 30000;
const WAKING_HINT_DELAY_MS = 1500;

/**
 * apiFetch — hardened wrapper around fetch() for Cloud Run cold-start resilience.
 *
 * WHY it exists:
 *   - match-analytics-service, roster-service, and rank-calculator-service can
 *     scale to zero instances on Cloud Run (min-instances=0). On first request
 *     after ~15 min of inactivity the JVM + Flyway + Neon SSL handshake takes
 *     several seconds; plain fetch() would fail before downstream boots.
 *   - The frontend must not hardcode service URLs; this wrapper works with URLs
 *     resolved via resolveHalUrl() (absolute cross-service hrefs pass through,
 *     relative hrefs get the ROSTER_SERVICE base prepended).
 *
 * WHAT it does:
 *   1. Applies a 30 s abort timeout (AbortSignal.timeout(30000)) so a request
 *      cannot block forever while a downstream service is cold-starting.
 *   2. Shows a transient "WAKING UP CLOUD SERVICES..." hint in the env badge
 *      after 1.5 s if the request is still pending, then restores the badge.
 *   3. Delegates to native fetch() with merged signal; errors propagate to the
 *      caller for standard try/catch handling.
 *
 * CAVEATS:
 *   - AbortSignal.timeout() is not available in very old browsers; in that case
 *     no timeout is applied (silent fallback).
 *   - This does NOT retry automatically — retry logic lives server-side
 *     (@Retryable on RosterServiceClient / RankCalculatorClient). The frontend
 *     caller is responsible for retry UI if desired.
 *   - The waking timer only updates #env-mode-badge; it does not block or delay
 *     the underlying fetch.
 */
export async function apiFetch(url, options = {}) {
    const envBadge = document.getElementById('env-mode-badge');
    const prevBadgeText = envBadge ? envBadge.innerText : null;
    const wakingTimer = setTimeout(() => {
        if (envBadge) envBadge.innerText = 'WAKING UP CLOUD SERVICES...';
    }, WAKING_HINT_DELAY_MS);
    try {
        const signal = options.signal || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout
            ? AbortSignal.timeout(CLOUD_TIMEOUT_MS)
            : undefined);
        return await fetch(url, signal ? { ...options, signal } : options);
    } finally {
        clearTimeout(wakingTimer);
        if (envBadge && prevBadgeText !== null) {
            envBadge.innerText = prevBadgeText;
        }
    }
}

export function prewarmCloudServices() {
    // Warmup the cloud services by calling their health endpoints
    // This is a fire-and-forget call, so we don't need to wait for it
    if (ROSTER_SERVICE && ROSTER_SERVICE !== 'mock') {
        fetch(`${ROSTER_SERVICE}/health`).catch(() => {});
    }
    if (ANALYTICS_SERVICE && ANALYTICS_SERVICE !== 'mock') {
        fetch(`${ANALYTICS_SERVICE}/health`).catch(() => {});
    }
}

// Mock backend ONLY (used when ROSTER_SERVICE === 'mock'). Mirrors
// RosterController.toHalResponse(): given a roster's current state, it returns the
// _links the real server *would* return. Action handlers read currentRoster._links
// in mock mode exactly as they do against the live backend, so the client logic is
// identical in both modes and this is the single place mock hrefs are defined.
function mockServerLinks(roster) {
    const id = roster.id;
    const links = { self: { href: `/api/v1/rosters/${id}`, method: 'GET' } };
    const members = roster.members || [];
    if (roster.status === 'DRAFT') {
        links.add_agent = { href: `/api/v1/rosters/${id}/agents`, method: 'POST' };
        links.transfer_captain = { href: `/api/v1/rosters/${id}/captain`, method: 'PUT' };
        if (members.length >= 5) links.lock_in = { href: `/api/v1/rosters/${id}/lock`, method: 'POST' };
        for (const m of members) {
            links[`remove_agent_${m.agentKey}`] = { href: `/api/v1/rosters/${id}/agents/${m.agentKey}`, method: 'DELETE' };
        }
    } else if (roster.status === 'LOCKED') {
        links.unlock = { href: `/api/v1/rosters/${id}/unlock`, method: 'POST' };
        links.submit_match = { href: `${ANALYTICS_SERVICE}/api/v1/matches/submit`, method: 'POST' };
    } else if (roster.status === 'ARCHIVED') {
        links.unarchive = { href: `/api/v1/rosters/${id}/unarchive`, method: 'POST' };
    }
    return links;
}

const MAPS = [
    { name: 'Ascent', splash: 'https://media.valorant-api.com/maps/7ae2338e-4174-0ec1-a713-72ba63a65e38/splash.png' },
    { name: 'Bind', splash: 'https://media.valorant-api.com/maps/2c009f69-416f-43fc-a73a-4500c5c86dcd/splash.png' },
    { name: 'Haven', splash: 'https://media.valorant-api.com/maps/2ee07238-411b-1794-60c3-66a44fe3e86f/splash.png' }
];

let availableAgents = [];
let currentRoster = null;

// Executes on page load
if (document.getElementById('user-select')) {
    document.getElementById('user-select').value = CURRENT_USER_ID;
    document.getElementById('login-btn').onclick = async () => {
        const select = document.getElementById('user-select');
        const selectedUser = select.value; // player id -> X-Player-Id
        const selectedTag = select.selectedOptions[0].dataset.playerTag; // player tag -> login
        try {
            const res = await apiFetch(`${ROSTER_SERVICE}/api/v1/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerTag: selectedTag, pin: "1234" })
            });
            if (res.ok) {
                const data = await res.json();
                localStorage.setItem('jwt_token', data.accessToken);
            }
        } catch (e) {
            localStorage.setItem('jwt_token', `mock-jwt-token-for-${selectedTag}`);
        }
        CURRENT_USER_ID = selectedUser;
        localStorage.setItem('user_id', selectedUser);
        loadRoster();
    };
}

async function fetchRiotCatalog() {
    const statusEl = document.getElementById('catalog-status');

    // Tier 1: Instant First Paint from Cache or Bundled Meta Seed
    const cached = localStorage.getItem('cached_agents_catalog');
    if (cached) {
        try {
            availableAgents = JSON.parse(cached);
        } catch {
            availableAgents = SEED_AGENTS;
        }
    } else {
        availableAgents = SEED_AGENTS;
    }
    renderAgentCatalog();

    // Tier 2: Background Progressive Hydration from Riot API
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);

        const res = await fetch('https://valorant-api.com/v1/agents?isPlayableCharacter=true', {
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const liveAgents = (data.data || []).map(a => ({
            uuid: a.uuid,
            displayName: a.displayName,
            role: a.role ? a.role.displayName : 'Duelist',
            displayIcon: a.displayIcon,
            fullPortrait: a.fullPortrait
        }));

        if (liveAgents.length > 0) {
            availableAgents = liveAgents;
            localStorage.setItem('cached_agents_catalog', JSON.stringify(availableAgents));
            if (statusEl) statusEl.innerText = "Riot API Online (Full Roster)";
            renderAgentCatalog();
        }
    } catch (e) {
        if (statusEl) {
            statusEl.innerText = cached
                ? "Riot API Offline (Local Cache Active)"
                : "Riot API Offline (Meta Seed Active)";
        }
    }
}

export async function loadRoster() {
    const envBadge = document.getElementById('env-mode-badge');
    if (envBadge) envBadge.innerText = `Mode: ${MODE_NAME}`;
    const token = localStorage.getItem('jwt_token') || 'mock-jwt-token';

    if (ROSTER_SERVICE === 'mock') { // For mock mode (no backend)
        currentRoster = {
            id: "r-101",
            captainId: "p-001",
            mapName: "Ascent",
            status: "DRAFT",
            members: []
        };
        currentRoster._links = mockServerLinks(currentRoster);
        renderRosterUI(currentRoster);
        return;
    }

    // Against a live backend there must be a real token (from a successful login).
    // Never send the mock fallback to the backend — show the not-logged-in state locally.
    if (!localStorage.getItem('jwt_token')) {
        currentRoster = null;
        renderRosterUI(currentRoster, 'unauthenticated');
        return;
    }

    try {
        // Hardcoded roster URL with our fixed ID. In real life this would be provided from roster selection UI or by the component caller.
        const res = await apiFetch(`${ROSTER_SERVICE}/api/v1/rosters/r-101`, {
            headers: { 
                'X-Player-Id': CURRENT_USER_ID,
                'Authorization': `Bearer ${token}`
            }
        });
        if (!res.ok) {
            throw new Error("Failed to fetch roster: " + (await res.text()));
        }
        currentRoster = await res.json();
        renderRosterUI(currentRoster);
    } catch (e) {
        console.error("Error loading roster:", e);
        // Token exists but fetch failed (expired, network, server error)
        currentRoster = null;
        renderRosterUI(currentRoster, 'error');
    }
}

export function renderRosterUI(roster, reason = 'unknown') {
    // Handle null roster state
    if (!roster) {
        const authBox = document.getElementById('auth-box');
        if (reason === 'unauthenticated') {
            // User has no JWT yet — show a friendly prompt instead of "Roster not available".
            // Pulse the auth box so their eye is drawn to the JWT Login control at the top.
            if (authBox) authBox.classList.add('ring-2', 'ring-valored', 'shadow-neon', 'animate-pulse');
            document.getElementById('roster-header').innerHTML = `
                <div class="p-6 text-center bg-amber-950/40 border border-amber-500/40 rounded-lg">
                    <div class="text-4xl mb-2">🔐</div>
                    <h2 class="font-teko text-3xl text-white uppercase tracking-wider leading-none">Not Logged In</h2>
                    <p class="text-amber-200 text-xs font-mono mt-2">
                        Pick your player and click <strong>JWT Login</strong> above to continue.
                    </p>
                    <button id="goto-login-btn" type="button"
                            class="mt-4 bg-valored hover:bg-red-600 text-white font-teko text-base tracking-wider px-4 py-1.5 clip-button uppercase">
                        Focus Login
                    </button>
                </div>
            `;
            const btn = document.getElementById('goto-login-btn');
            if (btn) btn.onclick = () => document.getElementById('user-select')?.focus();
        } else {
            if (authBox) authBox.classList.remove('ring-2', 'ring-valored', 'shadow-neon', 'animate-pulse');
            document.getElementById('roster-header').innerHTML = '';
        }
        const grid = document.getElementById('agents-grid');
        grid.innerHTML = '<div class="p-4 text-center text-gray-500">Roster not available</div>';
        document.getElementById('hateoas-actions').innerHTML = '';
        return;
    }

    // Authenticated roster — clear any lingering "login required" visual cue.
    const authBox = document.getElementById('auth-box');
    if (authBox) authBox.classList.remove('ring-2', 'ring-valored', 'shadow-neon', 'animate-pulse');
    const currentMap = MAPS.find(m => m.name.toLowerCase() === roster.mapName.toLowerCase()) || MAPS[0];

    document.getElementById('roster-header').innerHTML = `
        <div class="relative overflow-hidden rounded-lg border border-gray-700/60 p-5 bg-cover bg-center shadow-2xl transition-all"
             style="background-image: linear-gradient(to right, rgba(15,25,35,0.95), rgba(15,25,35,0.65)), url('${currentMap.splash}');">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <span class="text-[10px] font-mono text-valored tracking-widest uppercase block mb-1">Selected Tactical Map</span>
                    <h2 class="font-teko text-4xl text-white uppercase leading-none font-bold">${roster.mapName}</h2>
                </div>
                <div class="flex items-center space-x-2">
                    <span class="px-3 py-1 font-mono text-xs font-bold rounded uppercase clip-corner ${
                        roster.status === 'LOCKED' ? 'bg-red-950 text-red-300 border border-red-500/60 shadow-neon' : 
                        roster.status === 'ARCHIVED' ? 'bg-gray-900 text-gray-400 border border-gray-700' :
                        'bg-amber-950 text-amber-300 border border-amber-500/60'
                    }">${roster.status} PHASE</span>
                </div>
            </div>
        </div>
    `;

    const grid = document.getElementById('agents-grid');
    grid.innerHTML = '';

    // OpenAPI contract says members is always an array; guard anyway so an empty
    // (or malformed) roster still renders the 5 slot placeholders instead of crashing.
    const members = Array.isArray(roster.members) ? roster.members : [];

    // Render slots 1-5
    for (let i = 0; i < 5; i++) {
        const slot = i + 1;
        const member = members.find(m => m.slot === slot);
        
        if (member) {
            // Find agent icon from availableAgents
            const agentIcon = availableAgents.find(a => a.displayName.toLowerCase() === member.agentKey.toLowerCase())?.fullPortrait || '/agent-placeholder.svg';
            
            const removeLink = roster._links && roster._links[`remove_agent_${member.agentKey}`];
            const hasRemovePermission = removeLink !== undefined;
            
            grid.innerHTML += `
                <div class="bg-valodark/90 border border-gray-700/80 rounded-lg p-3 flex items-center space-x-3 clip-card">
                    <img src="${agentIcon}"
                         class="w-14 h-14 rounded object-cover bg-gray-950 border border-gray-800">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center space-x-1.5">
                            <span class="text-[10px] font-mono text-gray-500">#${member.slot}</span>
                            <h4 class="font-teko text-xl text-white truncate uppercase leading-none">${member.agentKey}</h4>
                            ${member.roleType === 'CAPTAIN' ? '<span class="text-[9px] font-mono bg-valored text-white px-1.5 py-0.5 rounded font-black clip-tag">CAPTAIN</span>' : ''}
                        </div>
                        <span class="text-[10px] font-mono text-gray-400 uppercase tracking-widest block">${member.playerTag || member.playerId}</span>
                    </div>
                    ${hasRemovePermission ? `
                    <button onclick="removeAgent('${member.agentKey}')" class="text-gray-400 hover:text-red-500 hover:bg-red-900/20 p-1 rounded transition">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M18 6l-12 12"></path>
                            <path d="M6 6l12 12"></path>
                        </svg>
                    </button>
                    ` : ''}
                </div>
            `;
        } else {
            grid.innerHTML += `
                <div class="border-2 border-dashed border-gray-800 rounded-lg p-3 flex items-center justify-center space-x-2 text-gray-600 font-mono text-xs clip-card min-h-[72px]">
                    <span>+ SLOT #${slot} EMPTY</span>
                </div>
            `;
        }
    }

    const actionsBox = document.getElementById('hateoas-actions');
    actionsBox.innerHTML = '';

    if (roster._links && roster._links.lock_in) {
        const btn = document.createElement('button');
        btn.id = 'lock-btn';
        btn.className = 'bg-valored hover:bg-red-600 text-white font-teko text-lg tracking-wider px-4 py-1.5 clip-button shadow-neon uppercase';
        btn.textContent = 'LOCK IN ROSTER';
        btn.onclick = () => executeHalAction(roster._links.lock_in);
        actionsBox.appendChild(btn);
    }

    if (roster._links && roster._links.unlock) {
        const btn = document.createElement('button');
        btn.className = 'bg-amber-600 hover:bg-amber-700 text-white font-teko text-lg tracking-wider px-4 py-1.5 clip-button uppercase';
        btn.textContent = 'UNLOCK ROSTER';
        btn.onclick = () => executeHalAction(roster._links.unlock);
        actionsBox.appendChild(btn);
    }

    if (roster._links && roster._links.unarchive) {
        const btn = document.createElement('button');
        btn.className = 'bg-blue-600 hover:bg-blue-700 text-white font-teko text-lg tracking-wider px-4 py-1.5 clip-button uppercase';
        btn.textContent = 'UNARCHIVE ROSTER';
        btn.onclick = () => unarchiveRoster();
        actionsBox.appendChild(btn);
    }
}

function renderAgentCatalog() {
    const catalogGrid = document.getElementById('catalog-grid');
    if (!catalogGrid) return;

    catalogGrid.innerHTML = availableAgents.map(a => `
        <div onclick="selectAgentFromCatalog('${a.displayName.toLowerCase()}')" 
             class="group relative bg-valodark p-2 rounded border border-gray-800 hover:border-valored cursor-pointer transition text-center">
            <img src="${a.displayIcon || '/agent-placeholder.svg'}"
                 onerror="this.onerror=null;this.src='/agent-placeholder.svg';"
                 class="w-10 h-10 mx-auto object-contain group-hover:scale-110 transition">
            <span class="block text-[10px] font-mono uppercase text-gray-400 mt-1 truncate">${a.displayName}</span>
        </div>
    `).join('');
}

window.selectAgentFromCatalog = async (agentKey) => {
    if (!currentRoster) {
        alert("Roster not available. Please try again later.");
        return;
    }
    if (currentRoster.status !== 'DRAFT') {
        alert("Roster is LOCKED or ARCHIVED. Cannot modify agents.");
        return;
    }
    if (currentRoster.members.length >= 5) {
        alert("Roster already has 5 agents!");
        return;
    }

    const token = localStorage.getItem('jwt_token') || 'mock-jwt-token';
    
    // Find next available slot
    const occupiedSlots = new Set(currentRoster.members.map(m => m.slot));
    let slot = 1;
    while (occupiedSlots.has(slot) && slot <= 5) {
        slot++;
    }
    
    const playerId = `p-00${slot}`;

    if (ROSTER_SERVICE === 'mock') {
        // Mock mode: update local state, then let the mock "server" recompute _links
        currentRoster.members.push({
            slot,
            playerId,
            playerTag: `Player#00${slot}`,
            agentKey,
            roleType: "PLAYER"
        });
        currentRoster._links = mockServerLinks(currentRoster);
        renderRosterUI(currentRoster);
        return;
    }

    // HATEOAS: post to the link the server published, not a rebuilt path.
    const addLink = currentRoster._links && currentRoster._links.add_agent;
    if (!addLink) {
        alert("This roster does not allow adding agents right now.");
        return;
    }
    const res = await apiFetch(`${resolveHalUrl(addLink.href)}`, {
        method: addLink.method,
        headers: {
            'Content-Type': 'application/json',
            'X-Player-Id': CURRENT_USER_ID,
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ slot, playerId, agentKey })
    });

    if (!res.ok) {
        const error = await res.json();
        alert("Failed to add agent: " + (error.message || "Unknown error"));
        return;
    }

    loadRoster();
};

window.removeAgent = async (agentKey) => {
    if (!currentRoster) {
        alert("Roster not available. Please try again later.");
        return;
    }
    if (currentRoster.status !== 'DRAFT') {
        alert("Roster is LOCKED or ARCHIVED. Cannot modify agents.");
        return;
    }

    const token = localStorage.getItem('jwt_token') || 'mock-jwt-token';
    const removeLink = currentRoster._links[`remove_agent_${agentKey}`];

    if (!removeLink) {
        alert("Remove agent link not available.");
        return;
    }

    if (ROSTER_SERVICE === 'mock') {
        currentRoster.members = currentRoster.members.filter(m => m.agentKey !== agentKey);
        currentRoster._links = mockServerLinks(currentRoster);
        renderRosterUI(currentRoster);
        return;
    }

    const res = await apiFetch(resolveHalUrl(removeLink.href), {
        method: removeLink.method,
        headers: {
            'X-Player-Id': CURRENT_USER_ID,
            'Authorization': `Bearer ${token}`
        }
    });

    if (!res.ok) {
        const error = await res.json();
        alert("Failed to remove agent: " + (error.message || "Unknown error"));
        return;
    }

    loadRoster();
};

async function executeHalAction(link) {
    const token = localStorage.getItem('jwt_token') || 'mock-jwt-token';

    if (ROSTER_SERVICE === 'mock') {
        if (link.href.endsWith('/lock')) currentRoster.status = 'LOCKED';
        else if (link.href.endsWith('/unlock')) currentRoster.status = 'DRAFT';
        currentRoster._links = mockServerLinks(currentRoster);
        renderRosterUI(currentRoster);
        return;
    }

    try {
        const res = await apiFetch(resolveHalUrl(link.href), {
            method: link.method,
            headers: { 
                'X-Player-Id': CURRENT_USER_ID,
                'Authorization': `Bearer ${token}`
            }
        });
        if (res.ok) loadRoster();
    } catch (e) {
        alert("Action execution failed");
    }
}

async function unarchiveRoster() {
    const token = localStorage.getItem('jwt_token') || 'mock-jwt-token';
    
    if (ROSTER_SERVICE === 'mock') {
        currentRoster.status = 'DRAFT';
        currentRoster._links = mockServerLinks(currentRoster);
        renderRosterUI(currentRoster);
        return;
    }

    const unarchiveLink = currentRoster._links && currentRoster._links.unarchive;
    if (!unarchiveLink) {
        document.getElementById('match-result-card').innerHTML = `
            <div class="p-4 bg-red-950/80 border border-red-500/60 rounded clip-card">
                <span class="font-teko text-xl text-red-300 uppercase">Unarchive Failed</span>
                <div class="text-xs font-mono text-gray-300 mt-1">This roster does not offer an unarchive action.</div>
            </div>
        `;
        return;
    }

    try {
        const res = await apiFetch(resolveHalUrl(unarchiveLink.href), {
            method: unarchiveLink.method,
            headers: { 
                'X-Player-Id': CURRENT_USER_ID,
                'Authorization': `Bearer ${token}`
            }
        });
        if (res.ok) {
            loadRoster();
        } else {
            const errorBody = await res.text();
            let errorMessage = "Unknown error";
            try {
                const parsed = JSON.parse(errorBody);
                errorMessage = parsed?._embedded?.errors?.[0]?.message || parsed?.message || errorBody;
            } catch {
                errorMessage = errorBody || "Unknown error";
            }
            document.getElementById('match-result-card').innerHTML = `
                <div class="p-4 bg-red-950/80 border border-red-500/60 rounded clip-card">
                    <span class="font-teko text-xl text-red-300 uppercase">Unarchive Failed</span>
                    <div class="text-xs font-mono text-gray-300 mt-1">${errorMessage}</div>
                </div>
            `;
        }
    } catch (e) {
        console.error("Unarchive failed:", e);
        document.getElementById('match-result-card').innerHTML = `
            <div class="p-4 bg-red-950/80 border border-red-500/60 rounded clip-card">
                <span class="font-teko text-xl text-red-300 uppercase">Unarchive Failed</span>
                <div class="text-xs font-mono text-gray-300 mt-1">${e.message || "Unknown error"}</div>
            </div>
        `;
    }
}

const matchForm = document.getElementById('match-form');
if (matchForm) {
    matchForm.onsubmit = async (e) => {
        e.preventDefault();
        // Clear any previous result (success or error) so a stale card can never linger.
        const resultCard = document.getElementById('match-result-card');
        if (resultCard) resultCard.innerHTML = '';

        try {
            if (!currentRoster) {
                throw new Error('No active roster to submit a match for.');
            }
            const token = localStorage.getItem('jwt_token');
            const isWin = document.getElementById('outcome').value === 'WIN';
            const stats = {
                roundMargin: parseInt(document.getElementById('margin').value, 10),
                kills: parseInt(document.getElementById('kills').value, 10),
                deaths: parseInt(document.getElementById('deaths').value, 10),
                assists: parseInt(document.getElementById('assists').value, 10),
                combatScore: parseInt(document.getElementById('acs').value, 10)
            };
            if (Object.values(stats).some(Number.isNaN)) {
                throw new Error('Please fill all match stats (margin, kills, deaths, assists, ACS) with numbers.');
            }

            const payload = {
                rosterId: currentRoster.id,
                playerId: CURRENT_USER_ID,
                mapName: currentRoster.mapName,
                isWin,
                ...stats,
                isAfk: false
            };

            // HATEOAS: the roster's submit_match link says WHERE to submit and with
            // what method. The frontend never hardcodes the analytics endpoint — the
            // server owns that routing (note it can even be an absolute cross-service URL).
            const submitLink = currentRoster._links && currentRoster._links.submit_match;
            if (!submitLink) {
                throw new Error('This roster is not open for match submission.');
            }

            if (ROSTER_SERVICE === 'mock') {
                const deltaRR = isWin ? 17 : -14;
                currentRoster.status = 'ARCHIVED';
                currentRoster._links = mockServerLinks(currentRoster);
                renderMatchResult({ matchId: `m-${Date.now()}`, deltaRR, tierStatus: isWin ? 'PROMOTED' : 'MAINTAINED' });
                renderRosterUI(currentRoster);
                return;
            }

            const res = await apiFetch(resolveHalUrl(submitLink.href), {
                method: submitLink.method,
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            if (res.status === 409) {
                document.getElementById('match-result-card').innerHTML = `
                    <div class="p-4 bg-amber-950/80 border border-amber-500/60 rounded clip-card">
                        <span class="font-teko text-xl text-amber-300 uppercase">Match Already Submitted</span>
                        <div class="text-xs font-mono text-gray-300 mt-1">This roster already has a match recorded. Unarchive to submit again.</div>
                    </div>
                `;
                return;
            }

            const rawBody = await res.text();
            let data = null;
            try {
                data = rawBody ? JSON.parse(rawBody) : null;
            } catch {
                data = null;
            }

            // Only a 2xx response carrying a well-formed result counts as success.
            // Anything else (server error, malformed body, 2xx-with-error) falls through to the error card.
            if (!res.ok || !isValidMatchResult(data)) {
                const errorMessage =
                    data?._embedded?.errors?.[0]?.message ||
                    data?.message ||
                    (rawBody && rawBody.trim()) ||
                    `Analytics service returned ${res.status || 'no response'}`;
                throw new Error(errorMessage);
            }

            renderMatchResult(data);
            loadRoster();  // refresh roster to show ARCHIVED state
        } catch (e) {
            console.error("Match submission failed:", e);
            document.getElementById('match-result-card').innerHTML = `
                <div class="p-4 bg-red-950/80 border border-red-500/60 rounded clip-card">
                    <span class="font-teko text-xl text-red-300 uppercase">Match Submission Failed</span>
                    <div class="text-xs font-mono text-gray-300 mt-1">${e.message || "Unknown error"}</div>
                </div>
            `;
        }
    };
}

export function isValidMatchResult(data) {
    return !!data
        && Number.isFinite(data.deltaRR)
        && typeof data.tierStatus === 'string';
}

function renderMatchResult(data) {
    document.getElementById('match-result-card').innerHTML = `
        <div class="p-4 bg-emerald-950/80 border border-emerald-500/60 rounded clip-card">
            <div class="flex justify-between items-center">
                <span class="font-teko text-xl text-emerald-300 uppercase">Match Calculation Result</span>
                <span class="font-mono font-bold text-lg text-emerald-400">${data.deltaRR >= 0 ? '+' : ''}${data.deltaRR} RR</span>
            </div>
            <div class="text-xs font-mono text-gray-300 mt-1">Tier Status: <strong class="text-white">${data.tierStatus}</strong></div>
        </div>
    `;
}

if (typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        prewarmCloudServices();
        fetchRiotCatalog();
        loadRoster();
    });
}
