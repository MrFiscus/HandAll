/**
 * Single active calendar source per user — used to filter tasks for AI, planner, and UI.
 * Canonical URLs:
 * - Uploaded/processed ICS: `file://name.ics` (matches tasks.source_url from imports)
 * - Google Calendar: `google-oauth:<calendarId>` (default calendarId `primary`)
 */

export function googleOAuthSourceUrl(userRow) {
  const cid = String(userRow?.google_calendar_calendar_id || 'primary').trim() || 'primary';
  return `google-oauth:${cid}`;
}

/**
 * Returns true if this task row belongs to the active calendar (import or Google sync).
 */
export function taskMatchesActiveCalendar(taskRow, activeUrl) {
  if (!activeUrl || typeof activeUrl !== 'string' || !String(activeUrl).trim()) {
    return false;
  }
  const a = String(activeUrl).trim();
  const s = String(taskRow?.source_url || '').trim();
  const p = String(taskRow?.planner_source_url || '').trim();
  return s === a || p === a;
}

/**
 * Resolve which calendar URL is active for planning/AI.
 * Uses users.active_calendar_source_url when set and valid; otherwise picks a default.
 */
export async function resolveActiveCalendarSource(db, userId) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId);
  if (!user) {
    return { user: null, activeUrl: null, calendarUrls: [], source: 'none' };
  }

  const sources = await db.all(
    'SELECT url FROM calendar_sources WHERE user_id = ? ORDER BY id ASC',
    userId,
  );
  const calendarUrls = sources.map((r) => r.url).filter(Boolean);

  let stored = String(user.active_calendar_source_url || '').trim();
  let source = 'stored';

  const validate = (url) => {
    if (!url) return null;
    if (url.startsWith('google-oauth:')) {
      if (!user.google_calendar_connected) return null;
      const expected = googleOAuthSourceUrl(user);
      return url === expected ? url : null;
    }
    return calendarUrls.includes(url) ? url : null;
  };

  let activeUrl = validate(stored);

  if (!activeUrl && user.google_calendar_connected) {
    activeUrl = googleOAuthSourceUrl(user);
    source = 'default_google';
  } else if (!activeUrl && calendarUrls.length > 0) {
    activeUrl = calendarUrls[calendarUrls.length - 1];
    source = 'default_last_ics';
  } else if (activeUrl) {
    source = 'stored';
  } else {
    source = 'none';
  }

  return { user, activeUrl: activeUrl || null, calendarUrls, source };
}

/**
 * SQL WHERE fragment (parameterized) for tasks tied to the active calendar.
 * Returns { clause: string, params: any[] } or null if no active URL (caller should skip rows).
 */
export function sqlTasksForActiveCalendar(activeUrl) {
  if (!activeUrl) {
    return { clause: '(1=0)', params: [] };
  }
  const a = String(activeUrl).trim();
  return {
    clause: '(COALESCE(source_url, \'\') = ? OR COALESCE(planner_source_url, \'\') = ?)',
    params: [a, a],
  };
}
