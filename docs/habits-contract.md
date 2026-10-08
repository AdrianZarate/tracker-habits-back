# Owner-scoped habit calendar API

All `/habits` routes require a bearer JWT. The authenticated account, never a
query/body user ID, scopes associations and logs. Every `:habitId` route uses
`ParseMongoIdPipe`; malformed IDs return 400.

## Detail and ownership

`GET /habits/:habitId` returns exactly `{ habitId, title, slug, active }`.
`habitId` is the global habit ID (serialized as a string), title/slug come from
that habit, and active comes from the authenticated user's association. Owned
inactive habits are readable. Missing associations, another user's habits and
orphaned associations all return 404 `Habit not found for this user`.
The static `GET /habits/logs` declaration precedes the dynamic detail route.

| Route                                | Behavior and existing response                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /habits`                        | Active associated habits; array of `{ habitId, title, slug }`.                                                                                                                 |
| `PATCH /habits/:habitId`             | Owner-only deactivation, including already inactive; returns association. Missing/non-owned returns 404.                                                                       |
| `POST /habits/:habitId/complete`     | Requires active ownership; upserts and returns the current day's raw log. Repeated completion uses the same unique key.                                                        |
| `DELETE /habits/:habitId/incomplete` | Deletes only this owner's current-day log; returns `{ acknowledged, deletedCount }`. No active-association requirement; absent logs remain a no-op.                            |
| `GET /habits/:habitId/logs`          | Owner-filtered raw logs array in an inclusive calendar-label range, including inactive history. No new association check or 404; absent/non-owned logs produce an empty array. |
| `GET /habits/logs`                   | All this owner's logs, including inactive history, newest label first; array of `{ _id, habitId, title, slug, date, completed }`. No current-month filter on this endpoint.    |

Responses remain direct objects/arrays, without a new envelope. The global
catalog, log schema and unique `(userId, habitId, date)` index are unchanged.

## Account-local days and history queries

JWT validation includes the persisted public `timeZone` field. A legacy account
without it uses UTC in habit operations. Server-local/browser zones do not
replace the persisted account zone. See [account calendar contract](calendar-contract.md).

Complete and undo derive today's label from the current instant in that zone,
including DST, then store/query its UTC-midnight Date anchor. For example,
`2025-04-01T00:30:00Z` is label `2025-03-31` in `America/Los_Angeles`.

`GET /habits/:habitId/logs?startDate=2024-02-01&endDate=2024-02-29` accepts only
strictly valid Gregorian `YYYY-MM-DD` labels, years 0001–9999. Both bounds are
inclusive (`$gte`/`$lte`). Omitted bounds independently default to the first/last
labels of the current **account-local calendar month**. The resulting range
must have start <= end. Invalid formats, impossible dates, empty values,
timestamps/offsets and reversed ranges return 400 before a log database query.
No timestamp or timezone-offset interpretation is performed on query labels.

Historical Dates already encode labels. Reads return their raw anchors unchanged
(JSON ISO strings), not converted through the account zone. There is no legacy
rewrite, migration, or index change; clients should render them as calendar labels.

## Verification boundary

Mocked-model service and JWT unit tests cover ownership, inactive behavior,
projection, east/west day keys, month boundaries, DST, strict/inclusive queries
and unchanged historical responses. Route order has a structural regression;
HTTP guard/validation integration belongs to Stage 2 T5. No live Mongo or Google
verification is claimed.
