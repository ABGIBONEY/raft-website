# RAFT Front Desk

A small website for the front desk of Richmond Area Family Therapy (RAFT). Staff sign in with Supabase Auth and can look up clients, see statistics, and add or edit clients and appointments in the `raft` schema of my Supabase database.

**Live site:** https://raft-website-two.vercel.app

## AI tool I used

Claude Code, in the Claude desktop app. It wrote the files, ran the site on my computer, checked the screens in its built-in browser, and made the Git commits and pushes.

## My first prompt

I used the brief from the assignment unchanged, with my Supabase project URL and publishable key filled in and the `create table` statements from the RAFT 3 Implementation Solution pasted in.

## What the AI got wrong or left out, and how it was fixed

- **I hadn't pasted my tables at first.** Claude Code tried to read the table list from Supabase, but the publishable key isn't allowed to list tables, so it asked me for the `create table` statements instead of guessing.
- **Counselors saw an "Add a new client" button.** The code hid it, but a style rule for buttons overrode "hidden", so it still showed. We found it while clicking through the site signed in as a Counselor, and fixed it by making hidden elements always stay hidden (`css/style.css`).
- **A bug in the wage statistic.** The first version of the Admin-only average wage calculation had a broken filter. Claude Code caught and fixed it before the site was first run.
- **Two guesses to check against the database grants:** the site lets a Scheduler mark whether a client kept an appointment, and it labels `appointment.employeeid` as "Booked by". If a Scheduler gets a "permission denied" error, that setting is in `permissionsFor` in `js/common.js`.

## The change I made in Step 7, and why

I added **busiest day of the week** and **busiest start time** to the Dashboard, with a bar chart for each. A front desk can use this to plan staffing and room bookings. It is calculated from `appointment.appointmenttime`; with the sample data, every appointment is on a Tuesday and most start at 10:00 AM.

## How the site works

| File | Screen |
|---|---|
| `index.html` | Sign-in (email and password) |
| `home.html` | Home: links to the other screens, upcoming and most recent appointments |
| `lookup.html` | Client lookup: contact info, appointments, families and roles |
| `dashboard.html` | Dashboard: statistics calculated from the tables |
| `edit.html` | Add or edit a client or an appointment |

The role comes from the `role` claim in the access token:

- **Admin** (`raft_admin`): sees and changes everything, including `employee.wage`.
- **Scheduler** (`raft_scheduler`): adds and changes clients and appointments; never asks for `employee.wage`, `appointment.notes` or `scheduledfor.assignment`.
- **Counselor** (`raft_counselor`): sees everything except wages; can only update `appointment.notes`, `scheduledfor.assignment` and `scheduledfor.kept`.

Nothing on the site deletes records. Shared code is in `js/common.js`; the Supabase URL and publishable key are in `js/config.js`.

To run it on your own computer, start a small web server in this folder and open http://localhost:8080:

```bash
python -m http.server 8080
```
