const state = {
  occupants: [],
  rooms: [],
  leads: [],
  groups: [],
  activity: [],
  currentMessageTarget: null,
  currentInspectionTarget: null,
};

const templates = {
  occupant: [
    'Hi {name}, just checking in about the inspection details for {houseCode} {room}.',
    'Hi {name}, can you please confirm your move-in timing for {houseCode} {room}?',
    'Hi {name}, just a reminder to send the remaining documents for {houseCode} {room}.'
  ],
  lead: [
    'Hi {name}, thanks for your interest in {houseCode} {room}. Are you applying just for yourself or with someone else?',
    'Hi {name}, we have an inspection slot for {houseCode} {room}. Would {inspection_date} at {inspection_time} work for you?',
    'Hi {name}, just following up on your interest in {houseCode} {room}.',
    'Hi {name}, just confirming for {houseCode} {room}, would it be only yourself living there, or someone else as well?'
  ],
  group: [
    'Hi everyone, this is a mock house group notice for {houseCode}.',
    'Reminder: inspection activity is scheduled soon for {houseCode}.',
    'Quick operational update for the house group at {houseCode}.'
  ]
};

async function loadJson(path) {
  const res = await fetch(path);
  return res.json();
}

async function init() {
  const [occupants, rooms, leads, groups, activity] = await Promise.all([
    loadJson('data/mock-active-occupants.json'),
    loadJson('data/mock-jess-rooms.json'),
    loadJson('data/mock-jess-enquirers.json'),
    loadJson('data/mock-house-groups.json'),
    loadJson('data/mock-activity.json')
  ]);

  state.occupants = occupants;
  state.rooms = rooms;
  state.leads = leads;
  state.groups = groups;
  state.activity = activity;

  bindNav();
  bindModal();
  renderAll();
}

function bindNav() {
  document.querySelectorAll('.sidebar button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sidebar button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      document.querySelectorAll('main section').forEach(sec => sec.classList.add('hidden'));
      document.getElementById(`view-${view}`).classList.remove('hidden');
    });
  });
}

function bindModal() {
  document.getElementById('close-modal').addEventListener('click', closeModal);
  document.getElementById('confirm-send').addEventListener('click', confirmMockSend);
  document.getElementById('message-template').addEventListener('change', (e) => {
    const body = applyTemplate(e.target.value, state.currentMessageTarget);
    document.getElementById('message-body').value = body;
  });
  document.getElementById('close-inspection-modal').addEventListener('click', closeInspectionModal);
  document.getElementById('confirm-inspection').addEventListener('click', confirmInspection);
}

function renderAll() {
  renderOverview();
  renderOccupants();
  renderLeads();
  renderGroups();
  renderActivity();
}

function renderOverview() {
  const root = document.getElementById('view-overview');
  const vacancyCards = state.rooms.map(room => {
    const showContribution = room.available || room.underNotice;
    return `
      <div class="card">
        <h3>${room.houseCode} ${room.room}</h3>
        <span class="badge ${room.available ? 'good' : room.underNotice ? 'warn' : 'danger'}">
          ${room.available ? 'Vacant' : room.underNotice ? 'Under notice' : 'Occupied'}
        </span>
        <div class="kv">
          <div>Inspection: ${room.inspection_date || 'Not set'} ${room.inspection_time || ''}</div>
          <div>Assistant: ${room.assistant || 'Unassigned'}</div>
          <div>Listing active: ${room.listingActive ? 'Yes' : 'No'}</div>
          <div>Contribution: ${showContribution ? '$' + room.weeklyContribution + '/wk' : 'Hidden until vacant or under notice'}</div>
        </div>
        <div class="actions">
          <button onclick="openInspection('${room.id}')">Book inspection</button>
          <button class="secondary" onclick="markFilled('${room.id}')">Mark filled</button>
          <button class="secondary" onclick="openGroupMessage('${room.houseCode}')">Message house group</button>
        </div>
      </div>
    `;
  }).join('');

  const watchLead = state.leads.find(l => l.id === 'lead_001');
  root.innerHTML = `
    <div class="toolbar">
      <h2>Overview</h2>
      <div class="note">Phase 1 mock operations console</div>
    </div>
    <div class="card" style="margin-bottom:16px; border-color: rgba(255,182,72,.45);">
      <h3>Watch item: Ana Clara · SP9 R2</h3>
      <div class="kv">
        <div>Phone: ${watchLead.phone}</div>
        <div>Status: ${watchLead.status}</div>
        <div>Key question: is it only herself, or someone else with her?</div>
        <div>Last note: ${watchLead.notes}</div>
      </div>
      <div class="actions">
        <button onclick="openLeadQuestion('lead_001')">Ask occupancy question</button>
        <button class="secondary" onclick="openInspectionForLead('lead_001')">Book inspection</button>
      </div>
    </div>
    <div class="grid">${vacancyCards}</div>
  `;
}

