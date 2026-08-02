// Configuration - User should replace this with their actual Client ID
const CLIENT_ID = '593289261918-4or87gs5krjoildr9n694j2hr7f93n2m.apps.googleusercontent.com'; 
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

let tokenClient;
let gapiInited = false;
let gisInited = false;
let accessToken = null;

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

let dataFileId = null;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app');
const authBtn = document.getElementById('auth-button');
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
const settingsModal = document.getElementById('settings-modal');

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
            if (resp.error !== undefined) throw (resp);
            accessToken = resp.access_token;
            localStorage.setItem('minimal_writing_token', accessToken);
            showApp();
        },
    });
    gisInited = true;
    checkAuth();
}

function checkAuth() {
    if (gapiInited && gisInited) {
        const savedToken = localStorage.getItem('minimal_writing_token');
        if (savedToken) {
            gapi.client.setToken({ access_token: savedToken });
            accessToken = savedToken;
            showApp();
        }
    }
}

authBtn.onclick = () => {
    if (CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID_HERE') {
        alert("Please set your Google Client ID in app.js before authenticating.");
        return;
    }
    tokenClient.requestAccessToken({prompt: 'consent'});
};

logoutBtn.onclick = () => {
    localStorage.removeItem('minimal_writing_token');
    location.reload();
};

async function showApp() {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    await loadDataFromDrive();
    applySettingsToCSS();
    renderSidebar();
}

// --- Drive Operations ---
async function loadDataFromDrive() {
    try {
        let response = await gapi.client.drive.files.list({
            spaces: 'appDataFolder',
            fields: 'files(id, name)',
            pageSize: 10
        });
        
        let files = response.result.files;
        let dataFile = files.find(f => f.name === 'minimal_writing_data.json');
        
        if (dataFile) {
            dataFileId = dataFile.id;
            let fileResponse = await gapi.client.drive.files.get({
                fileId: dataFileId,
                alt: 'media'
            });
            let data = fileResponse.result;
            if (data && typeof data === 'object') {
                state = { ...state, ...data };
                if (!state.settings) state.settings = {};
            }
        } else {
            state.pages = [{ id: Date.now().toString(), title: 'Untitled', content: '<div><br></div>', lastModified: Date.now() }];
            state.activePageId = state.pages[0].id;
            await saveToDrive(true);
        }
        
        if (!state.activePageId && state.pages.length > 0) {
            state.activePageId = state.pages[0].id;
        }
        if(state.activePageId) loadPage(state.activePageId);
    } catch (err) {
        console.error("Drive load error", err);
        if (err.status === 401) {
            localStorage.removeItem('minimal_writing_token');
            location.reload();
        }
    }
}

async function saveToDrive(isNew = false) {
    if (!accessToken) return;
    
    const fileContent = JSON.stringify(state);
    const file = new Blob([fileContent], { type: 'application/json' });
    const metadata = { name: 'minimal_writing_data.json', parents: ['appDataFolder'] };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    const url = isNew || !dataFileId 
        ? 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'
        : `https://www.googleapis.com/upload/drive/v3/files/${dataFileId}?uploadType=multipart`;
        
    const method = isNew || !dataFileId ? 'POST' : 'PATCH';

    try {
        let res = await fetch(url, {
            method: method,
            headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
            body: form
        });
        let val = await res.json();
        if (isNew || !dataFileId) dataFileId = val.id;
    } catch(e) {
        console.error("Save error", e);
    }
}

// Debounce save (triggers automatically every few seconds on edit)
let saveTimeout;
function triggerSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        const page = state.pages.find(p => p.id === state.activePageId);
        if (page) {
            page.title = pageTitle.value;
            page.content = editor.innerHTML;
            page.lastModified = Date.now();
            renderSidebar();
        }
        saveToDrive();
    }, 3000);
}

pageTitle.addEventListener('input', triggerSave);
editor.addEventListener('input', triggerSave);

// --- UI Logic ---
menuToggle.onclick = () => { sidebar.classList.toggle('open'); };

