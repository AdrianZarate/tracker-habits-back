# Current API configuration and authentication

This is the authoritative setup guide. Older README examples of password login/registration are legacy and do not describe the current API.

## Startup configuration

Supply these uppercase environment variables through the process environment or the API-root `.env` file. Existing explicit values keep their meaning; process environment values take precedence over `.env` values. Do not commit credentials.

| Key                | Requirement / default                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB`          | Required nonempty MongoDB connection string. The application selects database `habit-tracker`.                                                                                                  |
| `GOOGLE_CLIENT_ID` | Required nonempty Google OAuth client ID; the audience checked for Google ID tokens.                                                                                                            |
| `JWT_SECRET`       | Required nonempty signing secret containing a non-whitespace character; no default. Use a strong private value. The supplied value is not trimmed.                                              |
| `PORT`             | Integer from 1 through 65535; omitted means **3000**. Numeric environment strings are converted to numbers. Empty, fractional and out-of-range values fail validation rather than falling back. |
| `NODE_ENV`         | Defaults to `development` when omitted.                                                                                                                                                         |

Nest validates configuration at startup. Bootstrap, MongoDB and authentication consume the canonical uppercase keys through `ConfigService`; the old lowercase aliases are no longer used. Both JWT signing and verification require the same `JWT_SECRET`. Invalid or missing required configuration prevents startup; there is no fallback signing key.

With valid configuration and MongoDB available, run `yarn start:dev`. Swagger is served at `/api` on the configured port. Startup requires database access, but unit tests do not: configuration tests use synthetic environments, restore them after each case and disable `.env` loading.

## Google-only authentication

1. Obtain a Google **ID token** for `GOOGLE_CLIENT_ID` in the client.
2. Send `POST /auth/google` with `{ "idToken": "<Google ID token>", "timeZone": "Europe/Madrid" }`. `timeZone` is optional; when provided it must be a valid IANA timezone. First assignment is persisted; later sign-ins do not silently replace it. Legacy accounts without a timezone use UTC.
3. Use the returned API JWT in `Authorization: Bearer <token>` for protected habit endpoints and `GET /auth/check-status`. API JWTs expire after two hours; acquire a new session through Google when needed.

There are no `/auth/register` or `/auth/login` password endpoints. Google credentials and ID tokens are not API JWTs. In Swagger, authorize with the returned API JWT using the `JWT-auth` bearer scheme.

## Verification boundary

The unit suite mocks database/authentication dependencies and does not contact MongoDB or Google. Actual mocked HTTP security/validation integration belongs to the separate T5b task; live-service verification requires a separately authorized environment. Never use production credentials or a live AppModule connection for these unit checks.
