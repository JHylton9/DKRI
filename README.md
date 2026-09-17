# DTownApp — static site + Supabase

The original Downtown Kingston HTML/CSS interface now uses Supabase directly. Vercel serves only static files: there is no Express server, Vercel API function, Turso database, or Vercel Blob dependency.

## Deploy

Import this repository into Vercel using the repository root, framework preset **Other**, build command `npm run build`, and output directory `dist`. The checked-in `vercel.json` provides the routes. No private deployment keys or server environment variables are required for this configured project.

The public Supabase URL and publishable key are configured in `data/dtown-issue-map/public/static/js/backend.js`. These are intended for browser use. Authorization is enforced in Supabase, not by hiding the key or the admin page.

## Admin access

Open `/portal` and sign in as **jaydonhylton17@gmail.com**. The generated initial password is in `ADMIN-CREDENTIALS.local.txt` on this computer. That file is ignored by Git and deployment. Change it using **Account password** in the dashboard after signing in.

Passwords and sessions are managed by Supabase Auth. `admin_members` controls who can review reports, see contact information, change status, and import KML. Public users cannot assign themselves this role. There is no password table in the site's JavaScript.

## Supabase project

Project: `wkwnuzmsohnanxntpvze` — [Dashboard](https://supabase.com/dashboard/project/wkwnuzmsohnanxntpvze).

| Data | Location |
| --- | --- |
| Fixed map points | `public.locations` |
| Public reports, categories and status | `public.issue_reports` |
| Contact details and internal notes | `public.report_private`, admin-only |
| Photo metadata | `public.issue_photos` |
| Photos | `report-photos` Storage bucket |
| KML import history | `public.location_imports`, admin-only |
| Admin credentials | Supabase Auth |
| Admin role | `public.admin_members` |

The existing 16 locations and 16 reports were migrated. The local SQLite file remains untouched as a historical backup and is not deployed.

The deployed `submit-report` Edge Function validates public forms and up to five photos (10 MB each), uploads photos, and atomically saves report metadata. A failed save cleans up the photos. It intentionally accepts public submissions with this project's publishable key; that key never grants administrative access. All application tables have row-level security. Public clients cannot write report tables or upload arbitrary Storage objects directly. Public photo URLs remain visible as evidence on the map.

`review_report` updates status and private notes together. `replace_locations` atomically imports KML and retains old report history by marking missing locations inactive. The browser refreshes admin sessions automatically. `@supabase/ssr` is installed as requested but not needed: this static HTML site does not use Next.js, server cookies, or middleware.

## Develop and verify

```sh
npm ci
npm start
```

Open http://127.0.0.1:8080. This is a static-file preview only; data requests go to Supabase. JavaScript edits rebuild automatically; rerun `npm start` for HTML/CSS changes.

```sh
npm run build
npm test
npm run test:live
```

`npm test` checks KML validation and static deployment contents. `test:live` performs read-only access checks and admin sign-in using the local credentials file. After changing your password, update that local file before running the sign-in check again. Live report/photo submission and admin review were also tested during setup, and that temporary report/photo were removed.

SQL schema and policies are versioned in `supabase/migrations/`. Edge Function source is in `supabase/functions/submit-report/`. The one-time admin setup endpoint has been disabled. `scripts/export-legacy.js` can generate SQL from the untouched local SQLite backup; its output includes private data and must not be committed or published.

Supabase's database security advisor reports no application table/function exposure issues. Its remaining Auth notice is [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), a project Auth setting. Public submissions are anonymous; add CAPTCHA/rate limits in the Edge Function if public traffic warrants them. Current list screens fetch paginated database results and assemble history in the browser; introduce per-location history loading if the dataset becomes large.
