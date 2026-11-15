import {
  supabase, initPage, check, esc, fullName, formatDate, formatDateTime,
  peopleById, loadAppointments, showError,
} from './common.js';

const perms = await initPage('lookup.html');
const results = document.getElementById('results');
const detail = document.getElementById('detail');
const form = document.getElementById('search-form');
document.getElementById('new-client').hidden = !perms.editClients;

let currentId = null;

// ---------- Search ----------

async function search(text) {
  results.innerHTML = '<p class="subtle">Searching…</p>';
  try {
    let ids;
    // Characters that would break PostgREST's filter syntax are removed.
    const words = text.replace(/[,()"*%\\]/g, ' ').split(/\s+/).filter(Boolean);
    if (words.length) {
      // Every word must match the first name, last name, email or phone.
      let q = supabase.from('person').select('personid');
      for (const w of words) {
        q = q.or(`firstname.ilike.%${w}%,lastname.ilike.%${w}%,email.ilike.%${w}%,phone.ilike.%${w}%`);
      }
      const matches = check(await q.limit(500), 'Searching people');
      ids = matches.map(m => m.personid);
      if (!ids.length) return renderResults([]);
      const clients = check(await supabase.from('client').select('clientid').in('clientid', ids), 'Searching clients');
      ids = clients.map(c => c.clientid);
    } else {
      const clients = check(await supabase.from('client').select('clientid').limit(1000), 'Loading clients');
      ids = clients.map(c => c.clientid);
    }
    if (!ids.length) return renderResults([]);
    const people = check(await supabase.from('person')
      .select('personid, firstname, lastname, phone, email')
      .in('personid', ids)
      .order('lastname').order('firstname'), 'Loading client names');
    renderResults(people);
  } catch (err) {
    results.innerHTML = '';
    showError(results, err.message);
  }
}

function renderResults(people) {
  document.getElementById('results-title').textContent = `Clients (${people.length})`;
  if (!people.length) {
    results.innerHTML = '<p class="empty">No clients match.</p>';
    return;
  }
  results.innerHTML = `<ul class="result-list">${people.map(p => `
    <li><button type="button" data-id="${p.personid}"${p.personid === currentId ? ' aria-current="true"' : ''}>
      ${esc(fullName(p))}<br>
      <span class="subtle">${esc([p.phone, p.email].filter(Boolean).join(' · ') || 'No phone or email')}</span>
    </button></li>`).join('')}</ul>`;
}

results.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-id]');
  if (!btn) return;
  results.querySelectorAll('button[aria-current]').forEach(b => b.removeAttribute('aria-current'));
  btn.setAttribute('aria-current', 'true');
  showClient(Number(btn.dataset.id));
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  search(form.q.value.trim());
});

// ---------- Client details ----------

async function showClient(id) {
  currentId = id;
  history.replaceState(null, '', `lookup.html?id=${id}`);
  detail.innerHTML = '<div class="card"><p class="subtle">Loading…</p></div>';
  try {
    const [person, client] = await Promise.all([
      supabase.from('person')
        .select('personid, firstname, lastname, address, city, state, zip, phone, email')
        .eq('personid', id).maybeSingle().then(r => check(r, 'Loading contact information')),
      supabase.from('client')
        .select('clientid, foundout, remindermethod, referredby')
        .eq('clientid', id).maybeSingle().then(r => check(r, 'Loading client')),
    ]);
    if (!person || !client) {
      detail.innerHTML = '<div class="card"><p class="empty">That client was not found.</p></div>';
      return;
    }
    const [referrals, appointments, families] = await Promise.all([
      loadReferrals(client),
      loadClientAppointments(id),
      loadFamilies(id),
    ]);
    renderClient(person, client, referrals, appointments, families);
  } catch (err) {
    detail.innerHTML = '';
    showError(detail, err.message);
  }
}

