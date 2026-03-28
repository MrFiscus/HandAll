import { supabase } from "../lib/supabase";
import { CalendarEvent, UserProfile } from "../store/useAppStore";

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
    return {
      level: data.level || 0,
      xp: data.xp || 0,
      wakeTime: data.wake_time || "07:00",
      sleepTime: data.sleep_time || "23:00",
      sideGoals: data.side_goal ? [data.side_goal] : [],
      calendarUrls: data.google_calendar_url ? [data.google_calendar_url] : [],
    };
  },

  async updateUserSetup(profile: Partial<UserProfile>) {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/user/setup', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        wake_time: profile.wakeTime,
        sleep_time: profile.sleepTime,
        side_goal: profile.sideGoals?.[0],
        google_calendar_url: profile.calendarUrls?.[0]
      })
    });
    return res.json();
  },

  async fetchTasks(): Promise<CalendarEvent[]> {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/tasks', { headers });
    const data = await res.json();
    return data.map((t: any) => ({
      ...t,
      start: new Date(t.start),
      end: new Date(t.end),
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

  async upsertTasks(events: CalendarEvent[]) {
    const headers = await getAuthHeaders();
    // We'll create a new endpoint for bulk upsert to be efficient
    const res = await fetch('/api/tasks/bulk', {
      method: 'POST',
      headers,
      body: JSON.stringify({ events: events.map(e => ({
        id: e.id,
        title: e.title,
        start: e.start.toISOString(),
        end: e.end.toISOString(),
        type: e.type,
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
  }
};
