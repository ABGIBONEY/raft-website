# RAFT Front Desk

A static website for the front desk of Richmond Area Family Therapy. It reads and writes the `raft` schema in Supabase with supabase-js, signed in through Supabase Auth.

## Screens

| File | Screen |
|---|---|
| `index.html` | Sign-in (email and password) |
| `home.html` | Home: links to the other screens, upcoming and most recent appointments |
| `lookup.html` | Client lookup: contact info, appointments, families and roles |
| `dashboard.html` | Dashboard: statistics calculated from the tables |
| `edit.html` | Add or edit a client or an appointment |

Shared code is in `js/common.js`; the Supabase URL and publishable key are in `js/config.js`.

## Roles

The role comes from the `role` claim in the access token:

- **Admin** (`raft_admin`): sees and changes everything, including `employee.wage` (shown on the dashboard).
- **Scheduler** (`raft_scheduler`): adds and changes clients and appointments; never asks for `employee.wage`, `appointment.notes` or `scheduledfor.assignment`.
- **Counselor** (`raft_counselor`): sees everything except wages; can only update `appointment.notes`, `scheduledfor.assignment` and `scheduledfor.kept`.

Nothing on the site deletes records.

## Run it on your computer

The pages use JavaScript modules, so open them through a small web server rather than double-clicking the file:

```bash
python -m http.server 8080
```

Then go to http://localhost:8080.

## Host it

Upload the whole folder to any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages). There is no build step.
