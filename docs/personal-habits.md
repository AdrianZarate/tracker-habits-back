# Edit your personal habit definition

Personal title, category, color and icon belong to the authenticated user's
`HabitUser` association, not the shared habit catalog. Editing them never changes
another user's definition, the habit ID/slug, or existing log keys and dates.

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
and any stored optional metadata. An empty definition patch reads the owned
habit without changing it.

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
unspecified metadata. The create response remains the association object.
Renaming via the definition route does not recompute the catalog slug.

## Scope and verification

This unit does not introduce schedules, targets, goal history, measured progress,
pause/archive semantics or log correction. Existing calendar and lifecycle
behavior is retained.

Deterministic service, DTO and controller tests cover owner filters, insert-only
catalog updates, title fallback, validation/clearing, creation/reactivation and
route compatibility. Aggregate tests inspect Mongo pipeline contracts; they do
not prove execution against a live MongoDB. Existing mocked HTTP regressions run
without a real database or private environment configuration.
