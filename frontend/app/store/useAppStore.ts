import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "../utils/api";

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type: "class" | "assignment" | "working" | "goal" | "freetime" | "external";
  description?: string;
  sourceUrl?: string;
  completed?: boolean;
  xpValue?: number;
}

export interface SuggestedTask extends CalendarEvent {
  status: "pending" | "accepted" | "rejected";
}

function ensureDate(value: Date | string | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value ?? new Date().toISOString());
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizeCalendarEvent<T extends CalendarEvent>(event: T): T {
  return {
    ...event,
    start: ensureDate(event.start),
    end: ensureDate(event.end),
  };
}

function normalizeSuggestedTask(task: SuggestedTask): SuggestedTask {
  return normalizeCalendarEvent(task);
}

export interface UserProfile {
  name: string;
  level: number;
  xp: number;
  wakeTime: string;
  sleepTime: string;
  sideGoals: string[];
  calendarUrls: string[];
}

export interface AppState {
  userProfile: UserProfile;
  events: CalendarEvent[];
  pendingSuggestions: SuggestedTask[];
  isSetupComplete: boolean;
  lastMotivation: number;
  lastCalendarSync: Date | null;
  apiLoaded: boolean;

  loadAppData: () => Promise<void>;
  setUserProfile: (profile: Partial<UserProfile>) => Promise<void>;
  addEvent: (event: Omit<CalendarEvent, "id">) => Promise<void>;
  removeEvent: (id: string) => Promise<void>;
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => Promise<void>;
  completeSetup: () => void;
  setMotivation: (level: number) => void;
  syncCalendarEvents: (newEvents: CalendarEvent[], sourceUrl?: string) => Promise<void>;
  removeExternalEvents: (sourceUrl?: string) => Promise<void>;
  setPendingSuggestions: (suggestions: SuggestedTask[]) => void;
  updatePendingSuggestionStatus: (id: string, status: SuggestedTask["status"]) => void;
  removePendingSuggestion: (id: string) => void;
  clearPendingSuggestions: () => void;
  runWeeklySync: (payload: {
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
  }) => Promise<{
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
  }>;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      userProfile: {
        name: "Student",
        level: 0,
        xp: 0,
        wakeTime: "07:00",
        sleepTime: "23:00",
        sideGoals: [],
        calendarUrls: [],
      },
      events: [],
      pendingSuggestions: [],
      isSetupComplete: false,
      lastMotivation: 50,
      lastCalendarSync: null,
      apiLoaded: false,

      loadAppData: async () => {
        try {
          const user = await api.fetchUser();
          const tasks = await api.fetchTasks();
          set({ userProfile: user, events: tasks.map(normalizeCalendarEvent), apiLoaded: true });
        } catch (e) {
          console.error("Failed to load app data", e);
        }
      },

      setUserProfile: async (profile) => {
        const current = get().userProfile;
        set({
          userProfile: {
            ...current,
            ...profile,
            name: profile.name ?? current.name,
            wakeTime: profile.wakeTime ?? current.wakeTime,
            sleepTime: profile.sleepTime ?? current.sleepTime,
            sideGoals: profile.sideGoals ?? current.sideGoals,
            calendarUrls: profile.calendarUrls ?? current.calendarUrls,
          },
        });

        const result = await api.updateUserSetup(profile);
        if (result.user) {
          set({ userProfile: result.user });
          return;
        }

        const user = await api.fetchUser();
        set({ userProfile: user });
      },

      addEvent: async (event) => {
        try {
          await api.addTask(event);
          const tasks = await api.fetchTasks();
          set({ events: tasks.map(normalizeCalendarEvent) });
        } catch (err) {
          console.error("Add event error:", err);
          throw err;
        }
      },

      removeEvent: async (id) => {
        await api.deleteTask(id);
        const tasks = await api.fetchTasks();
        set({ events: tasks.map(normalizeCalendarEvent) });
      },

      updateEvent: async (id, updates) => {
        const res = await api.updateTask(id, updates);
        if (res.success) {
          const [user, tasks] = await Promise.all([api.fetchUser(), api.fetchTasks()]);
          set({ userProfile: user, events: tasks.map(normalizeCalendarEvent) });
        }
      },

      completeSetup: () => set({ isSetupComplete: true }),

      setMotivation: (level) => set({ lastMotivation: level }),

      syncCalendarEvents: async (newEvents, sourceUrl) => {
        try {
          await api.upsertTasks(newEvents, sourceUrl);
          const tasks = await api.fetchTasks();
          set({
            events: tasks.map(normalizeCalendarEvent),
            lastCalendarSync: new Date(),
          });
        } catch (err) {
          console.error("Sync calendar error:", err);
          throw err;
        }
      },

      removeExternalEvents: async (sourceUrl) => {
        const state = get();

        if (sourceUrl) {
          await api.deleteTasksBySource(sourceUrl);
        } else {
          const externalEvents = state.events.filter((e) => e.type === "external");
          await Promise.all(externalEvents.map((e) => api.deleteTask(e.id)));
        }

        const tasks = await api.fetchTasks();
        set({ events: tasks.map(normalizeCalendarEvent) });
      },

      setPendingSuggestions: (suggestions) =>
        set({ pendingSuggestions: suggestions.map(normalizeSuggestedTask) }),

      updatePendingSuggestionStatus: (id, status) =>
        set((state) => ({
          pendingSuggestions: state.pendingSuggestions.map((suggestion) =>
            suggestion.id === id ? { ...suggestion, status } : suggestion,
          ),
        })),

      removePendingSuggestion: (id) =>
        set((state) => ({
          pendingSuggestions: state.pendingSuggestions.filter((suggestion) => suggestion.id !== id),
        })),

      clearPendingSuggestions: () => set({ pendingSuggestions: [] }),

      runWeeklySync: async (payload) => {
        return await api.runWeeklySync(payload);
      },
    }),
    {
      name: "handall-storage",
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        state.events = (state.events || []).map(normalizeCalendarEvent);
        state.pendingSuggestions = (state.pendingSuggestions || []).map(normalizeSuggestedTask);
        state.lastCalendarSync = state.lastCalendarSync
          ? ensureDate(state.lastCalendarSync as unknown as string | Date)
          : null;
      },
    },
  ),
);
