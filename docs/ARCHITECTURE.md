# Architecture and migration notes (V5)

## Modules (static, no build step)
| File | Role | Future Next.js location |
|---|---|---|
| js/core.js | Pure rules, service catalog, local date helper | `src/lib/validation.ts`, `src/features/catalog` |
| js/providers.js | Mock supplier adapters, demo store, Snapp provider | `src/server/providers/*` (server only) |
| js/i18n.js, i18n3.js | Translations | `src/i18n/{ar,fa,en}.json` |
| js/ui.js, wizard.js, views.js, app.js | Presentation, flow, routing | `src/components`, `src/app` |

Rule kept for migration: UI never decides prices, balances or booking state. Today `providers.js` plays the server role; in Next.js those functions become authenticated API routes.

## Snapp provider
`SnappRideProvider` interface: `quote`, `create`, `track`, `cancel`, `verifyWebhook`.
- `DemoSnappProvider`: simulated quotes and status ladder (searching, assigned, enroute, completed, cancelled). Demo wallet payment is rejected.
- `OfficialSnappProvider`: every method throws `SNAPP_OFFICIAL_NOT_AUTHORIZED`. No endpoints, credentials or API shape are assumed. Fill it only from Snapp's official business documentation after an agreement.

## Future wallet-paid ride workflow (NOT implemented)
1. Server gets an official quote and stores it with an expiry.
2. User reviews price and gives explicit consent for that quote id.
3. Server opens a DB transaction: idempotency key (unique), reserve funds with a double-entry ledger (user wallet -> hold account).
4. Server creates the ride with the provider using the same idempotency key.
5. Success: capture hold -> provider payable. Failure/timeout: release hold; reconcile by polling provider before retrying (never blindly re-create, to avoid double rides or double charges).
6. Provider webhooks verified by the provider's documented method; status updates are idempotent.
7. Cancellation and refunds create reversing ledger entries, never edits.
8. Daily reconciliation job compares ledger, payment provider and Snapp reports; mismatches raise alerts.
Requires: signed commercial agreement, licensed payment infrastructure, KYC/AML review, audit logging, role-based finance permissions.

## Security status
Implemented: DOM built with textContent (no innerHTML), input validation, no network calls, no storage of financial data, frozen demo balance, wallet payment disabled.
Not applicable/planned: authentication, CSRF, rate limiting, server-side authorization, CSP headers (need a server or hosting config).

## V4 additions: map, geocoding, routing
- `js/map.js` is the only module that touches the network. Allowed hosts (enforced by a test and by the CSP meta tag): cdnjs.cloudflare.com (Leaflet 1.9.4), tile.openstreetmap.org, nominatim.openstreetmap.org, router.project-osrm.org.
- All four are public demo services without an SLA. For production use a commercial or self-hosted tile, geocoding and routing provider; keep API keys on the server and proxy requests.
- Nominatim policy is respected: search only on submit (no autocomplete), 1 request/second throttle, results cached, reverse geocoding only when a point is confirmed.
- If Leaflet fails to load, the taxi flow still works with approximate landmark presets. If routing fails, a labelled straight-line approximation is used.
- `DemoSnappProvider.quote` needs a route (km, min). Fares come from `FARES` example constants and are always labelled as examples. Driver arrival is `null` (needs an official provider).
- Planned, not implemented: Leaflet vendored locally with SRI, saved home/work addresses, scheduled rides, extra stops, ride sharing.

## V5 additions
- `core.js`: pure rules `pax`, `returnDate`, `refRef`; pure helpers `paxEquivalent`, `filterResults`, `sortResults`; `FARE_FACTOR` (frozen example factors). These move 1:1 to a shared TypeScript module.
- `providers.js`: `search()` accepts the V5 flight form (trip, ret, adults, children, infants). The legacy `pax` field still works.
- `wizard.js`: field set `f` (flight) and `x`/`y` (refund). Results step has client-side sort/filter over the supplier response; in Next.js, sorting and filtering of large result sets should move to the server API with pagination.
- Refund requests are validated against demo bookings of the current session. A real refund needs: booking ownership check on the server, supplier refund rules, a reversing double-entry ledger entry, audit log, finance-role approval.
- Testing: `npm test` (34 Node checks). `tests/ui_smoke.js` drives the real UI in headless Chromium (optional; needs puppeteer). Map/geocoding/routing against the real internet remain untested.
