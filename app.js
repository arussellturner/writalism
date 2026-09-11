// Configuration - User should replace this with their actual Client ID
const CLIENT_ID = '593289261918-4or87gs5krjoildr9n694j2hr7f93n2m.apps.googleusercontent.com'; 
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

// Session & Storage Keys
const STORAGE_TOKEN_KEY = 'minimal_writing_token';
const STORAGE_EXPIRES_KEY = 'writalism_token_expires_at';
const STORAGE_KEEP_SIGNED_IN_KEY = 'writalism_keep_signed_in';
const STORAGE_CACHED_STATE_KEY = 'writalism_cached_state';
const STORAGE_PENDING_SYNC_KEY = 'writalism_pending_sync';
const STORAGE_LAST_SYNCED_KEY = 'writalism_last_synced_time';

let tokenClient;
let gapiInited = false;
let gisInited = false;
let accessToken = null;
let refreshTimer = null;
let dataFileId = null;
let currentSyncState = 'synced'; // 'synced' | 'syncing' | 'warning'

// Application State
let state = {
    pages: [], // {id, title, content, lastModified}
    activePageId: null,
    settings: {
        h1: { font: 'Inter', weight: 600, size: '2.5rem' },
        h2: { font: 'Inter', weight: 500, size: '2rem' },
        h3: { font: 'Inter', weight: 500, size: '1.5rem' },
        h4: { font: 'Inter', weight: 500, size: '1.2rem' },
        bullet: { font: 'Inter', weight: 400, size: '1rem' },
        alpha: { font: 'Inter', weight: 400, size: '1rem' },
        num: { font: 'Inter', weight: 400, size: '1rem' },
        quote: { font: 'Inter', weight: 400, size: '1.1rem' },
        code: { font: 'monospace', weight: 400, size: '0.9rem' },
    }
};

// Immediately restore cached state from localStorage so documents are available with zero delay
try {
    const cachedRaw = localStorage.getItem(STORAGE_CACHED_STATE_KEY);
    if (cachedRaw) {
        const cachedData = JSON.parse(cachedRaw);
        state = { ...state, ...cachedData };
        if (!state.settings) state.settings = {};
    }
} catch (e) {
    console.warn("Writalism: Failed to parse cached state", e);
}

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app');
const authBtn = document.getElementById('auth-button');
const keepSignedInLogin = document.getElementById('keep-signed-in-login');
const syncStatusPill = document.getElementById('sync-status');
const reconnectBtn = document.getElementById('reconnect-btn');
const menuToggle = document.getElementById('menu-toggle');
const sidebar = document.getElementById('sidebar');
const pageList = document.getElementById('page-list');
const newPageBtn = document.getElementById('new-page-btn');
const pageTitle = document.getElementById('page-title');
const editor = document.getElementById('editor');
const logoutBtn = document.getElementById('logout-btn');
const settingsBtn = document.getElementById('settings-btn');
const formatMenu = document.getElementById('format-menu');
const deleteModal = document.getElementById('delete-modal');
const sidebarPages = document.getElementById('sidebar-pages');
const sidebarSettings = document.getElementById('sidebar-settings');
const themeToggleBtn = document.getElementById('theme-toggle-btn');

// --- Session & Storage Helpers ---
function getKeepSignedIn() {
    return localStorage.getItem(STORAGE_KEEP_SIGNED_IN_KEY) !== 'false';
}

function setKeepSignedIn(enabled) {
    localStorage.setItem(STORAGE_KEEP_SIGNED_IN_KEY, enabled ? 'true' : 'false');
    if (keepSignedInLogin) keepSignedInLogin.checked = !!enabled;
    const settingsSwitch = document.getElementById('keep-signed-in-setting');
    if (settingsSwitch) settingsSwitch.checked = !!enabled;
}

function isTokenValid() {
    if (!accessToken) return false;
    const expiresAtStr = localStorage.getItem(STORAGE_EXPIRES_KEY);
    if (!expiresAtStr) return true;
    const expiresAt = parseInt(expiresAtStr, 10);
    return Date.now() < (expiresAt - 60000); // Valid if >60 seconds remaining
}

function cacheStateLocally() {
    try {
        localStorage.setItem(STORAGE_CACHED_STATE_KEY, JSON.stringify(state));
    } catch(e) {
        console.warn("Writalism: Failed to cache state locally", e);
    }
}

function formatSyncTimestamp(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;

    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear();

    return `${hours}:${minutes}<span class="sync-colon">:</span><span class="sync-seconds">${seconds}</span> ${ampm} ${month}/${day}/${year}`;
}

