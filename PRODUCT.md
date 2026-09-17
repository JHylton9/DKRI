# Product

## Register

product

## Product Summary
This is a location-based civic issue reporting product for Downtown Kingston. The product is not a free-pin complaint map. It is a fixed-location reporting system where every public submission must attach to a predefined map point imported from KML, and where each location can accumulate report history, photos, and status changes over time.

## Users
Primary public users are residents in Downtown Kingston and selected field staff who need to submit issue reports quickly from mobile or desktop. They need a simple reporting flow tied to predefined physical locations, with reliable photo capture and a clear sense that their report has been logged against the right place.

Primary admin users are authorized operations staff responsible for reviewing reports, managing photos, updating statuses, maintaining the fixed location set, and keeping the public map current. Secondary viewers include stakeholders and funders who may inspect the public-facing map as evidence of issue visibility and response progress.

## Product Purpose
This product provides a public-facing issue reporting and tracking surface for Downtown Kingston. It collects reports at predefined locations, allows multiple issues to be attached to one location, and gives the public a readable map of what has been identified and what has been fixed.

Success means the public form is simple enough to complete quickly in the field, photos and issue details arrive intact for review, admins can update and maintain entries without friction, and the public map reflects current location-based issue status in a credible and understandable way.

## Core Surfaces
1. Public report form: lets a user choose one active fixed location, submit one report, select one or more issue types, optionally add a description, optionally provide contact details, and optionally upload photos.
2. Public map: shows active locations only, derived location status, aggregate counts, and a public-facing slice of report history without exposing private contact details or admin notes.
3. Admin login: protects operational tooling behind a session-based sign-in flow.
4. Admin dashboard: lets authorized staff inspect reports, view attached photos, update report status, add internal notes, and replace the KML location source.

## Functional Model
1. A location is the anchor record. Locations come from the KML source, not from public free-text submission.
2. One location can have many issue reports over time.
3. One issue report can have many issue types.
4. One issue report can have many uploaded photos.
5. Status is stored at the report level, then summarized into a derived status for each location.
6. The public map is a readable accountability surface, not a full internal case-management tool.

## Current Functional Scope
### Public reporting
- Users must choose from active predefined locations only.
- Users must select at least one valid issue type from the approved issue list.
- Users may add an optional description.
- Users may choose `none`, `email`, or `phone` as the contact method.
- If `email` is chosen, the value must parse as an email address.
- If `phone` is chosen, the value must contain at least seven digits.
- Users may upload up to 5 photos per report.
- Accepted image formats are JPG, JPEG, PNG, WEBP, and GIF.
- Each uploaded photo must be 10 MB or smaller.
- A successful submission creates a new report with initial status `pending`.

### Public map behavior
- Only active locations are shown publicly.
- Public users can filter visible locations by `all`, `pending`, `down`, or `fixed`.
- Each location shows aggregate counts such as total reports, open reports, and photo count.
- Each location popup or list view links back into the public reporting form with the location preselected.
- Public history includes report description, issue types, status, submitted timestamp, and public photo URLs.
- Private fields such as reporter contact details and admin notes must never appear in the public payload.

### Admin behavior
- Admin access requires a valid authenticated session.
- Admins can view all locations, including inactive ones left behind after a KML refresh.
- Admins can search and filter the report queue.
- Admins can review per-report details including contact info, photos, status, and admin notes.
- Admins can change a report status only to `pending`, `down`, or `fixed`.
- Admins can upload a replacement KML file to re-sync the fixed location list.
- KML replacement must preserve report history while marking missing former locations inactive instead of deleting them.

## Derived Status Rules
1. If any report at a location is `down`, the location is `down`.
2. Otherwise, if any report at that location is `pending`, the location is `pending`.
3. Otherwise, if the location has reports and all of them are `fixed`, the location is `fixed`.
4. If a location has no reports, its public derived status still defaults to `pending` so it remains visible as an unreported but valid mapped point.

## Issue Taxonomy
The current approved public issue types are:

1. Garbage buildup
2. Illegal dumping
3. Damaged / missing bin
4. Blocked drain
5. Lighting issue
6. Signage issue
7. Vagrancy / loitering

This list is product-configured, not user-generated. If issue categories change later, the public form, validation rules, and reporting summaries all need to stay aligned.

## Data and Visibility Model
### Publicly visible
- location ID and name
- location coordinates and description
- derived location status
- issue-type summaries
- report count, open report count, and photo count
- report timestamps, descriptions, issue types, and public photo URLs

### Admin-only
- reporter contact method and value
- admin notes
- inactive locations after KML refresh

### Internal implementation facts that matter to the product
- `issues.kml` is the master location source.
- `statuses.json` is a legacy migration input, not the long-term operational store.
- Supabase Postgres provides durable storage for the static site.
- Uploaded photos are validated by a Supabase Edge Function and stored in Supabase Storage.
- Replacing the KML should update the active location set without erasing report history.

## Core Workflows
1. Public user opens the form, selects a mapped location, adds issue details, optionally attaches contact details and photos, and submits a report.
2. Public or stakeholder user opens the map, filters locations by status, and inspects current public issue state by fixed location.
3. Admin signs in, reviews incoming reports, updates report status, adds internal notes, and confirms the public map reflects current operational reality.
4. Admin uploads an updated KML when the fixed location inventory changes, and the system re-syncs location records while preserving historical reports.

## Business Rules and Constraints
1. Public users cannot create new locations from the browser.
2. Public users cannot directly set or edit status.
3. Location updates are driven by KML import, not manual freeform edits in the current admin UI.
4. The app favors continuity of location history over destructive cleanup.
5. The public experience should optimize for quick field reporting, especially on mobile.
6. The admin experience should optimize for operational review, not heavy record editing.

## Current Non-goals
1. Public user accounts or reporter sign-in
2. Direct public commenting or threaded discussion
3. Arbitrary point creation on the map
4. Full case-management workflow with assignments, SLA timers, or escalations
5. Automatic notifications by email or SMS
6. Bulk admin editing beyond KML refresh and per-report review
7. Cloud-native storage in the current implementation

## Future-facing Implementation Direction
The static HTML and JavaScript application preserves the existing visual design. Supabase provides Postgres, Auth, Storage and the public submission Edge Function. Vercel serves static files only. Existing local history has been migrated; the root README documents deployment and admin access.

## Brand Personality
The product should feel clear, responsive, and grounded. It should communicate civic trust, practical competence, and calm operational control rather than startup novelty or overly decorative polish.

## Anti-references
Avoid clunky, obviously AI-generated interfaces, especially layouts that feel generic, overcrowded, or mechanically templated. Avoid visual directions that prioritize novelty over clarity, as well as dashboard patterns that feel noisy, sterile, or disconnected from the civic, place-based nature of the product.

## Design Principles
1. Make location certainty unmistakable: every interaction should reinforce that reports belong to fixed, real-world places.
2. Reduce friction in the field: public reporting should feel fast, forgiving, and mobile-first without sacrificing data quality.
3. Let the map earn trust: public status views should feel legible, current, and evidence-backed rather than decorative.
4. Keep admin maintenance lightweight: reviewing, updating, and correcting data should feel operational, not bureaucratic.
5. Stay visually grounded in place: the interface should feel civic and credible, with polish that supports trust instead of distracting from it.

## Accessibility & Inclusion
Support strong mobile and desktop usability across the full product. Prioritize clear form controls, readable type, reliable tap targets, practical responsive layouts, and interactions that remain understandable on smaller screens and in field conditions.
