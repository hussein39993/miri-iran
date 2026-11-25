# Charter724 integration (step 1: backend, search only)

Source of truth: `docs/charter724-openapi.json` (APICore 1.1.0, OpenAPI 3.0.3, server `https://api724.ir`).

## Status
| Item | Status |
|---|---|
| Two-step JWT login (`/api/userPassBase64` -> `/api/Login`) | Implemented, tested with a documented mock only |
| Token expiry from `Data.expires_Utc` (UTC, capped at 24 h, default 5 min if missing/invalid); one re-login + one retry on 401 | Implemented, mock-tested |
| Documented error codes (`-105`, `-203`, `-104`, `validation`) mapped to readable errors with `providerCode` | Implemented, mock-tested |
| `GET /api/airports` (provider `Airportlist`, 6 h cache) | Implemented, mock-tested |
| Flight search: one-way and round trip (two `Available` calls), cabin filter, per-passenger pricing, rial -> toman | Implemented, mock-tested |
| `tools/check-live.js` (read-only live check) | Implemented, run only against the mock |
| **Any call to the real api724.ir** | **None has been made.** Not verified. |
| Reservation, payment, ticket issue, cancellation, refund, charge, 15-day prices | **Not implemented, not referenced in code** (a test enforces this) |
| Frontend | **Unchanged** (V5, demo results) |

## Endpoints used (all read-only)
| Purpose | Method + path | Auth |
|---|---|---|
| Public IP seen by the API | GET `/api/showmyip` | none |
| Encode credentials | POST `/api/userPassBase64` `{username,password}` -> `Data: "Basic ..."` | none |
| Login | POST `/api/Login` `{userPassBase64}` -> `Data.{access_token,expires_Utc}` | none |
| Airports | GET `/api/WebService/Airportlist` | Bearer |
| Search a day | POST `/api/WebService/Available` `{from_flight,to_flight,date_flight}` | Bearer |

All answers use the envelope `{Result, Msg, Data}`. Errors come with HTTP 400/401/422 and the code in `Msg`.

## Our API
- `GET /api/airports` -> `{source, fictional, airports:[{code,codeInt,nameEn,nameFa}]}`
- `POST /api/flights/search` body `{from,to,date,trip?,returnDate?,adults?,children?,infants?,cabin?}` ->
  - demo: `{source:"demo", fictional:true, results}` (unchanged; a round trip is one list with doubled example prices)
  - live: `{source:"charter724", fictional:false, trip, results, returnResults?, empty, meta}`; for a round trip `results` is the outbound day and `returnResults` the return day. Prices are per leg; the trip total is the sum of the chosen legs.
- Errors: `{error:{code, message, fields?, providerCode?}}`. `providerCode` is only the provider's short `Msg` code, never its payload.

### Result item (live)
`id` (stable, unique), `airline`, `airlineCode`, `flightNumber` (as given, airline prefix already stripped by the provider), `from`, `to`, `departureDate`, `departure` (HH:mm), `arrivalDate`, `arrival` (HH:mm or null), `durationMinutes`, `hasStop`, `stops` (0, or null when it is a stop flight: the count is not documented), `baggageKg`, `baggage`, `cabin`, `cabinLabel`, `providerType` (charter/system), `capacity`, `price` `{amountToman, currency:"IRT", converted, original:{amount,currency}, unitToman:{adult,child,infant}, passengers}`, `cancellationRules`, `alternatives` (informational: no `ajency_online_ID`, so not bookable), `providerRef` (fields the documented GetCaptcha step will need; a future booking step must re-search and re-check the price on the server and must not trust values sent by the browser).

### Filtering rules (counted in `meta.excluded`)
`otherCabin`, `unknownCabin` (label could not be classified; the raw labels are listed in `meta.unclassifiedCabins`), `noCapacity` (capacity 0 or price 0; documented as "0 when capacity is 0"), `insufficientSeats` (adults + children > capacity; infants take no seat), `missingChildPrice`, `missingInfantPrice`, `unsupportedCurrency` (only IRR/IRT are converted).

## Assumptions to verify against the real server (step 2)
1. Cabin labels: only `Economy` / `اکونومی` are documented as an example. Business patterns are an assumption in `mapping.json` (`flightSearch.response.cabin`).
2. Currency is expected to be `IRR`.
3. `Result:"false"` on a 200 answer is treated as an error (the spec's error examples show `"true"`, so this is defensive).
4. `-104` / `-404` / `Unauthorized` are documented on login steps without a stated meaning; messages about them are generic.
5. How an IP-restricted account fails is not documented; `-105` is assumed (the message says "may").
6. `capacity` may be the sum over `other_flights`; the final seat check belongs to reservation.
7. The provider rate limits are unknown; we do not call it in loops (round trip = 2 calls, airports cached).

## Modes and safety
- `APP_MODE=demo` (default): invented results, flagged. `APP_MODE=live`: needs base URL, username, password; otherwise 503 `PROVIDER_NOT_CONFIGURED`. Never falls back to demo data silently.
- `/api/bookings`, `/api/tickets/issue`, `/api/refunds`: 403 in demo, 403 unless `ALLOW_LIVE_TRANSACTIONS=true`, 403 for the `demo` account unless sandbox confirmed, and even then 501. Nothing is mapped to the provider.
- Secrets: only in `.env`; redacted from logs (`userPassBase64`, passwords, tokens, bearer strings).
- Static IP: if the production account is IP-restricted, the server must run from the whitelisted address. GitHub Pages cannot run it.

## Tests
`npm test` runs 4 suites (85 checks). `tests/test_charter724.js` uses fixtures in `tests/fixtures/charter724`, which are validated against the OpenAPI schemas by a mini schema checker, and a mock provider (`tests/helpers/charter724-mock.js`) that enforces the documented request fields and Bearer auth, including a real local HTTP server so the real `fetch` path runs.
