import { supabase, initPage, check, esc, fullName, peopleById, formatDate, nowTimestamp, showError } from './common.js';

const perms = await initPage('dashboard.html');
const root = document.getElementById('dashboard');

const count = async (table, column) =>
  check(await supabase.from(table).select(column, { count: 'exact', head: true }), `Counting ${table}`);

const fmt = n => Number(n).toLocaleString();
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
const money = n => Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD' });

function stat(num, label) {
  return `<div class="card stat"><div class="num">${esc(num)}</div><div class="label">${esc(label)}</div></div>`;
}

// A small table with a bar for each row: [[label, value], ...]
function barTable(title, rows, valueLabel = 'Appointments') {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return `<section class="card"><h2>${esc(title)}</h2>
    ${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th></th><th>${esc(valueLabel)}</th><th class="bar-cell"></th></tr></thead>
      <tbody>${rows.map(([label, value]) => `<tr>
        <td>${esc(label)}</td><td>${fmt(value)}</td>
        <td class="bar-cell"><div class="bar" style="width:${(value / max) * 100}%"></div></td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="empty">No data.</p>'}</section>`;
}

function tally(items, keyFn) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

try {
  const [nClients, nCounselors, nEmployees, nRooms, nFamilies, nAppts,
    appts, scheduled, clients, rooms] = await Promise.all([
    count('client', 'clientid'),
    count('counselor', 'counselorid'),
    count('employee', 'employeeid'),
    count('room', 'roomnumber'),
    count('family', 'familyid'),
    count('appointment', 'appointmentid'),
    supabase.from('appointment').select('appointmentid, appointmenttime, duration, counselorid, roomnumber').limit(10000).then(r => check(r, 'Loading appointments')),
    supabase.from('scheduledfor').select('appointmentid, clientid, kept').limit(10000).then(r => check(r, 'Loading attendance')),
    supabase.from('client').select('clientid, foundout, remindermethod, referredby').limit(10000).then(r => check(r, 'Loading clients')),
    supabase.from('room').select('roomnumber, roomname').then(r => check(r, 'Loading rooms')),
  ]);

  // Appointment dates
  const times = appts.map(a => a.appointmenttime).filter(Boolean).sort();
  const first = times[0]?.slice(0, 10);
  const last = times[times.length - 1]?.slice(0, 10);
  const now = nowTimestamp();
  const upcoming = times.filter(t => t.replace(' ', 'T') >= now).length;
  const totalMinutes = appts.reduce((s, a) => s + (a.duration || 0), 0);

  // Attendance
  const kept = scheduled.filter(s => s.kept === true).length;
  const missed = scheduled.filter(s => s.kept === false).length;
  const unknown = scheduled.length - kept - missed;

  // Per counselor
  const byCounselor = tally(appts, a => a.counselorid);
  const counselorNames = await peopleById([...byCounselor.keys()]);
  const counselorRows = [...byCounselor].map(([id, n]) => [fullName(counselorNames.get(id)) || `#${id}`, n]).sort((a, b) => b[1] - a[1]);

  // Per room
  const roomName = new Map(rooms.map(r => [r.roomnumber, r.roomname]));
  const roomRows = [...tally(appts, a => a.roomnumber)]
    .map(([num, n]) => [`${num}${roomName.get(num) ? ' – ' + roomName.get(num) : ''}`, n]).sort((a, b) => b[1] - a[1]);

  // Per month
  const monthRows = [...tally(appts.filter(a => a.appointmenttime), a => a.appointmenttime.slice(0, 7))]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ym, n]) => [new Date(ym + '-01T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long' }), n]);

  // Clients
  const foundRows = [...tally(clients, c => c.foundout || 'Not recorded')].sort((a, b) => b[1] - a[1]);
  const reminderRows = [...tally(clients, c => c.remindermethod || 'Not set')].sort((a, b) => b[1] - a[1]);
  const referred = clients.filter(c => c.referredby != null).length;
  const clientsPerAppt = appts.length ? (scheduled.length / appts.length).toFixed(1) : '–';

  let html = `
    <div class="grid">
      ${stat(fmt(nClients), 'Clients')}
      ${stat(fmt(nAppts), 'Appointments')}
      ${stat(fmt(nCounselors), 'Counselors')}
      ${stat(fmt(nEmployees), 'Employees')}
      ${stat(fmt(nFamilies), 'Families')}
      ${stat(fmt(nRooms), 'Rooms')}
    </div>
    <div class="grid">
      ${stat(pct(kept, kept + missed), `Appointments kept (${fmt(kept)} kept, ${fmt(missed)} missed${unknown ? `, ${fmt(unknown)} not recorded` : ''})`)}
      ${stat(fmt(Math.round(totalMinutes / 60)), 'Hours of counseling booked')}
      ${stat(clientsPerAppt, 'Clients per appointment, on average')}
      ${stat(fmt(upcoming), 'Upcoming appointments')}
      ${stat(pct(referred, clients.length), `Clients referred by another client (${fmt(referred)})`)}
    </div>
    <p class="subtle">Appointments on record run from ${esc(formatDate(first) || '–')} to ${esc(formatDate(last) || '–')}.</p>`;

  if (perms.seeWage) {
    const emps = check(await supabase.from('employee').select('employeeid, wage'), 'Loading wages');
    const wages = emps.filter(e => e.wage != null).map(e => Number(e.wage));
    const avg = wages.length ? wages.reduce((s, w) => s + w, 0) / wages.length : null;
    html += `<section class="card"><h2>Wages <span class="tag">Admin only</span></h2>
      <div class="grid">
        ${stat(avg == null ? '–' : money(avg), 'Average hourly wage')}
        ${stat(wages.length ? money(Math.min(...wages)) : '–', 'Lowest wage')}
        ${stat(wages.length ? money(Math.max(...wages)) : '–', 'Highest wage')}
      </div></section>`;
  }

  html += `<div class="grid-2">
      ${barTable('Appointments by counselor', counselorRows)}
      ${barTable('Appointments by room', roomRows)}
      ${barTable('How clients found out about RAFT', foundRows, 'Clients')}
      ${barTable('Reminder method', reminderRows, 'Clients')}
    </div>
    ${barTable('Appointments by month', monthRows)}`;

  root.innerHTML = html;
} catch (err) {
  root.innerHTML = '';
  showError(root, err.message);
}