function renderOccupants() {
  const root = document.getElementById('view-occupants');
  root.innerHTML = `
    <div class="toolbar">
      <h2>Occupants</h2>
      <input class="search" placeholder="Search occupants..." oninput="filterOccupants(this.value)" />
    </div>
    <div id="occupant-list" class="list"></div>
  `;
  drawOccupantList(state.occupants);
}

function drawOccupantList(items) {
  const list = document.getElementById('occupant-list');
  list.innerHTML = items.map(person => `
    <div class="card">
      <h3>${person.name}</h3>
      <div class="kv">
        <div>House/Room: ${person.houseCode} ${person.room}</div>
        <div>Status: ${person.status}${person.underNotice ? ' (under notice)' : ''}</div>
        <div>Phone: ${person.phone}</div>
        <div>Email: ${person.email}</div>
        <div>Docs: ${person.documents.map(d => d.label).join(', ')}</div>
        <div>Notes: ${person.notes || '—'}</div>
      </div>
      <div class="actions">
        <button onclick="openMessage('occupant', '${person.id}')">Message occupant</button>
        <button class="secondary" onclick="flagDeparture('${person.id}')">Flag departure</button>
        <button class="secondary" onclick="logNote('${person.houseCode}', '${person.id}')">Log note</button>
      </div>
    </div>
  `).join('');
}

function filterOccupants(query) {
  const q = query.toLowerCase();
  drawOccupantList(state.occupants.filter(o => o.name.toLowerCase().includes(q) || o.houseCode.toLowerCase().includes(q)));
}

