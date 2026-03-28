import { supabase } from "../lib/supabase";
import { CalendarEvent, UserProfile } from "../store/useAppStore";

function mapUserProfile(data: any): UserProfile {
  return {
    name: data.username || "Student",
    level: data.level || 0,
    xp: data.xp || 0,
    wakeTime: data.wake_time || "07:00",
    sleepTime: data.sleep_time || "23:00",
    sideGoals: data.side_goal ? [data.side_goal] : [],
    calendarUrls: Array.isArray(data.calendar_urls)
      ? data.calendar_urls
      : (data.google_calendar_url ? [data.google_calendar_url] : []),
  };
}

async function getAuthHeaders() {
  if (!supabase) return { 'Content-Type': 'application/json' };
  
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session?.access_token}`
  };
}

export const api = {
  async fetchUser(): Promise<UserProfile> {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/user', { headers });
    if (!res.ok) throw new Error('Failed to fetch user');
    const data = await res.json();
    return mapUserProfile(data);
  },

  async updateUserSetup(profile: Partial<UserProfile>): Promise<{ success: boolean; user?: UserProfile }> {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/user/setup', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: profile.name,
        wake_time: profile.wakeTime,
        sleep_time: profile.sleepTime,
        side_goal: profile.sideGoals?.[0],
        google_calendar_url: profile.calendarUrls?.[0],
        calendar_urls: profile.calendarUrls
      })
    });
    const data = await res.json();
    return {
      success: !!data.success,
      user: data.user ? mapUserProfile(data.user) : undefined,
    };
  },

  async fetchTasks(): Promise<CalendarEvent[]> {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/tasks', { headers });
    const data = await res.json();
    return data.map((t: any) => ({
      ...t,
      start: new Date(t.start),
      end: new Date(t.end),
      sourceUrl: t.sourceUrl,
    }));
  },

  async addTask(event: Omit<CalendarEvent, 'id'>) {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: event.title,
        start: event.start.toISOString(),
        end: event.end.toISOString(),
        type: event.type
      })
    });
    return res.json();
  },

  async upsertTasks(events: CalendarEvent[], sourceUrl?: string) {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/tasks/bulk', {
      method: 'POST',
      headers,
      body: JSON.stringify({ events: events.map(e => ({
        id: e.id,
        title: e.title,
        description: e.description,
        start: e.start.toISOString(),
        end: e.end.toISOString(),
        type: e.type,
        source_url: e.sourceUrl ?? sourceUrl,
        completed: e.completed
      }))})
    });
    return res.json();
  },

  async updateTask(id: string, updates: Partial<CalendarEvent>) {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(updates)
    });
    return res.json();
  },

  async deleteTask(id: string) {
    const headers = await getAuthHeaders();
    await fetch(`/api/tasks/${id}`, {
      method: 'DELETE',
      headers
    });
  },

  async deleteTasksBySource(sourceUrl: string) {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/tasks/source?url=${encodeURIComponent(sourceUrl)}`, {
      method: 'DELETE',
      headers,
    });
    return res.json();
  },

  async saveCalendarImportBreakdown(payload: {
    sourceUrl: string;
    importType?: string;
    events: Array<{
      id: string;
      title: string;
      start: string;
      end: string;
      type: string;
      description?: string;
      sourceUrl?: string;
    }>;
    tasks: Array<{
      task_name: string;
      details: string;
      due_start: string;
      due_end: string;
      category: string;
      priority: string;
      location?: string;
      source_event_id: string;
    }>;
  }) {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/calendar-imports', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.error || 'Failed to save calendar import breakdown');
    }

    return res.json();
  },

  async runWeeklySync(assignments: { title: string, hours: number }[]): Promise<CalendarEvent[]> {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/tasks/weekly-sync', {
      method: 'POST',
      headers,
      body: JSON.stringify({ assignments })
    });
    const data = await res.json();
    return data.map((t: any, idx: number) => ({
        ...t,
        start: new Date(Date.now() + (idx + 1) * 3600000),
        end: new Date(Date.now() + (idx + 2) * 3600000),
    }));
  },

  async fetchGoogleCalendarEventTasks(params: {
    start: string;
    end: string;
    calendarId?: string;
    q?: string;
    maxResults?: number;
  }): Promise<{
    success: boolean;
    calendarId: string;
    range: { start: string; end: string };
    events: Array<{
      id: string;
      title: string;
      description: string;
      startTime: string | null;
      endTime: string | null;
      location: string;
      attendees: Array<{
        email: string;
        displayName: string;
        responseStatus: string;
        optional: boolean;
        organizer: boolean;
        self: boolean;
      }>;
      recurrence: string[];
      reminders: Array<{ method: string; minutes: number | null }>;
      status: string;
      calendarId: string;
      htmlLink: string;
    }>;
    tasks: Array<{
      task_name: string;
      details: string;
      due_start: string | null;
      due_end: string | null;
      category: string;
      priority: string;
      location: string;
      attendees: Array<{
        email: string;
        displayName: string;
        responseStatus: string;
        optional: boolean;
        organizer: boolean;
        self: boolean;
      }>;
      recurrence: string[];
      reminders: Array<{ method: string; minutes: number | null }>;
      source_event_id: string;
      source_html_link: string;
    }>;
  }> {
    const headers = await getAuthHeaders();
    const searchParams = new URLSearchParams({
      start: params.start,
      end: params.end,
    });

    if (params.calendarId) searchParams.set('calendarId', params.calendarId);
    if (params.q) searchParams.set('q', params.q);
    if (typeof params.maxResults === 'number') searchParams.set('maxResults', String(params.maxResults));

    const res = await fetch(`/api/google-calendar/events?${searchParams.toString()}`, {
      headers,
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.error || 'Failed to fetch Google Calendar events');
    }

    return res.json();
  }
};
