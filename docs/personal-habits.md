# Edit your personal habit definition

Personal metadata and schedule/goal configurations belong to the authenticated
user's `HabitUser` association, not the shared habit catalog. Metadata changes
immediately; schedule/goal edits take effect **the next account-local calendar
day**, preserving original historical goals. Neither changes another user's
configuration, the habit ID/slug, or existing log keys and dates.

## Quick path

Create with `POST /habits`:

```json
{ "title": "Read daily", "category": "Learning", "color": "#123abc", "icon": "book" }
```

Edit an owned habit with `PATCH /habits/:habitId/definition`:

```json
{ "title": "Read before bed", "category": "", "color": "#abcdef" }
```

This changes the personal title, clears category and preserves the omitted icon.
The definition response uses the detail shape: `habitId`, `title`, `slug`, `active`,
and any stored optional metadata. Versioned habits also include `configuration`
and, when a future change exists, `pendingConfiguration` (see below). An empty
definition patch reads the owned habit without changing it.

## Validation and compatibility

| Field or operation | Contract |
| --- | --- |
| Title | Required on create; optional on edit. Trimmed string, 3–200 characters; cannot be cleared. |
| Category | Optional trimmed string, at most 80 characters. |
| Color | Optional trimmed `#RRGGBB` string; six hexadecimal digits, either case. |
| Icon | Optional trimmed string identifier, at most 64 characters. No icon registry enforced. |
| Clearing metadata | Send `""` (or whitespace, which trims to empty) to unset category/color/icon. |
| Omission | Preserves existing values on edit and reactivation. |
| Invalid values | Null, non-string values and unsupported payload fields are rejected. |
| Ownership | Edit filters by authenticated user ID and habit ID. Missing and foreign associations return the same 404. |
| Inactive associations | Remain editable without reactivation. |
| Legacy PATCH | Empty `PATCH /habits/:habitId` still deactivates; it is not a definition editor. |

Owner list and detail responses show the personal title, falling back to the
catalog title for legacy associations without an override. Optional metadata is
absent when not stored, preserving the legacy response shape. Owner-wide log
summaries use the same personal-title fallback without changing their existing
fields; this is current display metadata, not a historical title snapshot.

Creating a habit retains the existing slug-based catalog identity. Catalog
upserts set title/slug only on insertion. A new or reactivated association stores
the submitted personal title and supplied metadata, becomes active, and keeps
unspecified metadata. The create response retains association fields, but exposes current/pending
configuration instead of the raw revision array. Renaming via the definition
route does not recompute the catalog slug.

## Configure a schedule and goal

Send a **complete** `configuration` bundle on create or to
`PATCH /habits/:habitId/definition`. Schedule-only and goal-only patches are
invalid; omitting the bundle preserves configuration and appends no revision.

```json
{
  "configuration": {
    "schedule": { "kind": "weekly", "timesPerWeek": 3 },
    "goal": { "kind": "quantity", "target": 20, "unit": "pages" }
  }
}
```

| Configuration | Accepted shape |
| --- | --- |
| Daily | `{"kind":"daily"}` |
| Selected weekdays | `{"kind":"weekdays","days":[1,3,7]}`; distinct nonempty ISO days, Monday=1 through Sunday=7. |
| Weekly quota | `{"kind":"weekly","timesPerWeek":3}`; integer 1–7 **completed days**, not a weekly sum of quantities. |
| Checkbox goal | `{"kind":"checkbox"}`; semantic per-day target 1 (do not send `target` or `unit`). |
| Quantity goal | `{"kind":"quantity","target":20,"unit":"pages"}`; finite positive number <=1e9 and custom trimmed unit of 1–32 characters. |

Quantity targets apply **per recorded day/occurrence**. For the example above,
a completed day requires 20 pages and the weekly quota requires three such
days; recording 60 pages on one day does not fulfill three days. Current-day
recording evaluates completion against that day's original goal (see below).

Unknown/irrelevant fields, null, numeric strings, duplicate weekdays, fractional
weekly quotas and incomplete bundles are rejected. Configuration cannot change
ownership, catalog identity or lifecycle state.

