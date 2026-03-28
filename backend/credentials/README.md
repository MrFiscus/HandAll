Place your Google service account JSON file in this folder.

Recommended filename:
- `google-service-account.json`

Expected env settings:
- `GOOGLE_SERVICE_ACCOUNT_FILE=backend/credentials/google-service-account.json`
- `GOOGLE_CALENDAR_ID=primary`

Notes:
- Do not commit the JSON key file.
- The repo `.gitignore` already ignores `backend/credentials/*.json`.
- The service account must have access to the Google Calendar you want to read.