async function loadReferrals(client) {
  const referred = check(await supabase.from('client').select('clientid').eq('referredby', client.clientid), 'Loading referrals');
  const names = await peopleById([client.referredby, ...referred.map(r => r.clientid)]);
  return {
    referredBy: client.referredby ? { id: client.referredby, name: fullName(names.get(client.referredby)) } : null,
    referred: referred.map(r => ({ id: r.clientid, name: fullName(names.get(r.clientid)) })),
  };
}

async function loadClientAppointments(id) {
  const sfCols = ['appointmentid', 'clientid', 'kept'];
  if (perms.seeAssignment) sfCols.push('assignment');
  const mine = check(await supabase.from('scheduledfor').select(sfCols.join(', ')).eq('clientid', id), 'Loading scheduled appointments');
  if (!mine.length) return [];
  const apptIds = mine.map(s => s.appointmentid);
  const appts = await loadAppointments(perms, q => q.in('appointmentid', apptIds).order('appointmenttime', { ascending: false }));

  // Other clients in the same appointments (for family or couples sessions).
  const everyone = check(await supabase.from('scheduledfor').select('appointmentid, clientid').in('appointmentid', apptIds), 'Loading other clients');
  const names = await peopleById(everyone.map(s => s.clientid));
  const byAppt = new Map(mine.map(s => [s.appointmentid, s]));
  for (const a of appts) {
    a.mine = byAppt.get(a.appointmentid);
    a.others = everyone.filter(s => s.appointmentid === a.appointmentid && s.clientid !== id)
      .map(s => ({ id: s.clientid, name: fullName(names.get(s.clientid)) }));
  }
  return appts;
}

async function loadFamilies(id) {
  const memberships = check(await supabase.from('member_in_family')
    .select('familyid, memberid, datejoined').eq('memberid', id), 'Loading family memberships');
  if (!memberships.length) return [];
  const familyIds = memberships.map(m => m.familyid);
  const [families, allMembers, memberRoles, roles] = await Promise.all([
    supabase.from('family').select('familyid, familyname, datefounded').in('familyid', familyIds).then(r => check(r, 'Loading families')),
    supabase.from('member_in_family').select('familyid, memberid, datejoined').in('familyid', familyIds).then(r => check(r, 'Loading family members')),
    supabase.from('member_role').select('familyid, memberid, roleid').in('familyid', familyIds).then(r => check(r, 'Loading family roles')),
    supabase.from('role').select('roleid, rolename').then(r => check(r, 'Loading role names')),
  ]);
  const roleName = new Map(roles.map(r => [r.roleid, r.rolename]));
  const names = await peopleById(allMembers.map(m => m.memberid));
  const rolesOf = (fid, mid) => memberRoles.filter(r => r.familyid === fid && r.memberid === mid).map(r => roleName.get(r.roleid) || `Role ${r.roleid}`);

  return families.map(f => ({
    ...f,
    joined: memberships.find(m => m.familyid === f.familyid)?.datejoined,
    myRoles: rolesOf(f.familyid, id),
    members: allMembers.filter(m => m.familyid === f.familyid && m.memberid !== id).map(m => ({
      id: m.memberid, name: fullName(names.get(m.memberid)), roles: rolesOf(f.familyid, m.memberid), joined: m.datejoined,
    })),
  })).sort((a, b) => (a.familyname || '').localeCompare(b.familyname || ''));
}

function keptLabel(kept) {
  if (kept === true) return '<span class="kept-yes">Kept</span>';
  if (kept === false) return '<span class="kept-no">Missed</span>';
  return '<span class="subtle">Not recorded</span>';
}