## Effective dates and pending changes

A newly inserted association starts with the submitted configuration effective
**today** in the account timezone (UTC when omitted). With no bundle, it starts
with daily checkbox. Repeated `POST /habits` updates supplied metadata and
reactivates, but **never changes an existing association's revisions**, including
legacy associations without revisions. Use the definition PATCH to change them.

Each definition configuration edit atomically appends a complete revision with
a stable generated ObjectId string `revisionId` and `effectiveFrom` calendar
label (`YYYY-MM-DD`). It becomes effective tomorrow in the account timezone,
using calendar arithmetic rather than a 24-hour duration across DST. Earlier
revisions are retained. For any record date, select the greatest applicable
effective date; equal-date revisions use the final persisted array position.
Multiple edits today therefore leave today's goal unchanged and the last
persisted edit wins tomorrow.

Detail, definition and active-list reads on versioned associations show:

```json
{
  "configuration": {
    "schedule": { "kind": "daily" },
    "goal": { "kind": "checkbox" }
  },
  "pendingConfiguration": {
    "revisionId": "000000000000000000000001",
    "effectiveFrom": "2025-04-02",
    "configuration": {
      "schedule": { "kind": "weekly", "timesPerWeek": 3 },
      "goal": { "kind": "quantity", "target": 20, "unit": "pages" }
    }
  }
}
```

`pendingConfiguration` is absent when no future revision exists; otherwise it
shows the nearest upcoming date's winning revision. These reads do not expose
all raw revisions; the legacy deactivation response also uses current/pending
configuration without changing its deactivation semantics. Legacy associations
without revisions preserve their old
response shape: clients derive daily checkbox. The same fallback applies to
**all dates before the first revision**, without inventing an association birth
date or migrating existing rows. Inactive owned definitions remain editable.

## Record today's progress

Use `POST /habits/:habitId/complete` on an **active, owned** habit:

| Goal | Body | Result |
| --- | --- | --- |
| Checkbox | Empty body or `{}` | `completed: true`; numeric amounts are rejected. |
| Quantity | `{"amount":15}` | Replaces today's total; `completed` is true when amount reaches the original target. |

Amounts must be finite numbers from 0 through 1e9, including fractions. Zero
records incomplete progress; totals are **not increments**. A missing quantity
amount returns 400 without changing an existing record. Null, strings, negatives,
unknown fields and client-supplied `completed` or `configurationSnapshot` are
rejected. Missing, foreign and inactive associations return 404.

The account-local day is captured once before database operations. New records
store a full `configurationSnapshot` containing `configuration` and any resolved
`revisionId`/`effectiveFrom`. It is set only on insertion, never overwritten on
repeat writes; even concurrent insertion uses the first stored snapshot's goal.
Selected-weekday schedules reject new records on nonselected days; daily and
weekly-quota schedules allow any day. Existing records can still be updated on
nonselected days and are never deleted by schedule enforcement.

Legacy records keep their original date labels, IDs and unique owner/habit/date
key. Snapshotless records resolve the configuration applicable on their date;
repeat writes do not backfill snapshots. Missing legacy quantities are never
inferred from booleans: only an explicitly submitted amount adds measured data.
Habit-log reads and owner-wide summaries expose `amount` and
`configurationSnapshot` only when present, retaining legacy response shapes.
`DELETE /habits/:habitId/incomplete` still deletes today's record; it does not
redesign historical undo.

## Scope and verification

Current-day measured recording and original snapshots are implemented. Historical
correction, notes, weekly summaries, pause/archive and frontend controls remain
later work; there is no bulk migration or automatic recalculation of history.

Deterministic helper, schema, service, DTO, controller and synthetic HTTP tests
cover strict validation, dates/timezones/DST, original goals, pending changes,
replacement totals, thresholds, schedules, legacy compatibility, immutable
snapshots and owner/activity checks. Concurrent-winner and duplicate-key tests
inspect Mongo update contracts using doubles, not live MongoDB execution. HTTP
regressions use synthetic fixtures without a database or private environment
configuration.
