# DKRI map

A static HTML, JavaScript and CSS application for the Downtown Kingston Redevelopment Initiative, with Supabase for Postgres, Auth, Storage and validated public submissions. The public map is the entry page, reporting remains open to everyone, and report links and administration are protected separately.

## Routes

| Route | Purpose |
| --- | --- |
| `/` or `/map` | Public map, search, layers, status/category/date filters, location details and report history |
| `/report` | Public reporting form; accepts `?location_id=CODE` |
| `/portal` | Staff sign-in |
| `/portal/dashboard` | Reports, Locations, Activity, Accounts and Password |
| `/admin`, `/login` | Compatibility redirects |

Existing QR links to `/?location_id=CODE` still open a preselected reporting form. On mobile, use the arrow in the bottom map bar to open the controls. Reporting and the map remain public.

## Admin access

Open `/portal` and sign in as **jaydonhylton17@gmail.com** with your existing password. The initial password was saved in `ADMIN-CREDENTIALS.local.txt` in the original DTownAppv2 setup folder; it is excluded from Git and deployment. Change your password in the **Password** section after signing in.

Supabase Auth stores passwords and sessions; the protected `admin_members` table grants operational access. Only the primary `jaydonhylton17@gmail.com` account can open Accounts and Password, register accounts directly, or change access. Administrators can operate reports and locations but cannot manage accounts. No credentials are embedded in the site. Contact information and internal notes are only readable by administrators.

## Location publishing

Individual locations can be searched and edited directly in **Locations**. Names, descriptions, coordinates, altitude and public availability can change without replacing the inventory. A live map supports click-to-position and draggable-marker editing while the coordinate fields provide precise control. Location codes remain immutable so reports and QR links stay connected. Direct edits are recorded in **Activity**.

1. Open **Locations**, choose a KML file and select **Validate and preview**.
2. Review the count, additions, retained codes, archived locations and sample rows.
3. Select **Publish inventory** to change the public map.
4. **Version history** can restore a previous snapshot as a new publication.

Imports accept 1–10,000 unique point codes, with a 2 MB file limit. Missing locations become inactive; their reports remain intact. The migration captured the initial 16-point inventory as a restorable snapshot. Older original KML is retained, but versions without a point snapshot are not offered as restore targets.

## Supabase

Project: [DKRI](https://supabase.com/dashboard/project/wkwnuzmsohnanxntpvze).

| Data | Storage |
| --- | --- |
| Fixed points and active inventory | `public.locations` |
| Public reports, categories and status | `public.issue_reports` |
| Compact map summaries | `public.location_map`, an RLS-respecting view |
| Paged admin report queue | `public.admin_report_queue`, administrator-only view |
| Contact details and internal notes | `public.report_private`, administrator-only |
| Photo metadata and files | `public.issue_photos` and `report-photos` Storage |
| KML source, point snapshots and current version | `public.location_imports`, administrator-only |
| Review and publication audit | `public.admin_activity`, client read-only |
| Passwords and admin roles | Supabase Auth and `public.admin_members` |

All exposed application tables have RLS. Views use security-invoker semantics. Public browsers cannot write report tables, assign roles, read contacts, publish inventories or write arbitrary Storage objects.

The deployed `submit-report` Edge Function validates public submissions and up to five JPG/PNG/WEBP/GIF images, 10 MB each. A report must include a description, a photo, or both. It saves report metadata atomically, removes uploaded photos if the save fails, and returns a private tracking token. The `report-access` Edge Function uses that token for status viewing and public followups without exposing contact details.

The map downloads compact summaries and fetches history only when a location opens. Histories and admin reports are paged in groups of 20; activity loads 50 rows at a time. Admin queue search/filter/pagination runs in Postgres. Import history fetches metadata, not complete KML/snapshots.

Migrations are in `supabase/migrations/`. A private trigger records reviews, note changes and publications without copying private note contents into the audit log. Snapshot publishing and restoration serialize inventory changes and preserve report history.

## Develop

Requires Node.js 24.x and npm.

```sh
npm ci
npm start
```

Open http://127.0.0.1:8080. JavaScript edits rebuild automatically; restart after HTML/CSS changes. Leaflet is installed through npm and served with the site. Basemap imagery comes from OpenStreetMap and Esri with attribution.

```sh
npm run build
npm test
npm run test:live
```

The unit checks cover KML rejection, map filtering/import comparisons, route targets and private-file exclusion. Live checks verify public data, RLS, denied writes, and admin reads/sign-in when `DTOWN_TEST_ADMIN_EMAIL` and `DTOWN_TEST_ADMIN_PASSWORD` are supplied locally. They never belong in Vercel environment variables. `test/supabase-workflows.sql` tests publishing, restoring and auditing inside a rolled-back database transaction.

## Vercel

Use the **DKRI** repository root (`.`), framework **Other**, Node.js **24.x**, build command `npm run build`, output `dist`. The checked-in `vercel.json` sets `npm ci --include=dev`, routes and security headers. No application server or Next.js runtime is required.

The browser-safe Supabase URL and publishable key are in `static/js/backend.js`. Authorization lives in Supabase. Vercel needs no private database or service-role key. `.vercelignore` excludes local credentials, environment files, database backups and migration tools; the build copies only public assets and pages.

The existing Vercel project is `dkri`, at https://dkri.vercel.app. With a Vercel login:

```sh
npx vercel link --project dkri
npx vercel deploy --scope jaydonhylton17-8192s-projects
# After checking the preview:
npx vercel deploy --prod --scope jaydonhylton17-8192s-projects
```

The original SQLite/KML inputs are historical migration sources and are excluded from hosting. Do not re-run `scripts/export-legacy.js` against the live project: its export is for initial migration and includes private data.

The Supabase security advisor has no application table/function exposure findings. The existing project-level notice is [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Design conventions and current scope are recorded in `DESIGN.md` and `PRODUCT.md`.
