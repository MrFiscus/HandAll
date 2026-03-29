import { supabase } from "../lib/supabase";
import { CalendarEvent, PlanningItemRow, UserProfile } from "../store/useAppStore";

const AGENT_API_BASE_URL =
  import.meta.env.VITE_AGENT_API_URL?.replace(/\/$/, "") ?? "/agent-api";

function toIsoString(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function mapUserProfile(data: any): UserProfile {
  let sideGoals: string[] = [];
  if (Array.isArray(data.side_goals)) {
    sideGoals = data.side_goals
      .filter((g: unknown) => typeof g === "string" && (g as string).trim())
      .map((g: string) => g.trim());
  } else if (typeof data.side_goal === "string" && data.side_goal.trim()) {
    sideGoals = [data.side_goal.trim()];
  }
  let motivation: number | undefined;
  if (data.motivation !== undefined && data.motivation !== null) {
    const n = Number(data.motivation);
    if (Number.isFinite(n)) motivation = Math.max(0, Math.min(100, Math.round(n)));
  }
  return {
    name: data.username || "Student",
    level: data.level || 0,
    xp: data.xp || 0,
    wakeTime: data.wake_time || "07:00",
    sleepTime: data.sleep_time || "23:00",
    sideGoals,
    calendarUrls: Array.isArray(data.calendar_urls)
      ? data.calendar_urls
      : (data.google_calendar_url ? [data.google_calendar_url] : []),
    motivation,
    googleCalendarConnected: !!data.google_calendar_connected,
  };
}

function inferGoogleEventType(title: string, description: string): CalendarEvent["type"] {
  const combined = `${title} ${description}`.toLowerCase();

  if (/(class|lecture|lab|office hours|quiz|exam|midterm|club meeting)/.test(combined)) {
    return "class";
  }

  if (/(assignment|homework|project|discussion post|report due|submission|due)/.test(combined)) {
    return "assignment";
  }

  return "external";
}

async function getAuthHeaders() {
  if (!supabase) return { 'Content-Type': 'application/json' };

  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  return headers;
}

export interface NearbyGoalEventResult {
  title: string;
  description: string;
  url: string;
  kind: "fun" | "goal";
  goal: string | null;
}

export interface NearbyGoalEventGroup {
  goal: string;
  query: string;
  results: NearbyGoalEventResult[];
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
    if (!headers.Authorization) {
      throw new Error(
        supabase
          ? 'Not signed in. Please log in again before completing setup.'
          : 'Supabase is not configured.',
      );
    }
    const res = await fetch('/api/user/setup', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: profile.name,
        wake_time: profile.wakeTime,
        sleep_time: profile.sleepTime,
        side_goal: profile.sideGoals?.[0],
        side_goals: profile.sideGoals,
        motivation: profile.motivation,
        google_calendar_url: profile.calendarUrls?.[0],
        calendar_urls: profile.calendarUrls,
      }),
    });
    const data = (await res.json().catch(() => null)) ?? {};
    if (!res.ok) {
      const msg =
        typeof data.error === 'string' ? data.error : `Failed to save profile (${res.status})`;
      throw new Error(msg);
    }
    return {
      success: !!data.success,
      user: data.user ? mapUserProfile(data.user) : undefined,
    };
  },

  async patchMotivation(level: number) {
    const headers = await getAuthHeaders();
    if (!headers.Authorization) {
      throw new Error(supabase ? "Not signed in." : "Supabase is not configured.");
    }
    const res = await fetch("/api/user/motivation", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ motivation: level }),
    });
    const data = (await res.json().catch(() => null)) ?? {};
    if (!res.ok) {
      throw new Error(
        typeof data.error === "string" ? data.error : "Failed to save motivation",
      );
    }
    return data as { success: boolean; user?: any };
  },

  async rebalanceSchedule(opts?: {
    motivation?: number;
    horizonDays?: number;
    timezone?: string;
  }) {
    const headers = await getAuthHeaders();
    if (!headers.Authorization) {
      throw new Error(supabase ? "Not signed in." : "Supabase is not configured.");
    }
    const res = await fetch("/api/schedule/rebalance", {
      method: "POST",
      headers,
      body: JSON.stringify({
        motivation: opts?.motivation,
        horizon_days: opts?.horizonDays,
        timezone:
          opts?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
      }),
    });
    const data = (await res.json().catch(() => null)) ?? {};
    if (res.ok && data.success) {
      return {
        success: true as const,
        motivation: data.motivation as number,
        tasks: (data.tasks || []) as any[],
        meta: data.meta,
      };
    }
    if (res.status === 503) {
      return {
        success: false as const,
        soft: true as const,
        error: typeof data.error === "string" ? data.error : "Planner unavailable",
        user: data.user ? mapUserProfile(data.user) : undefined,
      };
    }
    throw new Error(
      typeof data.error === "string" ? data.error : "Schedule rebalance failed",
    );
  },

  async clearGeneratedSchedule(): Promise<{
    success: boolean;
    deletedTasks: number;
    deletedPlanningItems: number;
  }> {
    const headers = await getAuthHeaders();
    if (!headers.Authorization) {
      throw new Error(supabase ? "Not signed in." : "Supabase is not configured.");
    }
    const res = await fetch("/api/schedule/clear-generated", {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    const data = (await res.json().catch(() => null)) ?? {};
    if (!res.ok) {
      throw new Error(
        typeof data.error === "string" ? data.error : "Failed to clear generated schedule",
      );
    }
    return data;
  },

  async pushAgentProfile(profile: {
    name: string;
    wakeTime: string;
    sleepTime: string;
    sideGoals: string[];
    calendarUrls: string[];
    motivation: number;
  }) {
    if (!supabase) return;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) return;
      await fetch(`${AGENT_API_BASE_URL}/profile/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: session.user.id,
          name: profile.name || "Student",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          prefs: {
            wakeTime: profile.wakeTime,
            sleepTime: profile.sleepTime,
            sideGoals: profile.sideGoals,
            side_goals: profile.sideGoals,
            calendarUrls: profile.calendarUrls,
            motivation: profile.motivation,
          },
        }),
      });
    } catch {
      /* Python agent optional */
    }
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
    if (!headers.Authorization) {
      throw new Error(
        supabase
          ? 'Not signed in. Please log in again.'
          : 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
      );
    }
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: event.title,
        description: event.description,
        start: toIsoString(event.start) ?? new Date().toISOString(),
        end: toIsoString(event.end) ?? new Date().toISOString(),
        type: event.type
      })
    });
    const data = (await res.json().catch(() => null)) ?? {};
    if (!res.ok) {
      const msg =
        typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`;
      throw new Error(msg);
    }
    if (data && data.success === false) {
      throw new Error(
        typeof data.error === 'string' ? data.error : 'Failed to add task',
      );
    }
    return data as { success: boolean; id?: number; external_id?: string };
  },

  async fetchPlanningItems(): Promise<PlanningItemRow[]> {
    const headers = await getAuthHeaders();
    if (!headers.Authorization) return [];
    const res = await fetch("/api/planning-items", { headers });
    const data = (await res.json().catch(() => null)) ?? {};
    if (!res.ok) return [];
    return Array.isArray(data.items) ? data.items : [];
  },

  async requestAssignmentBreakdown(taskId: string): Promise<{
    success: boolean;
    assignment_external_id?: string;
    subtasks?: unknown[];
  }> {
    const headers = await getAuthHeaders();
    if (!headers.Authorization) {
      throw new Error(supabase ? "Not signed in." : "Supabase is not configured.");
    }
    const res = await fetch("/api/ai/assignment-breakdown", {
      method: "POST",
      headers,
      body: JSON.stringify({ taskId }),
    });
    const data = (await res.json().catch(() => null)) ?? {};
    if (!res.ok) {
      throw new Error(typeof data.error === "string" ? data.error : "Breakdown failed");
    }
    return data;
  },

  async regenerateGoalTasks(): Promise<{ success: boolean; tasks?: unknown[] }> {
    const headers = await getAuthHeaders();
    if (!headers.Authorization) {
      throw new Error(supabase ? "Not signed in." : "Supabase is not configured.");
    }
    const res = await fetch("/api/ai/goal-tasks/regenerate", {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    const data = (await res.json().catch(() => null)) ?? {};
    if (!res.ok) {
      throw new Error(typeof data.error === "string" ? data.error : "Goal task regeneration failed");
    }
    return data;
  },

  async upsertTasks(events: CalendarEvent[], sourceUrl?: string): Promise<{
    success: boolean;
    error?: string;
    classification?: {
      updated?: number;
      cache_hits?: number;
      llm_batches?: number;
      error?: string | null;
      samples?: unknown[];
    };
    goals?: { skipped?: boolean; reason?: string; cache?: boolean; count?: number; error?: string };
    breakdown?: {
      assignment_count: number;
      assignment_keys: string[];
      subtasks_inserted: number;
      batches: number;
      cache_hits?: number;
      error: string | null;
    };
    rebalance?: {
      success?: boolean;
      soft?: boolean;
      motivation?: number;
      tasks?: Array<Record<string, unknown>>;
      error?: string;
      detail?: string;
    } | null;
  }> {
    const headers = await getAuthHeaders();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const res = await fetch('/api/tasks/bulk', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        timezone,
        events: events.map((e) => ({
          id: e.id,
          title: e.title,
          description: e.description,
          start: toIsoString(e.start) ?? new Date().toISOString(),
          end: toIsoString(e.end) ?? new Date().toISOString(),
          type: e.type,
          source_url: e.sourceUrl ?? sourceUrl,
          completed: e.completed,
        })),
      }),
    });
    const data = (await res.json().catch(() => null)) ?? {};
    if (!res.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : 'Bulk sync failed');
    }
    return data as {
      success: boolean;
      breakdown?: {
        assignment_count: number;
        assignment_keys: string[];
        subtasks_inserted: number;
        batches: number;
        error: string | null;
      };
      rebalance?: {
        success?: boolean;
        soft?: boolean;
        motivation?: number;
        tasks?: Array<Record<string, unknown>>;
        error?: string;
        detail?: string;
      } | null;
    };
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

  async deleteAllEvents(): Promise<{
    success: boolean;
    deletedTasks: number;
    deletedPlanningItems: number;
  }> {
    const headers = await getAuthHeaders();
    if (!headers.Authorization) {
      throw new Error(supabase ? "Not signed in." : "Supabase is not configured.");
    }
    const res = await fetch('/api/tasks', {
      method: 'DELETE',
      headers,
    });
    const data = (await res.json().catch(() => null)) ?? {};
    if (!res.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : 'Failed to remove all events');
    }
    return data;
  },

  async reverseGeocode(lat: number, lon: number): Promise<{
    success: boolean;
    location: string;
    displayName?: string;
  }> {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/location/reverse-geocode', {
      method: 'POST',
      headers,
      body: JSON.stringify({ lat, lon }),
    });
    const data = (await res.json().catch(() => null)) ?? {};
    if (!res.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : 'Failed to resolve your location');
    }
    return data;
  },

  async fetchNearbyGoalEvents(params: {
    location: string;
    country?: string;
  }): Promise<{
    success: boolean;
    location: string;
    country: string;
    goals: string[];
    funQuery: string;
    funEvents: NearbyGoalEventResult[];
    goalEventGroups: NearbyGoalEventGroup[];
  }> {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/goals/nearby-events', {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
    const data = (await res.json().catch(() => null)) ?? {};
    if (!res.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : 'Failed to search nearby events');
    }
    return data;
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

  async runWeeklySync(payload: {
    userId: string;
    name: string;
    timezone: string;
    wakeTime: string;
    sleepTime: string;
    sideGoals: string[];
    motivation: number;
    horizonDays?: number;
    events: CalendarEvent[];
    assignments: Array<{
      id?: string;
      title: string;
      description?: string;
      dueDate?: Date;
      estimatedHours?: number;
    }>;
  }): Promise<{
    success: boolean;
    assignments: Array<{
      id: string;
      title: string;
      description: string;
      due_date: string;
      estimated_hours: number;
      estimate_reason: string;
    }>;
    suggested_tasks: Array<{
      id: string;
      title: string;
      description: string;
      start: string;
      end: string;
      type: "working" | "goal" | "freetime";
      xpValue: number;
    }>;
    meta: Record<string, any>;
    error?: string;
  }> {
    const authHeaders = await getAuthHeaders();
    let assignment_work_units: object[] = [];
    let goal_work_units: object[] = [];
    if (authHeaders.Authorization) {
      const piRes = await fetch("/api/planning-items", { headers: authHeaders });
      const piData = (await piRes.json().catch(() => null)) ?? {};
      const items: PlanningItemRow[] = Array.isArray(piData.items) ? piData.items : [];
      assignment_work_units = items
        .filter((i) => i.item_type === "assignment_subtask")
        .map((i) => ({
          id: String(i.id),
          assignment_id: i.assignment_external_id || "",
          assignment_title: i.assignment_title || "",
          title: i.title,
          description: i.description || "",
          estimated_minutes: i.estimated_minutes,
          sort_order: i.sort_order,
          due_iso: i.due_iso,
        }));
      goal_work_units = items
        .filter((i) => i.item_type === "goal_task")
        .map((i) => ({
          id: String(i.id),
          title: i.title,
          description: i.description || "",
          estimated_minutes: i.estimated_minutes,
          side_goal: i.side_goal || "",
          sort_order: i.sort_order,
        }));
    }

    const res = await fetch(`${AGENT_API_BASE_URL}/plan-week`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: payload.userId,
        name: payload.name,
        timezone: payload.timezone,
        wake_time: payload.wakeTime,
        sleep_time: payload.sleepTime,
        side_goals: payload.sideGoals,
        motivation: payload.motivation,
        horizon_days: payload.horizonDays ?? 7,
        events: payload.events.map((event) => ({
          id: event.id,
          title: event.title,
          start: toIsoString(event.start) ?? new Date().toISOString(),
          end: toIsoString(event.end) ?? new Date().toISOString(),
          type: event.type,
          description: event.description ?? "",
          completed: !!event.completed,
          sourceUrl: event.sourceUrl,
        })),
        assignments: payload.assignments.map((assignment, index) => ({
          id: assignment.id ?? `assignment-${index + 1}`,
          title: assignment.title,
          description: assignment.description ?? "",
          due_date: toIsoString(assignment.dueDate),
          estimated_hours: assignment.estimatedHours,
        })),
        assignment_work_units,
        goal_work_units,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data?.error || 'Failed to generate weekly sync suggestions');
    }

    return data;
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
  },

  async fetchGoogleCalendarEventTasksFromProviderToken(params: {
    providerToken: string;
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
    const res = await fetch('/api/google-calendar/oauth-events', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        providerToken: params.providerToken,
        start: params.start,
        end: params.end,
        calendarId: params.calendarId,
        q: params.q,
        maxResults: params.maxResults,
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.error || 'Failed to fetch Google Calendar events from Google login');
    }

    return res.json();
  },

  async fetchGoogleCalendarConnection(): Promise<{
    success: boolean;
    connected: boolean;
    calendarId: string;
  }> {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/google-calendar/connection', { headers });
    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.error || 'Failed to fetch Google Calendar connection status');
    }
    return res.json();
  },

  async connectGoogleCalendar(params: {
    providerToken: string;
    providerRefreshToken?: string;
    providerTokenExpiry?: string;
    calendarId?: string;
    start?: string;
    end?: string;
    maxResults?: number;
  }) {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/google-calendar/connect', {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.error || 'Failed to connect Google Calendar');
    }

    return res.json();
  },

  async syncConnectedGoogleCalendar(params?: {
    start?: string;
    end?: string;
    maxResults?: number;
  }) {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/google-calendar/sync-connected', {
      method: 'POST',
      headers,
      body: JSON.stringify(params || {}),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.error || 'Failed to sync connected Google Calendar');
    }

    return res.json();
  },

  async disconnectGoogleCalendar() {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/google-calendar/connection', {
      method: 'DELETE',
      headers,
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      throw new Error(errorData?.error || 'Failed to disconnect Google Calendar');
    }

    return res.json();
  },

  mapGoogleEventsToCalendarEvents(
    events: Array<{
      id: string;
      title: string;
      description: string;
      startTime: string | null;
      endTime: string | null;
      calendarId?: string;
      htmlLink?: string;
    }>,
    sourceUrl: string,
  ): CalendarEvent[] {
    return events
      .filter((event) => event.startTime && event.endTime)
      .map((event) => ({
        id: event.id,
        title: event.title,
        description: event.description || undefined,
        start: new Date(event.startTime as string),
        end: new Date(event.endTime as string),
        type: inferGoogleEventType(event.title, event.description || ""),
        sourceUrl,
      }))
      .filter((event) => !Number.isNaN(event.start.getTime()) && !Number.isNaN(event.end.getTime()));
  }
};