function updateSyncStatus(status, text, timestamp) {
    if (!syncStatusPill) return;
    currentSyncState = status;
    syncStatusPill.classList.remove('hidden', 'syncing', 'warning', 'error');
    const syncText = syncStatusPill.querySelector('.sync-text');
    
    if (status === 'syncing') {
        syncStatusPill.classList.add('syncing');
        if (reconnectBtn) reconnectBtn.classList.add('hidden');
        if (syncText) syncText.innerHTML = text || 'Saving...';
    } else if (status === 'warning' || status === 'error') {
        syncStatusPill.classList.add('warning');
        if (reconnectBtn) reconnectBtn.classList.remove('hidden');
        if (syncText) syncText.innerHTML = text || 'Sync Paused';
    } else {
        if (reconnectBtn) reconnectBtn.classList.add('hidden');

        let ts = timestamp;
        if (!ts) {
            const savedTs = localStorage.getItem(STORAGE_LAST_SYNCED_KEY);
            ts = savedTs ? parseInt(savedTs, 10) : Date.now();
        }
        localStorage.setItem(STORAGE_LAST_SYNCED_KEY, ts.toString());

        const label = (text && text !== 'Synced') ? text : 'Saved';
        if (syncText) {
            syncText.innerHTML = `${label} &bull; ${formatSyncTimestamp(ts)}`;
        }
    }
}


function scheduleTokenRefresh(expiresInSeconds) {
    if (refreshTimer) clearTimeout(refreshTimer);
    const refreshDelayMs = Math.max(30000, (expiresInSeconds - 300) * 1000);
    refreshTimer = setTimeout(() => {
        if (getKeepSignedIn() && tokenClient) {
            console.log("Writalism: Auto-renewing Google Drive access token...");
            try {
                tokenClient.requestAccessToken({ prompt: '' });
            } catch (err) {
                console.warn("Writalism: Background token refresh error", err);
            }
        }
    }, refreshDelayMs);
}

function requestAuth(interactive = true) {
    if (CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID_HERE') {
        alert("Please set your Google Client ID in app.js before authenticating.");
        return;
    }
    if (!tokenClient) return;

    const previouslyAuthed = !!localStorage.getItem(STORAGE_TOKEN_KEY) || getKeepSignedIn();
    const promptValue = (interactive && !previouslyAuthed) ? 'consent' : '';

    try {
        tokenClient.requestAccessToken({ prompt: promptValue });
    } catch (err) {
        console.warn("Writalism: requestAccessToken error", err);
        if (interactive) {
            tokenClient.requestAccessToken({ prompt: 'consent' });
        }
    }
}

// --- Google API Initialization ---
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
    await gapi.client.init({ discoveryDocs: DISCOVERY_DOCS });
    gapiInited = true;
    checkAuth();
}

function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
            if (resp.error !== undefined) {
                console.warn("Writalism: GIS auth callback error:", resp);
                if (resp.error === 'popup_blocked_by_browser' || resp.error === 'immediate_failed') {
                    updateSyncStatus('warning', 'Sync Paused');
                }
                return;
            }
            accessToken = resp.access_token;
            const expiresIn = resp.expires_in || 3600;
            const expiresAt = Date.now() + (expiresIn * 1000);

            localStorage.setItem(STORAGE_TOKEN_KEY, accessToken);
            localStorage.setItem(STORAGE_EXPIRES_KEY, expiresAt.toString());
            gapi.client.setToken({ access_token: accessToken });

            updateSyncStatus('synced', 'Synced');
            showApp();
            scheduleTokenRefresh(expiresIn);

            if (localStorage.getItem(STORAGE_PENDING_SYNC_KEY) === 'true') {
                saveToDrive();
            }
        },
    });
    gisInited = true;
    checkAuth();
}

function checkAuth() {
    if (!gapiInited || !gisInited) return;

    const savedToken = localStorage.getItem(STORAGE_TOKEN_KEY);
    const keepSignedIn = getKeepSignedIn();

    if (savedToken) {
        accessToken = savedToken;
        gapi.client.setToken({ access_token: savedToken });

        if (isTokenValid()) {
            const expiresAt = parseInt(localStorage.getItem(STORAGE_EXPIRES_KEY) || '0', 10);
            const remainingSec = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000));
            scheduleTokenRefresh(remainingSec);
            updateSyncStatus('synced', 'Synced');
            showApp();
        } else if (keepSignedIn) {
            updateSyncStatus('warning', 'Sync Paused');
            showApp();
            try {
                tokenClient.requestAccessToken({ prompt: '' });
            } catch (e) {
                console.warn("Writalism: Background silent renewal blocked", e);
            }
        }
    } else if (keepSignedIn && state.pages && state.pages.length > 0) {
        showApp();
        updateSyncStatus('warning', 'Sync Paused');
    }
}

authBtn.onclick = () => {
    if (keepSignedInLogin) {
        setKeepSignedIn(keepSignedInLogin.checked);
    }
    requestAuth(true);
};

if (reconnectBtn) {
    reconnectBtn.onclick = (e) => {
        e.stopPropagation();
        requestAuth(true);
    };
}

if (keepSignedInLogin) {
    keepSignedInLogin.checked = getKeepSignedIn();
    keepSignedInLogin.addEventListener('change', (e) => {
        setKeepSignedIn(e.target.checked);
    });
}

