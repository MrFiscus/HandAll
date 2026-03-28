import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendDir, '..');

function resolveServiceAccountFile() {
  const configuredPath =
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE || 'backend/credentials/google-service-account.json';
  const candidates = [
    configuredPath,
    path.resolve(repoRoot, configuredPath),
    path.resolve(backendDir, configuredPath),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function parseJsonEnv(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return JSON.parse(value.replace(/\\n/g, '\n'));
  }
}

async function getCalendarClient() {
  const serviceAccountJson = parseJsonEnv(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const serviceAccountFile = resolveServiceAccountFile();

  if (!serviceAccountJson && !serviceAccountFile) {
    throw new Error(
      'Google Calendar credentials not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_FILE.'
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccountJson || undefined,
    keyFile: serviceAccountJson ? undefined : serviceAccountFile,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });

  const authClient = await auth.getClient();
  return google.calendar({ version: 'v3', auth: authClient });
}

async function getCalendarClientForAccessToken(accessToken) {
  if (!accessToken) {
    throw new Error('Google provider token is required.');
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: 'v3', auth });
}

function getOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Google OAuth client credentials not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.',
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret);
}

export async function refreshGoogleAccessToken(refreshToken) {
  if (!refreshToken) {
    throw new Error('Google refresh token is required.');
  }

  const auth = getOAuthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await auth.refreshAccessToken();

  if (!credentials?.access_token) {
    throw new Error('Failed to refresh Google access token.');
  }

  return {
    accessToken: credentials.access_token,
    expiryDate: credentials.expiry_date
      ? new Date(credentials.expiry_date).toISOString()
      : null,
  };
}

function toIsoString(value, timeZone) {
  if (!value) return null;
  if (typeof value === 'string') return value;

  if (value instanceof Date) {
    return value.toISOString();
  }

  return null;
}

function normalizeAttendees(attendees = []) {
  if (!Array.isArray(attendees)) return [];

  return attendees.map((attendee) => ({
    email: attendee.email || '',
    displayName: attendee.displayName || attendee.email || '',
    responseStatus: attendee.responseStatus || 'needsAction',
    optional: !!attendee.optional,
    organizer: !!attendee.organizer,
    self: !!attendee.self,
  }));
}

function normalizeReminders(reminders) {
  if (!reminders) return [];

  if (reminders.useDefault) {
    return [{ method: 'default', minutes: null }];
  }

  return (reminders.overrides || []).map((reminder) => ({
    method: reminder.method || 'popup',
    minutes: typeof reminder.minutes === 'number' ? reminder.minutes : null,
  }));
}

function inferCategory(event) {
  const combined = [
    event.summary,
    event.description,
    event.location,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/(class|lecture|lab|assignment|exam|quiz|project|homework|d2l|canvas|school|csc|course)/.test(combined)) {
    return 'school';
  }

  if (/(meeting|standup|interview|work|office|client)/.test(combined)) {
    return 'work';
  }

  if (/(gym|workout|run|doctor|appointment|family|birthday|dinner)/.test(combined)) {
    return 'personal';
  }

  return 'general';
}

function inferPriority(event) {
  const combined = [event.summary, event.description].filter(Boolean).join(' ').toLowerCase();

  if (/(urgent|asap|important|final|exam|deadline|due|submit|tonight)/.test(combined)) {
    return 'high';
  }

  if (/(optional|maybe|sometime|low priority)/.test(combined)) {
    return 'low';
  }

  return 'medium';
}

export function extractEventFields(event) {
  return {
    id: event.id || '',
    title: event.summary || 'Untitled Event',
    description: event.description || '',
    startTime: event.start?.dateTime || event.start?.date || null,
    endTime: event.end?.dateTime || event.end?.date || null,
    location: event.location || '',
    attendees: normalizeAttendees(event.attendees),
    recurrence: Array.isArray(event.recurrence) ? event.recurrence : [],
    reminders: normalizeReminders(event.reminders),
    status: event.status || 'confirmed',
    calendarId: event.organizer?.email || '',
    htmlLink: event.htmlLink || '',
  };
}

export function convertEventToTask(event) {
  const extracted = extractEventFields(event);

  return {
    task_name: extracted.title,
    details: extracted.description,
    due_start: extracted.startTime,
    due_end: extracted.endTime,
    category: inferCategory(event),
    priority: inferPriority(event),
    location: extracted.location,
    attendees: extracted.attendees,
    recurrence: extracted.recurrence,
    reminders: extracted.reminders,
    source_event_id: extracted.id,
    source_html_link: extracted.htmlLink,
  };
}

export async function fetchGoogleCalendarEvents({
  calendarId,
  timeMin,
  timeMax,
  maxResults = 250,
  q,
}) {
  const calendar = await getCalendarClient();
  const selectedCalendarId = calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';

  const response = await calendar.events.list({
    calendarId: selectedCalendarId,
    timeMin,
    timeMax,
    maxResults,
    singleEvents: true,
    orderBy: 'startTime',
    q: q || undefined,
  });

  const items = response.data.items || [];

  return {
    calendarId: selectedCalendarId,
    events: items.map(extractEventFields),
    tasks: items.map(convertEventToTask),
  };
}

export async function fetchGoogleCalendarEventsWithAccessToken({
  accessToken,
  calendarId,
  timeMin,
  timeMax,
  maxResults = 250,
  q,
}) {
  const calendar = await getCalendarClientForAccessToken(accessToken);
  const selectedCalendarId = calendarId || 'primary';

  const response = await calendar.events.list({
    calendarId: selectedCalendarId,
    timeMin,
    timeMax,
    maxResults,
    singleEvents: true,
    orderBy: 'startTime',
    q: q || undefined,
  });

  const items = response.data.items || [];

  return {
    calendarId: selectedCalendarId,
    events: items.map(extractEventFields),
    tasks: items.map(convertEventToTask),
  };
}

export async function fetchGoogleCalendarEventsWithRefreshToken({
  refreshToken,
  calendarId,
  timeMin,
  timeMax,
  maxResults = 250,
  q,
}) {
  const { accessToken, expiryDate } = await refreshGoogleAccessToken(refreshToken);
  const result = await fetchGoogleCalendarEventsWithAccessToken({
    accessToken,
    calendarId,
    timeMin,
    timeMax,
    maxResults,
    q,
  });

  return {
    ...result,
    refreshedAccessToken: accessToken,
    refreshedAccessTokenExpiry: expiryDate,
  };
}
