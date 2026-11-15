import { supabase, initPage, check, esc, fullName, peopleById, formatDateTime } from './common.js';

const perms = await initPage('edit.html');
const params = new URLSearchParams(location.search);
const panel = document.getElementById('panel');
const messages = document.getElementById('messages');

// Which forms this role can use. Counselors only update appointment notes,
// assignments and attendance, so they never see the client form or "new" options.
const tabs = [];
if (perms.editClients) tabs.push({ key: 'client', label: 'Client' });
tabs.push({ key: 'appointment', label: 'Appointment' });

let current = params.get('type');
if (!tabs.some(t => t.key === current)) current = perms.editClients ? 'client' : 'appointment';

document.getElementById('intro').textContent = perms.editClients
  ? 'Add a new client or appointment, or choose an existing one to change it.'
  : 'As a counselor you can update an appointment’s notes, each client’s assignment, and whether they kept the appointment.';

function renderTabs() {
  document.getElementById('tabs').innerHTML = tabs.map(t =>
    `<button type="button" role="tab" data-tab="${t.key}" aria-selected="${t.key === current}">${t.label}</button>`).join('');
}
document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b || b.dataset.tab === current) return;
  current = b.dataset.tab;
  history.replaceState(null, '', `edit.html?type=${current}`);
  messages.innerHTML = '';
  renderTabs();
  show(null);
});

function message(kind, text) {
  messages.innerHTML = '';
  const div = document.createElement('div');
  div.className = `alert alert-${kind}`;
  if (kind === 'error') div.setAttribute('role', 'alert');
  div.textContent = text;
  messages.appendChild(div);
  div.scrollIntoView({ block: 'nearest' });
}

// Empty strings become null so the database stores "no value".
const val = (form, name) => {
  const v = form.elements[name]?.value.trim();
  return v === '' || v === undefined ? null : v;
};
const num = (form, name) => {
  const v = val(form, name);
  return v === null ? null : Number(v);
};

// ---------- Lookup lists ----------