logoutBtn.onclick = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    const oldToken = accessToken;
    accessToken = null;
    dataFileId = null;
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_EXPIRES_KEY);
    localStorage.removeItem(STORAGE_KEEP_SIGNED_IN_KEY);
    localStorage.removeItem(STORAGE_PENDING_SYNC_KEY);
    localStorage.removeItem(STORAGE_LAST_SYNCED_KEY);
    if (oldToken && window.google && google.accounts && google.accounts.oauth2) {
        try {
            google.accounts.oauth2.revoke(oldToken, () => {
                location.reload();
            });
            return;
        } catch (e) {}
    }
    location.reload();
};

async function showApp(skipDriveSync = false) {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');

    if (state.pages && state.pages.length > 0) {
        if (!state.activePageId || !state.pages.find(p => p.id === state.activePageId)) {
            state.activePageId = state.pages[0].id;
        }
        loadPage(state.activePageId);
    }

    applySettingsToCSS();
    renderSidebar();

    const savedTs = localStorage.getItem(STORAGE_LAST_SYNCED_KEY);
    if (savedTs) {
        updateSyncStatus('synced', 'Saved', parseInt(savedTs, 10));
    }

    if (!skipDriveSync && isTokenValid()) {
        await loadDataFromDrive();
    }
}

// --- Drive Operations ---
async function loadDataFromDrive() {
    if (localStorage.getItem(STORAGE_PENDING_SYNC_KEY) === 'true') {
        await saveToDrive();
        return;
    }

    try {
        let response = await gapi.client.drive.files.list({
            spaces: 'appDataFolder',
            q: "name='minimal_writing_data.json'",
            fields: 'files(id, name, modifiedTime)',
            orderBy: 'modifiedTime desc',
            pageSize: 10
        });
        
        let files = response.result.files;
        let dataFile = files.length > 0 ? files[0] : null;
        
        if (dataFile) {
            dataFileId = dataFile.id;
            let fileResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${dataFileId}?alt=media`, {
                headers: { 'Authorization': 'Bearer ' + accessToken }
            });
            
            if (fileResponse.ok) {
                let data = await fileResponse.json();
                state = { ...state, ...data };
                if (!state.settings) state.settings = {};
                cacheStateLocally();
                const fileModifiedTime = dataFile.modifiedTime ? new Date(dataFile.modifiedTime).getTime() : Date.now();
                updateSyncStatus('synced', 'Saved', fileModifiedTime);
            } else if (fileResponse.status === 401) {
                updateSyncStatus('warning', 'Sync Paused');
            }
        } else {
            if (!state.pages || state.pages.length === 0) {
                state.pages = [{ id: Date.now().toString(), title: 'Untitled', content: '<div><br></div>', created: Date.now(), lastModified: Date.now() }];
                state.activePageId = state.pages[0].id;
            }
            await saveToDrive(true);
        }
        
        if (!state.activePageId && state.pages.length > 0) {
            state.activePageId = state.pages[0].id;
        }
        if (state.activePageId) loadPage(state.activePageId);
    } catch (err) {
        console.error("Writalism: Drive load error", err);
        if (err.status === 401) {
            updateSyncStatus('warning', 'Sync Paused');
            if (getKeepSignedIn() && tokenClient) {
                try {
                    tokenClient.requestAccessToken({ prompt: '' });
                } catch (e) {}
            }
        }
    }
}

async function saveToDrive(isNew = false) {
    cacheStateLocally();

    if (!accessToken || !isTokenValid()) {
        localStorage.setItem(STORAGE_PENDING_SYNC_KEY, 'true');
        updateSyncStatus('warning', 'Sync Paused');
        if (getKeepSignedIn() && tokenClient) {
            try {
                tokenClient.requestAccessToken({ prompt: '' });
            } catch (e) {}
        }
        return;
    }
    
    updateSyncStatus('syncing', 'Saving...');
    const fileContent = JSON.stringify(state);

    try {
        if (isNew || !dataFileId) {
            let metaRes = await fetch('https://www.googleapis.com/drive/v3/files', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + accessToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: 'minimal_writing_data.json', parents: ['appDataFolder'] })
            });
            if (metaRes.status === 401) {
                localStorage.setItem(STORAGE_PENDING_SYNC_KEY, 'true');
                updateSyncStatus('warning', 'Sync Paused');
                if (getKeepSignedIn() && tokenClient) {
                    tokenClient.requestAccessToken({ prompt: '' });
                }
                return;
            }
            if (!metaRes.ok) throw new Error("Failed to create file");
            let metaVal = await metaRes.json();
            dataFileId = metaVal.id;
        }

        let uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${dataFileId}?uploadType=media`, {
            method: 'PATCH',
            headers: {
                'Authorization': 'Bearer ' + accessToken,
                'Content-Type': 'application/json'
            },
            body: fileContent
        });
        
        if (uploadRes.status === 401) {
            localStorage.setItem(STORAGE_PENDING_SYNC_KEY, 'true');
            updateSyncStatus('warning', 'Sync Paused');
            if (getKeepSignedIn() && tokenClient) {
                tokenClient.requestAccessToken({ prompt: '' });
            }
            return;
        }

        if (uploadRes.ok) {
            localStorage.removeItem(STORAGE_PENDING_SYNC_KEY);
            updateSyncStatus('synced', 'Saved', Date.now());
        }
    } catch(e) {
        console.error("Writalism: Save error", e);
        localStorage.setItem(STORAGE_PENDING_SYNC_KEY, 'true');
        updateSyncStatus('warning', 'Sync Paused');
    }
}