function renderSidebar() {
    pageList.innerHTML = '';
    state.pages.sort((a,b) => b.lastModified - a.lastModified).forEach(p => {
        const li = document.createElement('li');
        li.className = `page-item ${p.id === state.activePageId ? 'active' : ''}`;
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'page-name';
        nameSpan.textContent = p.title || 'Untitled';
        nameSpan.onclick = () => {
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
        
        li.appendChild(nameSpan);
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
        editor.innerHTML = page.content;
    }
    renderSidebar();
}

newPageBtn.onclick = () => {
    const newPage = {
        id: Date.now().toString(),
        title: 'Untitled',
        content: '<div><br></div>',
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
    { id: 'h1', name: 'Header 1', cmd: 'formatBlock', val: 'H1', desc: 'Large heading' },
    { id: 'h2', name: 'Header 2', cmd: 'formatBlock', val: 'H2', desc: 'Medium heading' },
    { id: 'h3', name: 'Header 3', cmd: 'formatBlock', val: 'H3', desc: 'Small heading' },
    { id: 'h4', name: 'Header 4', cmd: 'formatBlock', val: 'H4', desc: 'Extra small heading' },
    { id: 'bullet', name: 'Bullet List', cmd: 'insertUnorderedList', val: null, desc: 'Unordered list' },
    { id: 'num', name: 'Number List', cmd: 'insertOrderedList', val: null, desc: 'Ordered list' },
    { id: 'alpha', name: 'Alpha List', cmd: 'alphaList', val: null, desc: 'A, B, C list' },
    { id: 'quote', name: 'Quote', cmd: 'formatBlock', val: 'BLOCKQUOTE', desc: 'Blockquote' },
    { id: 'code', name: 'Code', cmd: 'formatBlock', val: 'PRE', desc: 'Code block' },
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
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        const editorRect = editor.getBoundingClientRect();
        
        let top = rect.bottom + 5;
        let left = rect.left;
        
        // boundary checks
        if (left + 260 > window.innerWidth) left = window.innerWidth - 270;
        
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
        div.innerHTML = `<div class="f-title">${f.name}</div><div class="f-desc">${f.desc}</div>`;
        div.onmousedown = (e) => {
            e.preventDefault(); 
            atSelectedIndex = index;
            applyFormat();
        };
        formatMenu.appendChild(div);
    });
}

function closeFormatMenu() {
    atMenuOpen = false;
    formatMenu.classList.add('hidden');
}

function applyFormat() {
    const filtered = getFilteredFormats();
    if (filtered.length > 0 && atMenuRange) {
        const format = filtered[atSelectedIndex];
        
        // Select the '@' and typed filter
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(atMenuRange);
        
        // delete the @... text
        for(let i=0; i <= atMenuFilter.length; i++){
            document.execCommand('delete', false, null);
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
        } else {
            document.execCommand(format.cmd, false, format.val);
        }
        triggerSave();
    }
    closeFormatMenu();
}

// --- Settings ---
const settingsLabels = {
    h1: 'Header 1', h2: 'Header 2', h3: 'Header 3', h4: 'Header 4',
    bullet: 'Bullet List', alpha: 'Alpha List', num: 'Number List',
    quote: 'Quote', code: 'Code'
};
const settingsContainer = document.getElementById('settings-container');

settingsBtn.onclick = () => {
    sidebar.classList.remove('open');
    settingsContainer.innerHTML = '';
    
    Object.keys(settingsLabels).forEach(el => {
        const group = document.createElement('div');
        group.className = 'setting-group';
        group.innerHTML = `<h4>${settingsLabels[el]}</h4>`;
        
        const current = state.settings[el] || { font: 'Inter', weight: 400, size: '1rem' };
        
        ['font', 'weight', 'size'].forEach(prop => {
            const row = document.createElement('div');
            row.className = 'setting-row';
            row.innerHTML = `<label>${prop}</label>
                <input type="text" id="set-${el}-${prop}" value="${current[prop]}">`;
            group.appendChild(row);
        });
        
        settingsContainer.appendChild(group);
    });
    
    settingsModal.classList.remove('hidden');
};

document.getElementById('close-settings-btn').onclick = () => {
    Object.keys(settingsLabels).forEach(el => {
        if(!state.settings[el]) state.settings[el] = {};
        state.settings[el].font = document.getElementById(`set-${el}-font`).value;
        state.settings[el].weight = document.getElementById(`set-${el}-weight`).value;
        state.settings[el].size = document.getElementById(`set-${el}-size`).value;
    });
    
    applySettingsToCSS();
    settingsModal.classList.add('hidden');
    triggerSave();
};

function applySettingsToCSS() {
    const root = document.documentElement;
    if(!state.settings) return;
    
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

loadScript("https://accounts.google.com/gsi/client", gisLoaded);
loadScript("https://apis.google.com/js/api.js", gapiLoaded);
