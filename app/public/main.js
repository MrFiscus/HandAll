const API_BASE = '/api';

// --- State Management ---
let currentUser = null;
let tasks = [];

// --- DOM Elements ---
const views = {
    setup: document.getElementById('setup-view'),
    motivation: document.getElementById('motivation-view'),
    dashboard: document.getElementById('dashboard-view')
};

const xpBar = document.getElementById('xp-bar');
const userLevel = document.getElementById('user-level');
const userXp = document.getElementById('user-xp');
const taskContainer = document.getElementById('pending-tasks');
const chatBox = document.getElementById('chat-box');
const redlineModal = document.getElementById('redline-modal');

// --- Initialization ---
async function init() {
    await fetchUser();
    if (!currentUser.side_goal) {
        switchView('setup');
    } else {
        switchView('motivation');
    }
    setupEventListeners();
    renderCalendar();
}

async function fetchUser() {
    const res = await fetch(`${API_BASE}/user`);
    currentUser = await res.json();
    updateUserStats();
}

function renderCalendar() {
    const wrapper = document.getElementById('calendar-wrapper');
    if (currentUser && currentUser.google_calendar_url) {
        // Convert shareable link to embed link if necessary
        let url = currentUser.google_calendar_url;
        if (url.includes('calendar.google.com/calendar/u/0?cid=')) {
            const cid = new URL(url).searchParams.get('cid');
            url = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(cid)}&mode=WEEK`;
        } else if (!url.includes('/embed')) {
            // Basic attempt to fix raw links
            url = url.replace('/calendar/render', '/calendar/embed');
            if (!url.includes('mode=WEEK')) url += (url.includes('?') ? '&' : '?') + 'mode=WEEK';
        }
        
        wrapper.innerHTML = `<iframe src="${url}" style="border: 0" width="800" height="600" frameborder="0" scrolling="no"></iframe>`;
    }
}

function updateUserStats() {
    userLevel.innerText = `LVL ${currentUser.level}`;
    userXp.innerText = `${currentUser.xp} XP`;
    const progress = currentUser.xp % 100;
    xpBar.style.width = `${progress}%`;
}

function switchView(viewName) {
    Object.keys(views).forEach(key => {
        views[key].classList.add('hidden');
    });
    views[viewName].classList.remove('hidden');
    if (viewName === 'dashboard') loadTasks();
}

// --- Task Logic ---
async function loadTasks() {
    const res = await fetch(`${API_BASE}/tasks`);
    tasks = await res.json();
    renderTasks();
}

function renderTasks() {
    taskContainer.innerHTML = '';
    tasks.forEach(task => {
        const div = document.createElement('div');
        div.className = `task-item ${task.type} ${task.status}`;
        div.innerHTML = `
            <div class="task-info">
                <h4>${task.title}</h4>
                <small>${task.type} Task • ${task.status}</small>
            </div>
            <div class="task-actions">
                ${task.status === 'Pending' ? `
                    <button onclick="respondTask(${task.id}, 'Accepted')" class="action-btn check">✓</button>
                    <button onclick="respondTask(${task.id}, 'Rejected')" class="action-btn cross">✕</button>
                ` : task.status === 'Accepted' ? `
                    <button onclick="completeTask(${task.id})" class="action-btn check">Complete</button>
                ` : `<span class="text-muted">Done</span>`}
            </div>
        `;
        taskContainer.appendChild(div);
    });
}

async function respondTask(taskId, action) {
    await fetch(`${API_BASE}/tasks/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, action })
    });
    loadTasks();
}

async function completeTask(taskId) {
    const res = await fetch(`${API_BASE}/tasks/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
    });
    const data = await res.json();
    
    // XP Animation
    await fetchUser();
    loadTasks();
}

// --- Event Listeners ---
function setupEventListeners() {
    // Setup View
    document.getElementById('save-setup').onclick = async () => {
        const wake_time = document.getElementById('setup-wake').value;
        const sleep_time = document.getElementById('setup-sleep').value;
        const side_goal = document.getElementById('setup-goal').value;
        const google_calendar_url = document.getElementById('setup-cal').value;

        await fetch(`${API_BASE}/user/setup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wake_time, sleep_time, side_goal, google_calendar_url })
        });
        await fetchUser();
        renderCalendar();
        switchView('motivation');
    };

    // Motivation View
    const meter = document.getElementById('motivation-meter');
    const val = document.getElementById('motivation-value');
    meter.oninput = () => val.innerText = `${meter.value}%`;

    document.getElementById('submit-motivation').onclick = () => {
        const score = parseInt(meter.value);
        if (score <= 10) {
            redlineModal.classList.remove('hidden');
        } else {
            switchView('dashboard');
        }
    };

    // Redline Modal
    document.getElementById('redline-accept').onclick = () => {
        redlineModal.classList.add('hidden');
        addBotMessage("Redline Protocol Active. I've cleared your next 4 hours. Rest up.");
        switchView('dashboard');
    };
    document.getElementById('redline-reject').onclick = () => {
        redlineModal.classList.add('hidden');
        switchView('dashboard');
    };

    // Chat
    document.getElementById('send-chat').onclick = sendChat;
    document.getElementById('chat-input').onkeypress = (e) => { if(e.key === 'Enter') sendChat(); };

    // Sunday Sync
    document.getElementById('run-weekly-sync').onclick = async () => {
        const res = await fetch(`${API_BASE}/tasks/weekly-sync`, { method: 'POST' });
        const data = await res.json();
        addBotMessage(`Sunday Sync Complete. I've added ${data.count} new tasks for your review.`);
        loadTasks();
    };
}

async function sendChat() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;

    addUserMessage(text);
    input.value = '';

    const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
    });
    const data = await res.json();
    addBotMessage(data.reply);
}

function addUserMessage(msg) {
    const div = document.createElement('div');
    div.className = 'msg user';
    div.innerText = msg;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function addBotMessage(msg) {
    const div = document.createElement('div');
    div.className = 'msg bot';
    div.innerText = msg;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

init();