import { initPage, loadAppointments, formatDateTime, esc, nowTimestamp, showError } from './common.js';

const perms = await initPage('home.html');

const intro = {
  raft_admin: 'You are signed in as Admin: you can see and change everything, including employee wages.',
  raft_scheduler: 'You are signed in as Scheduler: you can add and change clients and appointments.',
  raft_counselor: 'You are signed in as Counselor: you can read everything except wages, and update appointment notes, assignments and whether a client kept an appointment.',
};
document.getElementById('intro').textContent = intro[perms.role];
document.getElementById('edit-card-text').textContent = perms.editClients
  ? 'Add a new client or appointment, or change an existing one.'
  : 'Update appointment notes, client assignments and whether each client kept the appointment.';

function table(appts) {
  if (!appts.length) return '<p class="empty">None found.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>When</th><th>Counselor</th><th>Room</th><th></th></tr></thead>
    <tbody>${appts.map(a => `<tr>
      <td>${esc(formatDateTime(a.appointmenttime))}${a.duration ? `<br><span class="subtle">${esc(a.duration)} min</span>` : ''}</td>
      <td>${esc(a.counselorName)}</td>
      <td>${esc(a.roomLabel)}</td>
      <td><a href="edit.html?type=appointment&id=${a.appointmentid}">Open</a></td>
    </tr>`).join('')}</tbody></table></div>`;
}

const now = nowTimestamp();
try {
  const [upcoming, recent] = await Promise.all([
    loadAppointments(perms, q => q.gte('appointmenttime', now).order('appointmenttime', { ascending: true }).limit(5)),
    loadAppointments(perms, q => q.lt('appointmenttime', now).order('appointmenttime', { ascending: false }).limit(5)),
  ]);
  document.getElementById('upcoming').innerHTML = table(upcoming);
  document.getElementById('recent').innerHTML = table(recent);
} catch (err) {
  document.getElementById('upcoming').innerHTML = '';
  document.getElementById('recent').innerHTML = '';
  showError(document.querySelector('main'), err.message);
}