// Debounce save (triggers automatically on edit while caching instantly)
let saveTimeout;
function triggerSave() {
    const page = state.pages.find(p => p.id === state.activePageId);
    if (page) {
        page.title = pageTitle.value;
        page.content = editor.innerHTML;
        page.lastModified = Date.now();
    }
    cacheStateLocally();
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        renderSidebar();
        saveToDrive();
    }, 1000);
}

function autoResizeTitle() {
    pageTitle.style.height = 'auto';
    pageTitle.style.height = pageTitle.scrollHeight + 'px';
}

const mainContentObserver = new ResizeObserver(() => {
    autoResizeTitle();
});
mainContentObserver.observe(document.querySelector('.main-content'));

pageTitle.addEventListener('input', () => {
    autoResizeTitle();
    triggerSave();
});
editor.addEventListener('input', triggerSave);

pageTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        editor.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }
});

// Fade out menu button & sync indicator when typing
editor.addEventListener('keydown', (e) => {
    if(e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace') {
        menuToggle.classList.add('fade-out');
        if (syncStatusPill && currentSyncState === 'synced') {
            syncStatusPill.classList.add('fade-out');
        }
    }
});

const showMenuBtn = () => {
    menuToggle.classList.remove('fade-out');
    if (syncStatusPill) syncStatusPill.classList.remove('fade-out');
};
document.addEventListener('mousemove', showMenuBtn);
document.addEventListener('mousedown', showMenuBtn);
document.addEventListener('touchstart', showMenuBtn);

// --- UI Logic ---
let inSettingsMode = false;
const hamburgerSVG = '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>';
const backArrowSVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>';

menuToggle.onclick = () => {
    if (inSettingsMode) {
        inSettingsMode = false;
        sidebarSettings.classList.add('hidden');
        sidebarPages.classList.remove('hidden');
        menuToggle.innerHTML = hamburgerSVG;
    } else {
        sidebar.classList.toggle('open');
    }
};

document.querySelector('.main-content').addEventListener('mousedown', () => {
    if (!inSettingsMode && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
    }
});

document.getElementById('page-search')?.addEventListener('input', renderSidebar);
document.getElementById('page-sort')?.addEventListener('change', renderSidebar);

function renderSidebar() {
    pageList.innerHTML = '';
    const searchInput = document.getElementById('page-search');
    const sortSelect = document.getElementById('page-sort');
    const searchVal = searchInput ? searchInput.value.toLowerCase() : '';
    const sortVal = sortSelect ? sortSelect.value : 'edited-new';
    
    let filtered = state.pages.filter(p => {
        return (p.title || '').toLowerCase().includes(searchVal) || (p.content || '').toLowerCase().includes(searchVal);
    });
    
    filtered.sort((a,b) => {
        const aCreated = a.created || a.lastModified || parseInt(a.id);
        const bCreated = b.created || b.lastModified || parseInt(b.id);
        
        if (sortVal === 'edited-new') return b.lastModified - a.lastModified;
        if (sortVal === 'edited-old') return a.lastModified - b.lastModified;
        if (sortVal === 'created-new') return bCreated - aCreated;
        if (sortVal === 'created-old') return aCreated - bCreated;
        return b.lastModified - a.lastModified;
    });

    filtered.forEach(p => {
        const li = document.createElement('li');
        li.className = `page-item ${p.id === state.activePageId ? 'active' : ''}`;
        
        const aCreated = p.created || p.lastModified || parseInt(p.id);
        const createdDate = new Date(aCreated).toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
        const editedDate = new Date(p.lastModified).toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
        
        const infoDiv = document.createElement('div');
        infoDiv.style.flex = '1';
        infoDiv.style.overflow = 'hidden';
        
        const nameSpan = document.createElement('div');
        nameSpan.className = 'page-name';
        nameSpan.textContent = p.title || 'Untitled';
        
        const metaSpan = document.createElement('div');
        metaSpan.className = 'page-meta';
        metaSpan.innerHTML = `Created: ${createdDate}<br>Edited: ${editedDate}`;
        
        infoDiv.appendChild(nameSpan);
        infoDiv.appendChild(metaSpan);
        
        infoDiv.onclick = () => {
            loadPage(p.id);
            if(window.innerWidth <= 768) sidebar.classList.remove('open');
        };
        
        const menuBtn = document.createElement('button');
        menuBtn.className = 'icon-btn page-menu-btn';
        menuBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>';
        
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            showPageMenu(p.id, menuBtn);
        };
        
        li.appendChild(infoDiv);
        li.appendChild(menuBtn);
        pageList.appendChild(li);
    });
}

