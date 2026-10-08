# Account calendar contract

Google login accepts an optional browser IANA `timeZone`. Omission assigns UTC;
a supplied invalid zone returns 400, even if the account already has a zone.
Google token verification and profile handling remain unchanged.

New accounts store the first zone. Legacy accounts have no schema default: their
first Google login assigns only a missing field, using an atomic conditional
update. Concurrent logins read the winning assignment; later device zones never
overwrite it. Google login replies include `timeZone` alongside the existing
name, email, picture and token. Check-status adds only `timeZone` to its existing
public fields and token; an unassigned legacy account reports UTC without writing.

`src/common/calendar.ts` separates instants from labels:

- `calendarDay(instant, timeZone)` uses Intl Gregorian/Latin date parts, including DST.
- `dayLabelToUtcAnchor(day)` validates exact `YYYY-MM-DD` dates (years 0001–9999)
  by round-trip and returns the existing UTC-midnight storage representation.
- `calendarMonthBounds(instant, timeZone)` returns inclusive first/last-day anchors
  for the account-local current month, not elapsed-time boundaries.

Historical log Dates already represent calendar labels. Never convert them through
an account timezone, shift them, or rewrite them after timezone assignment. No
migration or unique-index change is required. T1 introduces this contract and the
helpers only; habit operations will adopt them in T2.
