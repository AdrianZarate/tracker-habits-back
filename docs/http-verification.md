# Isolated HTTP verification

Run from the API directory: `yarn test:e2e --runInBand`.
`test/app.e2e-spec.ts` contains 38 deterministic HTTP cases. This is coverage of
existing behavior, not a production behavior change: no meaningful production
RED is claimed. Harness setup/formatting failures are not product regressions.

## Real application paths

The isolated Nest TestingModule uses the real HabitsController/HabitsService,
CommonService, Passport JWT authentication, JwtStrategy, Auth/UserRoleGuard,
GetUser, ParseMongoIdPipe and habit DTOs. Its global ValidationPipe matches
bootstrap: `whitelist: true, forbidNonWhitelisted: true`. JwtService signs tokens
with a fixed synthetic secret; ConfigService uses only synthetic configuration
with process-environment lookup disabled.

Cases cover missing/malformed/expired/wrong-secret/unknown-user JWTs; persisted
user identity and timezone projection despite forged signed claims; actual role
403/200 through a test-only controller; static logs route precedence; owned and
inactive detail shapes; equivalent missing/non-owner 404s; malformed IDs; active
ownership for complete; owner-only/idempotent deactivate; owner-filtered undo;
DTO and query 400s, including unsupported fields; inclusive ranges, inactive
leap-day history and request-local month defaults. At the fixed April 1 UTC
instant, the Los Angeles account completes/undoes March 31 while the UTC account
completes April 1. Historical labels remain unchanged.

## Mocked and unverified boundaries

Only Mongoose model persistence is doubled. Fixtures contain multiple owners;
doubles evaluate supplied owner/ID/active/date filters. Assertions also capture
model filters, update options and JWT user projection, so ownership business
logic is not mocked. The aggregate double simulates the lookup/projection/sort;
this is not Mongo aggregation, schema/index or persistence verification. Three
Jest virtual alias forwards return real source exports because the existing e2e
configuration has no `src` path mapping; they do not replace guard/pipe behavior.

There is no AppModule import, `.env` load, Mongo connection, Google/OAuth call,
AuthController/AuthService fake, or external network access. Authentication
startup configuration, CORS/Swagger, Google login and live DB/OAuth remain outside
this suite. The User schema/strategy has no deactivation field/check; no invented
"deactivated user must return 401" contract is asserted. Inactive *habits* are
covered. Foreign undo returns the existing 200/deletedCount0, not a new 404.

Supertest uses an ephemeral listener bound explicitly to `127.0.0.1`. Only Date
is faked; I/O timers remain real. Teardown awaits `app.close()` and restores the
clock. The focused run exits normally without an open-handle warning.
