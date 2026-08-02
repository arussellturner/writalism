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
const sidebarPages = document.getElementById('sidebar-pages');
const sidebarSettings = document.getElementById('sidebar-settings');
const themeToggleBtn = document.getElementById('theme-toggle-btn');

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
            } else {
                console.error("Failed to load file content.");
            }
        } else {
            state.pages = [{ id: Date.now().toString(), title: 'Untitled', content: '<div><br></div>', created: Date.now(), lastModified: Date.now() }];
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
                alert("Your session has expired! Please copy any unsaved writing, refresh the page, and sign in again.");
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
            alert("Your session has expired! Please copy any unsaved writing, refresh the page, and sign in again.");
            return;
        }
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

// Fade out menu button when typing
editor.addEventListener('keydown', (e) => {
    // Only fade if it's a character or structural key
    if(e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace') {
        menuToggle.classList.add('fade-out');
    }
});

const showMenuBtn = () => menuToggle.classList.remove('fade-out');
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
        
        group.querySelectorAll('select').forEach(sel => sel.addEventListener('change', updateSetting));
        
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

loadScript("https://accounts.google.com/gsi/client", gisLoaded);
loadScript("https://apis.google.com/js/api.js", gapiLoaded);