async function clientOptions() {
  const rows = check(await supabase.from('client').select('clientid'), 'Loading clients');
  const names = await peopleById(rows.map(r => r.clientid));
  return rows.map(r => ({ id: r.clientid, name: fullName(names.get(r.clientid)) || `#${r.clientid}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function staffOptions() {
  const [counselors, employees, rooms] = await Promise.all([
    supabase.from('counselor').select('counselorid, degreesuffix').then(r => check(r, 'Loading counselors')),
    supabase.from('employee').select('employeeid').then(r => check(r, 'Loading employees')),
    supabase.from('room').select('roomnumber, roomname').order('roomnumber').then(r => check(r, 'Loading rooms')),
  ]);
  const names = await peopleById([...counselors.map(c => c.counselorid), ...employees.map(e => e.employeeid)]);
  return {
    counselors: counselors.map(c => ({ id: c.counselorid, name: fullName(names.get(c.counselorid)) + (c.degreesuffix ? `, ${c.degreesuffix}` : '') }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    employees: employees.map(e => ({ id: e.employeeid, name: fullName(names.get(e.employeeid)) || `#${e.employeeid}` }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    rooms: rooms.map(r => ({ id: r.roomnumber, name: `${r.roomnumber}${r.roomname ? ' – ' + r.roomname : ''}` })),
  };
}

const options = (list, selected, blank) =>
  (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') +
  list.map(o => `<option value="${o.id}"${o.id === selected ? ' selected' : ''}>${esc(o.name)}</option>`).join('');

// ---------- Client form ----------

async function showClientForm(id) {
  panel.innerHTML = '<p class="subtle">Loading…</p>';
  const clients = await clientOptions();
  let person = {}, client = {};
  if (id) {
    [person, client] = await Promise.all([
      supabase.from('person').select('personid, firstname, lastname, address, city, state, zip, phone, email')
        .eq('personid', id).maybeSingle().then(r => check(r, 'Loading client')),
      supabase.from('client').select('clientid, foundout, remindermethod, referredby')
        .eq('clientid', id).maybeSingle().then(r => check(r, 'Loading client')),
    ]);
    if (!person || !client) { message('error', 'That client was not found.'); person = {}; client = {}; id = null; }
  }
  const allClients = check(await supabase.from('client').select('foundout, remindermethod'), 'Loading choices');
  const distinct = key => [...new Set(allClients.map(c => c[key]).filter(Boolean))].sort();

  const v = x => esc(x ?? '');
  panel.innerHTML = `
    <div class="card">
      <div class="row">
        <div class="grow">
          <label for="pick">Client</label>
          <select id="pick">
            <option value="">➕ New client</option>
            ${options(clients, id ?? null)}
          </select>
        </div>
        ${id ? `<a class="btn btn-quiet" href="lookup.html?id=${id}">View in client lookup</a>` : ''}
      </div>
    </div>
    <form class="card" id="client-form" novalidate>
      <h2>${id ? `Edit ${esc(fullName(person))}` : 'New client'}</h2>
      <h3>Contact information</h3>
      <div class="form-grid">
        <div class="field"><label for="firstname">First name *</label><input id="firstname" name="firstname" maxlength="50" required value="${v(person.firstname)}"></div>
        <div class="field"><label for="lastname">Last name *</label><input id="lastname" name="lastname" maxlength="50" required value="${v(person.lastname)}"></div>
        <div class="field"><label for="phone">Phone</label><input id="phone" name="phone" type="tel" maxlength="14" value="${v(person.phone)}"></div>
        <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" maxlength="100" value="${v(person.email)}"></div>
      </div>
      <div class="form-grid">
        <div class="field"><label for="address">Address</label><input id="address" name="address" maxlength="50" value="${v(person.address)}"></div>
        <div class="field"><label for="city">City</label><input id="city" name="city" maxlength="50" value="${v(person.city)}"></div>
        <div class="field"><label for="state">State</label><input id="state" name="state" maxlength="2" placeholder="VA" value="${v(person.state)}"></div>
        <div class="field"><label for="zip">ZIP</label><input id="zip" name="zip" maxlength="10" value="${v(person.zip?.trim())}"></div>
      </div>
      <h3>Client details</h3>
      <div class="form-grid">
        <div class="field"><label for="foundout">How they found out about RAFT</label>
          <input id="foundout" name="foundout" maxlength="50" list="foundout-list" value="${v(client.foundout)}">
          <datalist id="foundout-list">${distinct('foundout').map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
        <div class="field"><label for="remindermethod">Reminder method</label>
          <input id="remindermethod" name="remindermethod" maxlength="50" list="reminder-list" value="${v(client.remindermethod)}">
          <datalist id="reminder-list">${distinct('remindermethod').map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
        <div class="field"><label for="referredby">Referred by (another client)</label>
          <select id="referredby" name="referredby">${options(clients.filter(c => c.id !== id), client.referredby ?? null, 'No one')}</select></div>
      </div>
      <button class="btn" type="submit">${id ? 'Save changes' : 'Add client'}</button>
    </form>`;

  document.getElementById('pick').addEventListener('change', (e) => {
    messages.innerHTML = '';
    show(e.target.value ? Number(e.target.value) : null);
  });

  const form = document.getElementById('client-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const personRow = {
      firstname: val(form, 'firstname'), lastname: val(form, 'lastname'),
      address: val(form, 'address'), city: val(form, 'city'),
      state: val(form, 'state')?.toUpperCase() ?? null, zip: val(form, 'zip'),
      phone: val(form, 'phone'), email: val(form, 'email'),
    };
    const clientRow = {
      foundout: val(form, 'foundout'), remindermethod: val(form, 'remindermethod'), referredby: num(form, 'referredby'),
    };
    if (!personRow.firstname || !personRow.lastname) return message('error', 'Enter a first and last name.');
    if (personRow.state && !/^[A-Z]{2}$/.test(personRow.state)) return message('error', 'State must be two letters, like VA.');
    if (personRow.email && !form.email.checkValidity()) return message('error', 'That email address does not look right.');

    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (id) {
        check(await supabase.from('person').update(personRow).eq('personid', id), 'Saving contact information');
        check(await supabase.from('client').update(clientRow).eq('clientid', id), 'Saving client details');
        sessionStorage.setItem('raft-saved', 'Client saved.');
        location.href = `edit.html?type=client&id=${id}`;
      } else {
        const created = check(await supabase.from('person').insert(personRow).select('personid').single(), 'Adding person');
        const r = await supabase.from('client').insert({ clientid: created.personid, ...clientRow });
        if (r.error) throw new Error(`The person was added (#${created.personid}) but could not be made a client: ${r.error.message}`);
        sessionStorage.setItem('raft-saved', `Client added (#${created.personid}).`);
        location.href = `edit.html?type=client&id=${created.personid}`;
      }
    } catch (err) {
      message('error', err.message);
      btn.disabled = false;
    }
  });
}

