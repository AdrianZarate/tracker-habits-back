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

## Correct progress or notes for a date

Use `PATCH /habits/:habitId/logs/:date`, for example
`PATCH /habits/000000000000000000000001/logs/2025-03-31`:

```json
{ "amount": 15, "note": "Corrected reading total" }
```

The date must be a real `YYYY-MM-DD` calendar label no later than **today in the
account timezone** (UTC by default). Timestamp strings, invalid dates and future
labels return 400. Stored dates remain UTC label anchors, not converted local
midnights.

| Operation | Contract |
| --- | --- |
| Quantity correction | Supply `amount`, a finite replacement total 0–1e9. Completion is derived from the original threshold; `completed` is rejected. |
| Checkbox correction | Supply an explicit boolean `completed`, including `false`. `amount` is rejected. |
| Notes-only correction | Supply `note` on an existing record. Amount, completion and snapshot remain exactly unchanged, even for a legacy missing amount. |
| Set or clear note | Trimmed string, at most 2000 characters. Empty or whitespace-only strings unset the stored field. Omission preserves it. |
| New past/current record | Requires active authenticated ownership, explicit progress and a selected weekday when applicable. Notes alone return 400. |
| Existing record | Requires authenticated ownership; inactive habits and previously recorded nonselected weekdays can be corrected without reactivation. |
| Invalid payload | Empty payloads, unknown fields, null and incorrect types return 400. At least one supported field is required. |

Corrections replace current values; they do not create an audit trail. A stored
`configurationSnapshot` always wins over later definition edits. Snapshotless
legacy records use the T2 definition effective on the requested date (daily
checkbox before the first revision). No snapshot is backfilled and no amount is
inferred from a boolean. New records insert their original snapshot only once;
a concurrent insert winner's original goal is re-evaluated before correction.

Final writes guard the original log `_id` as well as owner, habit and date. If
concurrent undo/reinsert removes that identity, the request returns **409** rather
than overwriting a replacement record; reload before retrying. This guards
identity, not simultaneous corrections to the same surviving record.

Both `GET /habits/:habitId/logs` and `GET /habits/logs` expose `note` only when
stored. Bodyless completion remains compatible and does not edit notes; current-
day undo still deletes the whole current-day record.

## Read a week's progress

Use `GET /habits/:habitId/week?date=2025-03-31`. Omit `date` to select today in
the authenticated account's timezone (UTC by default). The optional query accepts
only real `YYYY-MM-DD` labels, not null, timestamps, repeated values or extra keys.
A full ISO Monday–Sunday week must fit within years 0001–9999; overflow returns
400 rather than a partial week. Future labels are readable. Inactive owned habits
remain readable; missing and foreign associations return the same 404.

The response contract is:

```typescript
{
  habitId: string;
  date: string;                  // Selected account-date label
  weekStart: string;             // Monday, inclusive
  weekEnd: string;               // Sunday, inclusive
  configuration: HabitConfiguration; // Original selected-day goal/schedule
  scheduledOnDate: boolean;
  completedDays: number;
  weeklyTarget?: number;        // Selected date's weekly quota only
  weeklyCompleted?: boolean;    // completedDays >= weeklyTarget
  days: Array<{
    date: string;               // Seven ascending labels, Monday–Sunday
    scheduled: boolean;
    completed: boolean;
    amount?: number;
    note?: string;
    configurationSnapshot: {
      configuration: HabitConfiguration;
      revisionId?: string;
      effectiveFrom?: string;
    };
  }>;
}
```

Each recorded day's original snapshot wins. Snapshotless legacy records and
empty days use the definition effective on that date (daily checkbox before the
first revision). The selected day's resolved snapshot supplies the top-level
`configuration` as well. These fallback snapshots are **response-only**, never
backfilled into storage. Stored completion booleans are authoritative even when
an amount disagrees with the goal; missing amounts are not invented. Optional
amount/note fields appear only when stored, including zero amounts.

`scheduled` uses each day's own configuration: daily and weekly allow every day;
selected weekdays match ISO Monday=1 through Sunday=7. A stored completed record
still counts even on a nonselected day. Empty days are incomplete.
`completedDays` counts unique stored completed dates in the seven-day range,
using the existing unique owner/habit/date index; quantities with different units
are never summed. `weeklyTarget` and `weeklyCompleted` appear **only** when the
selected day's schedule is weekly. They describe that selected date's quota,
not a recalculation of all historical weeks or a rewrite of midweek definitions.
Selecting a different date in the same week can therefore change the displayed
quota while leaving completed-day counts and per-day history unchanged.

Dates are account-day labels stored/read as UTC anchors, not local-midnight
instants. Week arithmetic uses calendar fields, never elapsed 24-hour durations
across DST. This endpoint performs no database writes and leaves both existing
log-read response contracts unchanged.

## Scope and verification

Current-day measured recording, original snapshots, notes, historical correction
and weekly reads are implemented. Pause/archive and frontend controls remain
later work; there is no bulk migration or automatic recalculation of history.

Deterministic helper, schema, service, DTO, controller and synthetic HTTP tests
cover strict validation, dates/timezones/DST, original goals, pending changes,
replacement totals, thresholds, schedules, legacy compatibility, immutable
snapshots, notes-only preservation, historical corrections, legacy quantity gaps,
owner/activity checks, undo/reinsert conflicts, ISO weeks/year overflow, selected-date
quotas and authoritative stored completed-day counts. Concurrent-winner and duplicate-key tests
inspect Mongo update contracts using doubles, not live MongoDB execution. HTTP
regressions use synthetic fixtures without a database or private environment
configuration.
