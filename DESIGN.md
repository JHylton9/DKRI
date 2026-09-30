# DKRI interface

Register: product. Reference: user-provided FireMap specification, September 2026.

Residents and field staff use the public map outdoors; operations staff review reports on desktop. Use a light warm surface, compact system typography and practical controls. The map is the root page. Reporting is public at /report; staff sign in at /portal. No public accounts or admin navigation on the public map.

Use the FireMap OKLCH tokens in styles.css, a single muted red accent, 1px full borders, 6px control radii, 4px spacing increments and 44px touch targets. System fonts only. Primary actions use dark ink; status colors always have labels. No hero sections, metric cards, decorative gradients, glass, or animation.

Desktop map: 304px scrolling sidebar and full-height map. Mobile: map first with a collapsible bottom sheet. Street/satellite switch upper right; zoom/show-all lower right. Preserve provider attribution and metric scale. Search, layers, filters, selected details, 20-item paged location list, report action. Date filters apply to latest report date.

Admin: header with account identity, 180px navigation rail, task-focused Reports, Locations, Activity and Password sections. Imports validate and show counts/sample before explicit publishing. Published inventories can be restored without removing report history. No public user-management module because public accounts are out of scope.

Accessibility: skip links, visible labels, 3px focus ring, polite live status, full keyboard support, selected/pressed states, reduced motion, text alternatives and list access to all mapped locations. Tables scroll within their container on narrow screens.