function renderLeads() {
  const root = document.getElementById('view-leads');
  root.innerHTML = `
    <div class="toolbar">
      <h2>Leads / Flatmates Pipeline</h2>
      <div class="note">Includes Ana Clara watch item</div>
    </div>
    <div class="list">
      ${state.leads.map(lead => `
        <div class="card">
          <h3>${lead.name}</h3>
          <span class="badge ${lead.priority === 'high' ? 'danger' : lead.priority === 'medium' ? 'warn' : 'good'}">${lead.priority}</span>
          <div class="kv">
            <div>Target: ${lead.houseCode} ${lead.targetRoom}</div>
            <div>Status: ${lead.status}</div>
            <div>Phone: ${lead.phone}</div>
            <div>Email: ${lead.email}</div>
            <div>Last message: ${lead.lastMessage}</div>
            <div>Notes: ${lead.notes}</div>
            ${lead.id === 'lead_001' ? '<div><strong>Tracked clarification:</strong> Need to confirm solo occupancy or additional person.</div>' : ''}
          </div>
          <div class="actions">
            <button onclick="openMessage('lead', '${lead.id}')">Message lead</button>
            <button class="secondary" onclick="openLeadQuestion('${lead.id}')">Ask occupancy question</button>
            <button class="secondary" onclick="openInspectionForLead('${lead.id}')">Book inspection</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderGroups() {
  const root = document.getElementById('view-groups');
  root.innerHTML = `
    <div class="toolbar">
      <h2>House Groups</h2>
      <div class="note">Mock WA group actions only</div>
    </div>
    <div class="list">
      ${state.groups.map(group => `
        <div class="card">
          <h3>${group.groupName}</h3>
          <div class="kv">
            <div>House: ${group.houseCode}</div>
            <div>Group JID: ${group.groupJid}</div>
          </div>
          <div class="actions">
            <button onclick="openGroupMessage('${group.houseCode}')">Message house group</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderActivity() {
  const root = document.getElementById('view-activity');
  root.innerHTML = `
    <div class="toolbar">
      <h2>Activity</h2>
      <div class="note">Prototype-only action log</div>
    </div>
    <div class="list">
      ${state.activity.slice().reverse().map(item => `
        <div class="activity-item">
          <strong>${item.actor}</strong> · ${item.action} · ${item.targetType} ${item.targetId || ''}
          <div class="small">${item.ts} · ${item.houseCode || '—'} · ${item.detail || ''}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function openMessage(type, id) {
  const target = type === 'occupant'
    ? state.occupants.find(x => x.id === id)
    : state.leads.find(x => x.id === id);
  state.currentMessageTarget = { type, ...target };
  showMessageModal(type, target.name, `${target.houseCode} ${target.room || target.targetRoom}`);
}

function openGroupMessage(houseCode) {
  const group = state.groups.find(g => g.houseCode === houseCode);
  state.currentMessageTarget = { type: 'group', ...group, name: group.groupName };
  showMessageModal('group', group.groupName, houseCode);
}

function openLeadQuestion(id) {
  openMessage('lead', id);
  const lead = state.leads.find(x => x.id === id);
  const select = document.getElementById('message-template');
  select.value = templates.lead[0];
  document.getElementById('message-body').value = applyTemplate(templates.lead[0], lead);
}

function openInspection(roomId) {
  const room = state.rooms.find(r => r.id === roomId);
  state.currentInspectionTarget = room;
  document.getElementById('inspection-title').textContent = `Book Inspection: ${room.houseCode} ${room.room}`;
  document.getElementById('inspection-target').textContent = `Listing active: ${room.listingActive ? 'Yes' : 'No'} · Current assistant: ${room.assistant || 'Unassigned'}`;
  document.getElementById('inspection-date').value = room.inspection_date || '';
  document.getElementById('inspection-time').value = room.inspection_time || '';
  document.getElementById('inspection-assistant').value = room.assistant || 'Mathis';
  document.getElementById('inspection-modal').classList.add('open');
}

function openInspectionForLead(id) {
  const lead = state.leads.find(l => l.id === id);
  const room = state.rooms.find(r => r.houseCode === lead.houseCode && r.room === lead.targetRoom) || state.rooms.find(r => r.houseCode === lead.houseCode);
  if (room) {
    openInspection(room.id);
    addActivity({
      actor: 'Staff',
      action: 'inspection_book_intent',
      targetType: 'lead',
      targetId: id,
      houseCode: lead.houseCode,
      detail: `Mock inspection booking started for ${lead.name}`
    });
    renderActivity();
  }
}

function markFilled(roomId) {
  const room = state.rooms.find(r => r.id === roomId);
  room.available = false;
  room.underNotice = false;
  addActivity({
    actor: 'Staff',
    action: 'room_marked_filled',
    targetType: 'room',
    targetId: roomId,
    houseCode: room.houseCode,
    detail: `${room.houseCode} ${room.room} marked filled in prototype`
  });
  renderAll();
}

function flagDeparture(occupantId) {
  const occ = state.occupants.find(o => o.id === occupantId);
  occ.underNotice = true;
  addActivity({
    actor: 'Staff',
    action: 'departure_flagged',
    targetType: 'occupant',
    targetId: occupantId,
    houseCode: occ.houseCode,
    detail: `${occ.name} flagged under notice in prototype`
  });
  renderAll();
}

function logNote(houseCode, occupantId) {
  addActivity({
    actor: 'Staff',
    action: 'note_added',
    targetType: 'occupant',
    targetId: occupantId,
    houseCode,
    detail: 'Prototype note added'
  });
  renderActivity();
  alert('Prototype note logged.');
}

function showMessageModal(type, name, contextText) {
  const modal = document.getElementById('message-modal');
  modal.classList.add('open');
  document.getElementById('modal-title').textContent = `Message preview: ${name}`;
  document.getElementById('modal-target').textContent = `${type.toUpperCase()} · ${contextText}`;
  const select = document.getElementById('message-template');
  select.innerHTML = templates[type].map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  document.getElementById('message-body').value = applyTemplate(templates[type][0], state.currentMessageTarget);
}

function closeModal() {
  document.getElementById('message-modal').classList.remove('open');
}

function closeInspectionModal() {
  document.getElementById('inspection-modal').classList.remove('open');
}

function confirmInspection() {
  const room = state.currentInspectionTarget;
  if (!room) return;
  room.inspection_date = document.getElementById('inspection-date').value || room.inspection_date;
  room.inspection_time = document.getElementById('inspection-time').value || room.inspection_time;
  room.assistant = document.getElementById('inspection-assistant').value;
  addActivity({
    actor: 'Staff',
    action: 'inspection_booked',
    targetType: 'room',
    targetId: room.id,
    houseCode: room.houseCode,
    detail: `${room.houseCode} ${room.room} booked for ${room.inspection_date} ${room.inspection_time} with ${room.assistant}`
  });
  closeInspectionModal();
  renderAll();
}

function confirmMockSend() {
  const target = state.currentMessageTarget;
  const body = document.getElementById('message-body').value;
  addActivity({
    actor: 'Staff',
    action: 'wa_mock_sent',
    targetType: target.type,
    targetId: target.id || target.groupJid,
    houseCode: target.houseCode,
    detail: body.slice(0, 120)
  });
  closeModal();
  renderActivity();
  alert('Mock WhatsApp send logged. No live message was sent.');
}

function addActivity(entry) {
  state.activity.push({
    ts: new Date().toISOString(),
    ...entry
  });
}

function applyTemplate(template, target) {
  return template
    .replaceAll('{name}', target?.name || '')
    .replaceAll('{houseCode}', target?.houseCode || '')
    .replaceAll('{room}', target?.room || target?.targetRoom || '')
    .replaceAll('{inspection_date}', target?.inspection_date || 'the scheduled date')
    .replaceAll('{inspection_time}', target?.inspection_time || 'the scheduled time');
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

init();

window.openInspection = openInspection;
window.markFilled = markFilled;
window.openGroupMessage = openGroupMessage;
window.openMessage = openMessage;
window.flagDeparture = flagDeparture;
window.logNote = logNote;
window.openLeadQuestion = openLeadQuestion;
window.openInspectionForLead = openInspectionForLead;
window.filterOccupants = filterOccupants;