let activeMenuDropdown = null;
function showPageMenu(pageId, anchor) {
    if (activeMenuDropdown) activeMenuDropdown.remove();
    
    const dropdown = document.createElement('div');
    dropdown.className = 'page-menu-dropdown show';
    
    const renameBtn = document.createElement('button');
    renameBtn.textContent = 'Rename';
    renameBtn.onclick = (e) => {
        e.stopPropagation();
        dropdown.remove();
        loadPage(pageId);
        pageTitle.focus();
        pageTitle.select();
    };
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        dropdown.remove();
        confirmDelete(pageId);
    };
    
    dropdown.appendChild(renameBtn);
    dropdown.appendChild(deleteBtn);
    
    const rect = anchor.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 5}px`;
    dropdown.style.left = `${rect.left - 80}px`;
    
    document.body.appendChild(dropdown);
    activeMenuDropdown = dropdown;
    
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            if(activeMenuDropdown) activeMenuDropdown.remove();
            document.removeEventListener('click', closeMenu);
        });
    }, 0);
}

function loadPage(id) {
    state.activePageId = id;
    const page = state.pages.find(p => p.id === id);
    if (page) {
        pageTitle.value = page.title;
        autoResizeTitle();
        editor.innerHTML = page.content;
    }
    renderSidebar();
}

newPageBtn.onclick = () => {
    const newPage = {
        id: Date.now().toString(),
        title: 'Untitled',
        content: '<div><br></div>',
        created: Date.now(),
        lastModified: Date.now()
    };
    state.pages.push(newPage);
    loadPage(newPage.id);
    pageTitle.focus();
    pageTitle.select();
    triggerSave();
};

let pageToDelete = null;
function confirmDelete(id) {
    pageToDelete = id;
    deleteModal.classList.remove('hidden');
}

document.getElementById('cancel-delete-btn').onclick = () => {
    pageToDelete = null;
    deleteModal.classList.add('hidden');
};

document.getElementById('confirm-delete-btn').onclick = () => {
    if (pageToDelete) {
        state.pages = state.pages.filter(p => p.id !== pageToDelete);
        if (state.activePageId === pageToDelete) {
            state.activePageId = state.pages.length > 0 ? state.pages[0].id : null;
            if(state.activePageId) loadPage(state.activePageId);
            else {
                pageTitle.value = '';
                autoResizeTitle();
                editor.innerHTML = '';
            }
        }
        deleteModal.classList.add('hidden');
        renderSidebar();
        triggerSave();
    }
};

// --- Formatting Menu (@ menu) ---
const formats = [
    { id: 'body', name: 'Body', cmd: 'formatBlock', val: 'P', desc: 'Normal text' },
    { id: 'h1', name: 'Header 1', cmd: 'formatBlock', val: 'H1', desc: 'Large heading' },
    { id: 'h2', name: 'Header 2', cmd: 'formatBlock', val: 'H2', desc: 'Medium heading' },
    { id: 'h3', name: 'Header 3', cmd: 'formatBlock', val: 'H3', desc: 'Small heading' },
    { id: 'h4', name: 'Header 4', cmd: 'formatBlock', val: 'H4', desc: 'Extra small heading' },
    { id: 'bullet', name: 'Bullet List', cmd: 'insertUnorderedList', val: null, desc: 'Unordered list' },
    { id: 'num', name: 'Number List', cmd: 'insertOrderedList', val: null, desc: 'Ordered list' },
    { id: 'alpha', name: 'Alpha List', cmd: 'alphaList', val: null, desc: 'A, B, C list' },
    { id: 'quote', name: 'Quote', cmd: 'formatBlock', val: 'BLOCKQUOTE', desc: 'Blockquote' },
    { id: 'code', name: 'Code', cmd: 'formatBlock', val: 'P', desc: 'Code block' },
];

let atMenuOpen = false;
let atMenuFilter = '';
let atMenuRange = null;
let atSelectedIndex = 0;

editor.addEventListener('keydown', (e) => {
    if (e.key === '@') {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            atMenuRange = selection.getRangeAt(0).cloneRange();
            atMenuOpen = true;
            atMenuFilter = '';
            atSelectedIndex = 0;
            showFormatMenu();
        }
    } else if (atMenuOpen) {
        if (e.key === 'Escape') {
            closeFormatMenu();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            applyFormat();
        } else if (e.key === 'Backspace') {
            atMenuFilter = atMenuFilter.slice(0, -1);
            if(atMenuFilter.length < 0) closeFormatMenu();
            else renderFormatMenu();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            atSelectedIndex = Math.min(atSelectedIndex + 1, getFilteredFormats().length - 1);
            renderFormatMenu();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            atSelectedIndex = Math.max(atSelectedIndex - 1, 0);
            renderFormatMenu();
        } else if (e.key.length === 1 && e.key.match(/[a-z0-9\s]/i)) {
            atMenuFilter += e.key;
            atSelectedIndex = 0;
            renderFormatMenu();
        }
    } else if (e.key === 'Enter') {
        // Prevent complex nesting by defaulting to div on enter if inside headings
        const node = window.getSelection().anchorNode;
        if(node && node.parentNode && node.parentNode.nodeName.match(/^H[1-6]$/)) {
            e.preventDefault();
            document.execCommand('insertParagraph', false);
            document.execCommand('formatBlock', false, 'DIV');
        }
    }
});

function getFilteredFormats() {
    if (!atMenuFilter) return formats;
    return formats.filter(f => f.name.toLowerCase().includes(atMenuFilter.toLowerCase()));
}

function showFormatMenu() {
    formatMenu.classList.remove('hidden');
    renderFormatMenu();
    
    // Position menu near cursor
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        let rect = selection.getRangeAt(0).getBoundingClientRect();
        
        // Handle empty/collapsed ranges returning 0,0,0,0
        if (rect.width === 0 && rect.height === 0) {
            const span = document.createElement('span');
            span.appendChild(document.createTextNode('\u200b'));
            selection.getRangeAt(0).insertNode(span);
            rect = span.getBoundingClientRect();
            span.parentNode.removeChild(span);
        }
        
        const editorRect = editor.getBoundingClientRect();
        
        let top = rect.bottom + window.scrollY + 5;
        let left = rect.left + window.scrollX;
        
        // boundary checks
        if (left + 200 > window.innerWidth) left = window.innerWidth - 210;
        
        formatMenu.style.top = `${top}px`;
        formatMenu.style.left = `${left}px`;
    }
}

function renderFormatMenu() {
    const filtered = getFilteredFormats();
    formatMenu.innerHTML = '';
    
    if(filtered.length === 0) {
        formatMenu.innerHTML = '<div class="format-item"><div class="f-desc">No formats found</div></div>';
        return;
    }
    
    filtered.forEach((f, index) => {
        const div = document.createElement('div');
        div.className = `format-item ${index === atSelectedIndex ? 'selected' : ''}`;
        div.innerHTML = `<div class="f-title">${f.name}</div>`;
        div.onmousedown = (e) => {
            e.preventDefault(); 
            atSelectedIndex = index;
            applyFormat();
        };
        formatMenu.appendChild(div);
    });
    
    const selectedEl = formatMenu.querySelector('.format-item.selected');
    if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
    }
}

function closeFormatMenu() {
    atMenuOpen = false;
    formatMenu.classList.add('hidden');
}

function applyFormat() {
    const filtered = getFilteredFormats();
    if (filtered.length > 0 && atMenuRange) {
        const format = filtered[atSelectedIndex];
        
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            const textNode = range.startContainer;
            if (textNode.nodeType === Node.TEXT_NODE) {
                const endOffset = range.endOffset;
                const startOffset = Math.max(0, endOffset - (atMenuFilter.length + 1));
                range.setStart(textNode, startOffset);
                
                // Select the precise text and use browser's native delete
                // to prevent the cursor from jumping to the previous line
                sel.removeAllRanges();
                sel.addRange(range);
                document.execCommand('delete', false, null);
            }
        }
        
        if (format.id === 'alpha') {
            document.execCommand('insertOrderedList', false, null);
            let node = window.getSelection().anchorNode;
            while(node && node.nodeName !== 'OL' && node.nodeName !== 'DIV') {
                node = node.parentNode;
            }
            if (node && node.nodeName === 'OL') {
                node.setAttribute('type', 'A');
            }
        } else if (format.id === 'code') {
            document.execCommand('formatBlock', false, 'P');
            let node = window.getSelection().anchorNode;
            if (node.nodeType === 3) node = node.parentNode;
            while(node && node !== editor && node.nodeName !== 'P' && node.nodeName !== 'DIV' && !['H1','H2','H3','H4','BLOCKQUOTE','LI'].includes(node.nodeName)) {
                node = node.parentNode;
            }
            if (node && node !== editor) {
                node.className = 'code-block';
            }
        } else if (format.id === 'body') {
            document.execCommand('formatBlock', false, 'P');
            let node = window.getSelection().anchorNode;
            if (node.nodeType === 3) node = node.parentNode;
            while(node && node !== editor && node.nodeName !== 'P' && node.nodeName !== 'DIV' && !['H1','H2','H3','H4','BLOCKQUOTE','LI'].includes(node.nodeName)) {
                node = node.parentNode;
            }
            if (node && node !== editor) {
                node.removeAttribute('class');
            }
        } else {
            document.execCommand(format.cmd, false, format.val);
            let node = window.getSelection().anchorNode;
            if (node.nodeType === 3) node = node.parentNode;
            while(node && node !== editor && !['H1','H2','H3','H4','BLOCKQUOTE','LI','P','DIV'].includes(node.nodeName)) {
                node = node.parentNode;
            }
            if (node && node !== editor && node.classList && node.classList.contains('code-block')) {
                node.removeAttribute('class');
            }
        }
        triggerSave();
    }
    closeFormatMenu();
}

// --- Settings ---
const settingsLabels = {
    title: 'Page Title',
    h1: 'Header 1', h2: 'Header 2', h3: 'Header 3', h4: 'Header 4',
    body: 'Body Text',
    bullet: 'Bullet List', alpha: 'Alpha List', num: 'Number List',
    quote: 'Quote', code: 'Code'
};
const settingsContainer = document.getElementById('settings-container');

themeToggleBtn.onclick = () => {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    applySettingsToCSS();
    triggerSave();
};

settingsBtn.onclick = () => {
    inSettingsMode = true;
    menuToggle.innerHTML = backArrowSVG;
    sidebarPages.classList.add('hidden');
    sidebarSettings.classList.remove('hidden');
    settingsContainer.innerHTML = '';
    
    // Account & Session Group
    const sessionGroup = document.createElement('div');
    sessionGroup.className = 'setting-group';
    sessionGroup.innerHTML = `
        <h4>Account & Session</h4>
        <div class="setting-row">
            <div class="setting-toggle-row">
                <label style="margin: 0; font-size: 0.95rem; text-transform: none; color: var(--text-color); font-weight: 500;">Keep Me Signed In</label>
                <label class="neu-switch">
                    <input type="checkbox" id="keep-signed-in-setting" ${getKeepSignedIn() ? 'checked' : ''}>
                    <span class="neu-switch-slider"></span>
                </label>
            </div>
            <p class="setting-help-text">Preserves your active session and refreshes Google Drive access in the background so you never lose writing time.</p>
        </div>
        <div class="setting-row" style="margin-top: 1rem; border-top: 1px solid var(--sidebar-border); padding-top: 1rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;">
                <div>
                    <div style="font-size: 0.85rem; font-weight: 500;">Google Drive Sync</div>
                    <div id="settings-sync-desc" class="setting-help-text" style="margin-top: 0.2rem;">${accessToken && isTokenValid() ? 'Connected & Synced' : 'Authorization Paused'}</div>
                </div>
                <button id="settings-sync-btn" class="neu-btn" style="padding: 0.5rem 0.9rem; font-size: 0.8rem; font-weight: 600; white-space: nowrap;">
                    ${accessToken && isTokenValid() ? 'Sync Now' : 'Reconnect'}
                </button>
            </div>
        </div>
    `;
    settingsContainer.appendChild(sessionGroup);

    const keepSettingInput = sessionGroup.querySelector('#keep-signed-in-setting');
    if (keepSettingInput) {
        keepSettingInput.addEventListener('change', (e) => {
            setKeepSignedIn(e.target.checked);
        });
    }

    const settingsSyncBtn = sessionGroup.querySelector('#settings-sync-btn');
    if (settingsSyncBtn) {
        settingsSyncBtn.addEventListener('click', () => {
            if (accessToken && isTokenValid()) {
                saveToDrive();
            } else {
                requestAuth(true);
            }
        });
    }

    Object.keys(settingsLabels).forEach(el => {
        const group = document.createElement('div');
        group.className = 'setting-group';
        group.innerHTML = `<h4>${settingsLabels[el]}</h4>`;
        
        const current = state.settings[el] || { font: 'Inter', weight: 400, size: '1rem' };
        
        const fonts = ['Inter', 'Roboto', 'Outfit', 'monospace', 'serif', 'sans-serif', 'Georgia', 'Courier New', 'Times New Roman', 'Arial'];
        const fontOptions = fonts.map(f => `<option value="${f}" ${current.font === f ? 'selected' : ''}>${f}</option>`).join('');
        
        const weights = [300, 400, 500, 600, 700, 800];
        const weightOptions = weights.map(w => `<option value="${w}" ${parseInt(current.weight) === w ? 'selected' : ''}>${w}</option>`).join('');
        
        const currentSize = parseFloat(current.size) || 1.0;
        
        group.innerHTML += `
            <div class="setting-row">
                <label>Font</label>
                <select id="set-${el}-font" class="neu-input">
                    ${fontOptions}
                </select>
            </div>
            <div class="setting-row">
                <label>Weight</label>
                <select id="set-${el}-weight" class="neu-input">
                    ${weightOptions}
                </select>
            </div>
            <div class="setting-row">
                <label>Size (rem)</label>
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <button class="neu-btn size-minus-btn" style="width: 40px; height: 40px; padding: 0;">-</button>
                    <span id="set-${el}-size-display" style="flex: 1; text-align: center; font-size: 1rem; font-weight: 500;">${currentSize.toFixed(1)}</span>
                    <button class="neu-btn size-plus-btn" style="width: 40px; height: 40px; padding: 0;">+</button>
                    <input type="hidden" id="set-${el}-size" value="${currentSize}rem">
                </div>
            </div>
        `;
        
        const updateSetting = () => {
            if(!state.settings[el]) state.settings[el] = {};
            state.settings[el].font = document.getElementById(`set-${el}-font`).value;
            state.settings[el].weight = document.getElementById(`set-${el}-weight`).value;
            state.settings[el].size = document.getElementById(`set-${el}-size`).value;
            
            applySettingsToCSS();
            triggerSave();
        };
        
        group.querySelectorAll('select').forEach(sel => {
            sel.addEventListener('change', updateSetting);
            enhanceSelect(sel);
        });
        
        group.querySelector('.size-minus-btn').onclick = () => {
            let size = parseFloat(document.getElementById(`set-${el}-size`).value);
            size = Math.max(0.5, size - 0.1);
            document.getElementById(`set-${el}-size`).value = size.toFixed(1) + 'rem';
            document.getElementById(`set-${el}-size-display`).textContent = size.toFixed(1);
            updateSetting();
        };
        
        group.querySelector('.size-plus-btn').onclick = () => {
            let size = parseFloat(document.getElementById(`set-${el}-size`).value);
            size = Math.min(5.0, size + 0.1);
            document.getElementById(`set-${el}-size`).value = size.toFixed(1) + 'rem';
            document.getElementById(`set-${el}-size-display`).textContent = size.toFixed(1);
            updateSetting();
        };
        
        settingsContainer.appendChild(group);
    });
};

function applySettingsToCSS() {
    const root = document.documentElement;
    if(!state.settings) return;
    
    if(state.settings.theme === 'dark') {
        document.body.classList.add('dark-mode');
        document.querySelector('.sun-icon').classList.remove('hidden');
        document.querySelector('.moon-icon').classList.add('hidden');
    } else {
        document.body.classList.remove('dark-mode');
        document.querySelector('.sun-icon').classList.add('hidden');
        document.querySelector('.moon-icon').classList.remove('hidden');
    }
    
    Object.keys(settingsLabels).forEach(el => {
        const s = state.settings[el];
        if(s) {
            root.style.setProperty(`--${el}-font`, s.font);
            root.style.setProperty(`--${el}-weight`, s.weight);
            root.style.setProperty(`--${el}-size`, s.size);
        }
    });
}

// Ensure first child is a div when empty
editor.addEventListener('keyup', () => {
    if (editor.innerHTML.trim() === '') {
        editor.innerHTML = '<div><br></div>';
    }
});

// Load Google Scripts
const loadScript = (src, callback) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = callback;
    document.body.appendChild(script);
};

enhanceSelect(document.getElementById('page-sort'));

loadScript("https://accounts.google.com/gsi/client", gisLoaded);
loadScript("https://apis.google.com/js/api.js", gapiLoaded);

// --- Split Text Animation ---
function initSplitText() {
    const brandTitle = document.getElementById('brand-title');
    if (!brandTitle) return;
    
    const text = brandTitle.innerText;
    brandTitle.innerHTML = '';
    
    text.split('').forEach((char, i) => {
        const span = document.createElement('span');
        span.className = 'char';
        span.innerText = char;
        // Stagger the animation delay for each character
        span.style.animationDelay = `${i * 0.05}s`;
        if (char === ' ') {
            span.innerHTML = '&nbsp;';
        }
        brandTitle.appendChild(span);
    });
}
initSplitText();

function enhanceSelect(selectEl) {
    if (selectEl.dataset.enhanced) return;
    selectEl.dataset.enhanced = 'true';
    selectEl.style.display = 'none';
    
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';
    
    const trigger = document.createElement('button');
    trigger.className = 'custom-select-trigger';
    const selectedOption = selectEl.options[selectEl.selectedIndex];
    trigger.innerHTML = `<span>${selectedOption ? selectedOption.text : ''}</span>`;
    
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'custom-select-options';
    
    Array.from(selectEl.options).forEach(opt => {
        const div = document.createElement('div');
        div.className = `custom-select-option ${opt.selected ? 'selected' : ''}`;
        div.textContent = opt.text;
        div.dataset.value = opt.value;
        
        div.onclick = (e) => {
            e.stopPropagation();
            selectEl.value = opt.value;
            trigger.querySelector('span').textContent = opt.text;
            
            Array.from(optionsContainer.children).forEach(c => c.classList.remove('selected'));
            div.classList.add('selected');
            
            wrapper.classList.remove('open');
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        };
        optionsContainer.appendChild(div);
    });
    
    trigger.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isOpen = wrapper.classList.contains('open');
        document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));
        if (!isOpen) wrapper.classList.add('open');
    };
    
    wrapper.appendChild(trigger);
    wrapper.appendChild(optionsContainer);
    selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);
}

document.addEventListener('click', () => {
    document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));
});

// Render cached notes immediately if user chose to stay signed in and has previous session/notes
if (getKeepSignedIn() && (localStorage.getItem(STORAGE_TOKEN_KEY) || (state.pages && state.pages.length > 0))) {
    showApp(true);
}

