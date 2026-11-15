// Shared code for every page: the Supabase client, sign-in checks, roles, the header and small helpers.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  db: { schema: 'raft' },
  auth: { persistSession: true, autoRefreshToken: true },
});

// ---------- Roles ----------

export const ROLE_LABELS = {
  raft_admin: 'Admin',
  raft_scheduler: 'Scheduler',
  raft_counselor: 'Counselor',
};

// What each role may see and do. The database enforces the same rules;
// this only decides which columns we ask for and which controls we show.
export function permissionsFor(role) {
  const admin = role === 'raft_admin';
  const scheduler = role === 'raft_scheduler';
  const counselor = role === 'raft_counselor';
  return {
    role,
    label: ROLE_LABELS[role] || role,
    seeWage: admin,
    seeNotes: admin || counselor,
    seeAssignment: admin || counselor,
    editClients: admin || scheduler,          // add/change person + client rows
    editAppointments: admin || scheduler,     // add/change appointment time, room, people; add clients to it
    editNotes: admin || counselor,            // appointment.notes
    editAssignment: admin || counselor,       // scheduledfor.assignment
    editKept: admin || scheduler || counselor, // scheduledfor.kept
  };
}

// Read the role claim from the session's access token (a JWT).
export function roleFromSession(session) {
  try {
    const payload = session.access_token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json).role || null;
  } catch {
    return null;
  }
}

// ---------- Page setup ----------

const NAV = [
  { href: 'home.html', label: 'Home' },
  { href: 'lookup.html', label: 'Client lookup' },
  { href: 'dashboard.html', label: 'Dashboard' },
  { href: 'edit.html', label: 'Add or edit' },
];

// Call at the top of every signed-in page. Sends the user to the sign-in screen
// if there is no session, draws the header, and returns the role's permissions.
export async function initPage(current) {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    window.location.replace('index.html');
    return new Promise(() => {}); // stop the page from loading data
  }
  const role = roleFromSession(session);
  const perms = permissionsFor(role);

  const header = document.getElementById('site-header');
  header.innerHTML = `
    <div class="header-inner">
      <a class="brand" href="home.html">RAFT <span>Front Desk</span></a>
      <nav aria-label="Main">
        ${NAV.map(n => `<a href="${n.href}"${n.href === current ? ' aria-current="page"' : ''}>${n.label}</a>`).join('')}
      </nav>
      <div class="who">
        <span class="role-badge role-${esc(role || 'none')}" title="${esc(session.user.email || '')}">Signed in as ${esc(perms.label || 'unknown role')}</span>
        <button type="button" class="btn btn-quiet" id="sign-out">Sign out</button>
      </div>
    </div>`;
  document.getElementById('sign-out').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.replace('index.html');
  });

  if (!ROLE_LABELS[role]) {
    showError(document.querySelector('main'),
      `Your account has no RAFT role (the token's role claim is "${role}"). Ask an admin to give you raft_admin, raft_scheduler or raft_counselor.`);
    return new Promise(() => {});
  }

  // If the session ends in another tab, go back to sign-in.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') window.location.replace('index.html');
  });

  return perms;
}

// ---------- Helpers ----------

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fullName(p) {
  if (!p) return '';
  return [p.firstname, p.lastname].filter(Boolean).join(' ') || `Person ${p.personid}`;
}

// Throw a readable error if a Supabase call failed.
export function check({ data, error, count }, what) {
  if (error) {
    const msg = error.message || String(error);
    throw new Error(what ? `${what}: ${msg}` : msg);
  }
  return count !== undefined && data === null ? count : data;
}

export function showError(container, message) {
  const div = document.createElement('div');
  div.className = 'alert alert-error';
  div.setAttribute('role', 'alert');
  div.textContent = message;
  container.prepend(div);
  return div;
}

// 'timestamp' columns have no time zone, so format the string as written.
export function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts.replace(' ', 'T'));
  if (isNaN(d)) return ts;
  return d.toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatDate(date) {
  if (!date) return '';
  const d = new Date(date + 'T00:00:00');
  return isNaN(d) ? date : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// "Now" as a timestamp string in local time, to compare with timestamp columns.
export function nowTimestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

// Fetch person rows for a list of ids and return a Map of id -> person.
export async function peopleById(ids) {
  const unique = [...new Set(ids.filter(id => id != null))];
  if (!unique.length) return new Map();
  const rows = check(await supabase.from('person')
    .select('personid, firstname, lastname')
    .in('personid', unique), 'Loading names');
  return new Map(rows.map(r => [r.personid, r]));
}

// Fetch appointments with counselor, scheduler and room names filled in.
export async function loadAppointments(perms, build) {
  const cols = ['appointmentid', 'appointmenttime', 'duration', 'counselorid', 'employeeid', 'roomnumber'];
  if (perms.seeNotes) cols.push('notes');
  const appts = check(await build(supabase.from('appointment').select(cols.join(', '))), 'Loading appointments');
  const names = await peopleById(appts.flatMap(a => [a.counselorid, a.employeeid]));
  const rooms = check(await supabase.from('room').select('roomnumber, roomname'), 'Loading rooms');
  const roomMap = new Map(rooms.map(r => [r.roomnumber, r]));
  for (const a of appts) {
    a.counselorName = fullName(names.get(a.counselorid)) || `#${a.counselorid}`;
    a.employeeName = fullName(names.get(a.employeeid)) || `#${a.employeeid}`;
    const room = roomMap.get(a.roomnumber);
    a.roomLabel = room ? `${room.roomnumber}${room.roomname ? ' – ' + room.roomname : ''}` : String(a.roomnumber);
  }
  return appts;
}