// ---------- Appointment form ----------

async function showAppointmentForm(id) {
  panel.innerHTML = '<p class="subtle">Loading…</p>';
  const apptCols = ['appointmentid', 'appointmenttime', 'duration', 'counselorid', 'employeeid', 'roomnumber'];
  if (perms.seeNotes) apptCols.push('notes');
  const sfCols = ['appointmentid', 'clientid', 'kept'];
  if (perms.seeAssignment) sfCols.push('assignment');

  const [staff, clients, apptList] = await Promise.all([
    staffOptions(),
    clientOptions(),
    supabase.from('appointment').select('appointmentid, appointmenttime, counselorid')
      .order('appointmenttime', { ascending: false }).then(r => check(r, 'Loading appointments')),
  ]);
  const clientName = new Map(clients.map(c => [c.id, c.name]));
  const counselorName = new Map(staff.counselors.map(c => [c.id, c.name]));

  if (!id && !perms.editAppointments && apptList.length) {
    // Counselors cannot add appointments; open the most recent one instead of an empty form.
    id = apptList[0].appointmentid;
  }

  let appt = { duration: 50 };
  let rows = []; // scheduledfor rows already in the database
  if (id) {
    appt = check(await supabase.from('appointment').select(apptCols.join(', ')).eq('appointmentid', id).maybeSingle(), 'Loading appointment');
    if (!appt) { message('error', 'That appointment was not found.'); appt = { duration: 50 }; id = null; }
    else rows = check(await supabase.from('scheduledfor').select(sfCols.join(', ')).eq('appointmentid', id), 'Loading clients on this appointment');
  }
  const preselect = !id && params.get('client') ? Number(params.get('client')) : null;
  const added = preselect && clientName.has(preselect) ? [{ clientid: preselect, kept: null, assignment: null }] : [];

  const canSchedule = perms.editAppointments;   // time, length, counselor, booked by, room, add clients
  const lock = canSchedule ? '' : 'disabled';
  const timeValue = appt.appointmenttime ? appt.appointmenttime.replace(' ', 'T').slice(0, 16) : '';

  panel.innerHTML = `
    <div class="card">
      <label for="pick">Appointment</label>
      <select id="pick">
        ${canSchedule ? '<option value="">➕ New appointment</option>' : ''}
        ${apptList.map(a => `<option value="${a.appointmentid}"${a.appointmentid === id ? ' selected' : ''}>${esc(formatDateTime(a.appointmenttime))} – ${esc(counselorName.get(a.counselorid) || '')} (#${a.appointmentid})</option>`).join('')}
      </select>
      ${!apptList.length && !canSchedule ? '<p class="empty">There are no appointments.</p>' : ''}
    </div>
    ${!id && !canSchedule ? '' : `
    <form class="card" id="appt-form" novalidate>
      <h2>${id ? `Appointment #${id}` : 'New appointment'}</h2>
      ${!canSchedule ? '<p class="subtle">The time, room and staff can only be changed by a scheduler or admin.</p>' : ''}
      <div class="form-grid">
        <div class="field"><label for="appointmenttime">Date and time *</label>
          <input id="appointmenttime" name="appointmenttime" type="datetime-local" value="${esc(timeValue)}" ${lock}></div>
        <div class="field"><label for="duration">Length (minutes)</label>
          <input id="duration" name="duration" type="number" min="1" step="1" value="${esc(appt.duration ?? '')}" ${lock}></div>
        <div class="field"><label for="roomnumber">Room *</label>
          <select id="roomnumber" name="roomnumber" ${lock}>${options(staff.rooms, appt.roomnumber ?? null, 'Choose a room')}</select></div>
      </div>
      <div class="form-grid">
        <div class="field"><label for="counselorid">Counselor *</label>
          <select id="counselorid" name="counselorid" ${lock}>${options(staff.counselors, appt.counselorid ?? null, 'Choose a counselor')}</select></div>
        <div class="field"><label for="employeeid">Booked by (employee) *</label>
          <select id="employeeid" name="employeeid" ${lock}>${options(staff.employees, appt.employeeid ?? null, 'Choose an employee')}</select></div>
      </div>
      ${perms.seeNotes ? `<div class="field"><label for="notes">Session notes</label>
        <textarea id="notes" name="notes" maxlength="3000" ${perms.editNotes ? '' : 'readonly'}>${esc(appt.notes ?? '')}</textarea></div>` : ''}

      <h3>Clients in this appointment</h3>
      <div id="client-rows"></div>
      ${canSchedule ? `<div class="row" style="margin:.5rem 0 1rem">
        <div class="grow"><label for="add-client">Add a client</label>
          <select id="add-client">${options(clients, null, 'Choose a client')}</select></div>
        <button type="button" class="btn btn-quiet" id="add-client-btn">Add</button>
      </div>
      ${id ? '<p class="subtle">Clients already on an appointment cannot be removed, because no one can delete records.</p>' : ''}` : ''}

      <button class="btn" type="submit">${id ? 'Save changes' : 'Add appointment'}</button>
    </form>`}`;

  document.getElementById('pick').addEventListener('change', (e) => {
    messages.innerHTML = '';
    show(e.target.value ? Number(e.target.value) : null);
  });
  const form = document.getElementById('appt-form');
  if (!form) return;

  const keptValue = k => (k === true ? 'true' : k === false ? 'false' : '');
  function clientRowHtml(r, i, isNew) {
    return `<div class="card" style="padding:.75rem; margin-bottom:.5rem; background:var(--bg)" data-row="${i}" data-new="${isNew}">
      <div class="row" style="justify-content:space-between">
        <strong>${esc(clientName.get(r.clientid) || '#' + r.clientid)}</strong>
        ${isNew ? '<button type="button" class="btn btn-small btn-quiet" data-remove>Remove</button>' : ''}
      </div>
      <div class="form-grid" style="margin-top:.5rem">
        <div class="field"><label>Attendance</label>
          <select name="kept" ${perms.editKept ? '' : 'disabled'}>
            <option value=""${keptValue(r.kept) === '' ? ' selected' : ''}>Not recorded</option>
            <option value="true"${keptValue(r.kept) === 'true' ? ' selected' : ''}>Kept</option>
            <option value="false"${keptValue(r.kept) === 'false' ? ' selected' : ''}>Missed</option>
          </select></div>
      </div>
      ${perms.seeAssignment ? `<div class="field"><label>Assignment</label>
        <textarea name="assignment" maxlength="2000" ${perms.editAssignment ? '' : 'readonly'}>${esc(r.assignment ?? '')}</textarea></div>` : ''}
    </div>`;
  }
  function renderClientRows() {
    const box = document.getElementById('client-rows');
    box.innerHTML = rows.map((r, i) => clientRowHtml(r, i, false)).join('') +
      added.map((r, i) => clientRowHtml(r, i, true)).join('') ||
      '<p class="empty">No clients yet.</p>';
  }
  // Keep typed values when the list redraws.
  function readClientRows() {
    document.querySelectorAll('#client-rows [data-row]').forEach(el => {
      const list = el.dataset.new === 'true' ? added : rows;
      const r = list[Number(el.dataset.row)];
      const k = el.querySelector('[name=kept]').value;
      r._kept = k === '' ? null : k === 'true';
      const a = el.querySelector('[name=assignment]');
      if (a) r._assignment = a.value.trim() === '' ? null : a.value.trim();
    });
  }
  renderClientRows();

  document.getElementById('client-rows').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (!rm) return;
    readClientRows();
    added.splice(Number(rm.closest('[data-row]').dataset.row), 1);
    added.forEach(r => { r.kept = r._kept; r.assignment = r._assignment; });
    renderClientRows();
  });
  document.getElementById('add-client-btn')?.addEventListener('click', () => {
    const sel = document.getElementById('add-client');
    const cid = Number(sel.value);
    if (!cid) return;
    if ([...rows, ...added].some(r => r.clientid === cid)) return message('error', 'That client is already on this appointment.');
    readClientRows();
    added.forEach(r => { r.kept = r._kept; r.assignment = r._assignment; });
    added.push({ clientid: cid, kept: null, assignment: null });
    sel.value = '';
    messages.innerHTML = '';
    renderClientRows();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    readClientRows();
    const btn = form.querySelector('button[type=submit]');

    // Only send the columns this role may change.
    const apptRow = {};
    if (canSchedule) {
      const t = val(form, 'appointmenttime');
      Object.assign(apptRow, {
        appointmenttime: t ? (t.length === 16 ? t + ':00' : t) : null,
        duration: num(form, 'duration'),
        counselorid: num(form, 'counselorid'),
        employeeid: num(form, 'employeeid'),
        roomnumber: num(form, 'roomnumber'),
      });
      if (!apptRow.appointmenttime) return message('error', 'Choose a date and time.');
      if (!apptRow.roomnumber || !apptRow.counselorid || !apptRow.employeeid) return message('error', 'Choose a room, a counselor and the employee who booked it.');
      if (apptRow.duration !== null && !(apptRow.duration > 0)) return message('error', 'Length must be a positive number of minutes.');
      if (!id && !added.length) return message('error', 'Add at least one client to the appointment.');
    }
    if (perms.editNotes) apptRow.notes = val(form, 'notes');

    const sfFields = r => {
      const out = {};
      if (perms.editKept) out.kept = r._kept;
      if (perms.editAssignment) out.assignment = r._assignment;
      return out;
    };

    btn.disabled = true;
    try {
      let apptId = id;
      if (id) {
        if (Object.keys(apptRow).length) {
          check(await supabase.from('appointment').update(apptRow).eq('appointmentid', id), 'Saving appointment');
        }
        for (const r of rows) {
          const changes = sfFields(r);
          const changed = Object.keys(changes).some(k => (changes[k] ?? null) !== (r[k] ?? null));
          if (changed) {
            check(await supabase.from('scheduledfor').update(changes).eq('appointmentid', id).eq('clientid', r.clientid),
              `Saving ${clientName.get(r.clientid) || 'client'}`);
          }
        }
      } else {
        const created = check(await supabase.from('appointment').insert(apptRow).select('appointmentid').single(), 'Adding appointment');
        apptId = created.appointmentid;
      }
      if (added.length) {
        const r = await supabase.from('scheduledfor').insert(added.map(a => ({ appointmentid: apptId, clientid: a.clientid, ...sfFields(a) })));
        if (r.error) throw new Error(`${id ? 'Changes were saved' : `Appointment #${apptId} was added`}, but the clients could not be added: ${r.error.message}`);
      }
      sessionStorage.setItem('raft-saved', id ? 'Appointment saved.' : `Appointment #${apptId} added.`);
      location.href = `edit.html?type=appointment&id=${apptId}`;
    } catch (err) {
      message('error', err.message);
      btn.disabled = false;
    }
  });
}

// ---------- Start ----------

async function show(id) {
  try {
    if (current === 'client') await showClientForm(id);
    else await showAppointmentForm(id);
  } catch (err) {
    panel.innerHTML = '';
    message('error', err.message);
  }
}

try {
  const saved = sessionStorage.getItem('raft-saved');
  if (saved) { sessionStorage.removeItem('raft-saved'); message('success', saved); }
} catch { /* storage unavailable */ }

renderTabs();
show(params.get('id') ? Number(params.get('id')) : null);