function renderClient(p, c, refs, appts, families) {
  const addr = [p.address, [p.city, p.state].filter(Boolean).join(', '), p.zip].filter(Boolean).join(' ');
  const clientLink = r => `<a href="lookup.html?id=${r.id}">${esc(r.name || '#' + r.id)}</a>`;

  detail.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content: space-between; align-items: start;">
        <div>
          <h2 style="margin-bottom:.1rem">${esc(fullName(p))}</h2>
          <p class="subtle" style="margin-top:0">Client #${p.personid}</p>
        </div>
        ${perms.editClients ? `<a class="btn btn-small" href="edit.html?type=client&id=${p.personid}">Edit client</a>` : ''}
      </div>
      <h3>Contact information</h3>
      <dl class="details">
        <dt>Phone</dt><dd>${esc(p.phone) || '<span class="empty">none</span>'}</dd>
        <dt>Email</dt><dd>${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '<span class="empty">none</span>'}</dd>
        <dt>Address</dt><dd>${esc(addr) || '<span class="empty">none</span>'}</dd>
        <dt>Reminder method</dt><dd>${esc(c.remindermethod) || '<span class="empty">not set</span>'}</dd>
        <dt>Found out about RAFT</dt><dd>${esc(c.foundout) || '<span class="empty">not recorded</span>'}</dd>
        <dt>Referred by</dt><dd>${refs.referredBy ? clientLink(refs.referredBy) : '<span class="empty">no one</span>'}</dd>
        ${refs.referred.length ? `<dt>Has referred</dt><dd>${refs.referred.map(clientLink).join(', ')}</dd>` : ''}
      </dl>
    </div>

    <div class="card">
      <div class="row" style="justify-content: space-between;">
        <h2>Appointments (${appts.length})</h2>
        ${perms.editAppointments ? `<a class="btn btn-small btn-quiet" href="edit.html?type=appointment&client=${p.personid}">New appointment for this client</a>` : ''}
      </div>
      ${appts.length ? `<div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Counselor</th><th>Room</th><th>Attendance</th>${perms.seeAssignment ? '<th>Assignment</th>' : ''}${perms.seeNotes ? '<th>Notes</th>' : ''}<th></th></tr></thead>
        <tbody>${appts.map(a => `<tr>
          <td>${esc(formatDateTime(a.appointmenttime))}${a.duration ? `<br><span class="subtle">${esc(a.duration)} min</span>` : ''}
            ${a.others.length ? `<br><span class="subtle">With ${a.others.map(clientLink).join(', ')}</span>` : ''}</td>
          <td>${esc(a.counselorName)}</td>
          <td>${esc(a.roomLabel)}</td>
          <td>${keptLabel(a.mine?.kept)}</td>
          ${perms.seeAssignment ? `<td>${esc(a.mine?.assignment) || '<span class="empty">none</span>'}</td>` : ''}
          ${perms.seeNotes ? `<td>${esc(a.notes) || '<span class="empty">none</span>'}</td>` : ''}
          <td><a href="edit.html?type=appointment&id=${a.appointmentid}">Edit</a></td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="empty">No appointments.</p>'}
    </div>

    <div class="card">
      <h2>Families (${families.length})</h2>
      ${families.length ? families.map(f => `
        <h3>${esc(f.familyname || 'Family #' + f.familyid)} <span class="subtle" style="font-weight:400">· founded ${esc(formatDate(f.datefounded)) || 'unknown'}</span></h3>
        <p style="margin:.25rem 0">Role${f.myRoles.length === 1 ? '' : 's'} in this family:
          ${f.myRoles.length ? f.myRoles.map(r => `<span class="tag">${esc(r)}</span>`).join('') : '<span class="empty">none recorded</span>'}
          ${f.joined ? `<span class="subtle">· joined ${esc(formatDate(f.joined))}</span>` : ''}</p>
        ${f.members.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Other members</th><th>Roles</th><th>Joined</th></tr></thead>
          <tbody>${f.members.map(m => `<tr>
            <td>${esc(m.name || '#' + m.id)}</td>
            <td>${m.roles.map(r => `<span class="tag">${esc(r)}</span>`).join('') || '<span class="empty">none</span>'}</td>
            <td>${esc(formatDate(m.joined))}</td></tr>`).join('')}</tbody></table></div>` : ''}
      `).join('') : '<p class="empty">Not a member of any family.</p>'}
    </div>`;
}

// ---------- Start ----------

const startId = Number(new URLSearchParams(location.search).get('id'));
await search('');
if (startId) {
  results.querySelector(`button[data-id="${startId}"]`)?.setAttribute('aria-current', 'true');
  showClient(startId);
}
