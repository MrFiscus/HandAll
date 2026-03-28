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
  completed?: boolean;
  xpValue?: number;
}

export interface UserProfile {
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
  isSetupComplete: boolean;
  lastMotivation: number;
  lastCalendarSync: Date | null;
  apiLoaded: boolean;

  // Actions
  loadAppData: () => Promise<void>;
  setUserProfile: (profile: Partial<UserProfile>) => Promise<void>;
  addEvent: (event: Omit<CalendarEvent, 'id'>) => Promise<void>;
  removeEvent: (id: string) => Promise<void>;
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => Promise<void>;
  completeSetup: () => void;
  setMotivation: (level: number) => void;
  syncCalendarEvents: (newEvents: CalendarEvent[], sourceUrl?: string) => Promise<void>;
  removeExternalEvents: () => Promise<void>;
  runWeeklySync: (assignments: { title: string, hours: number }[]) => Promise<CalendarEvent[]>;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      userProfile: {
        level: 0,
        xp: 0,
        wakeTime: "07:00",
        sleepTime: "23:00",
        sideGoals: [],
        calendarUrls: [],
      },
      events: [],
      isSetupComplete: false,
      lastMotivation: 50,
      lastCalendarSync: null,
      apiLoaded: false,

      loadAppData: async () => {
        try {
          const user = await api.fetchUser();
          const tasks = await api.fetchTasks();
          set({ userProfile: user, events: tasks, apiLoaded: true });
        } catch (e) {
          console.error("Failed to load app data", e);
        }
      },

      setUserProfile: async (profile) => {
        await api.updateUserSetup(profile);
        const user = await api.fetchUser();
        set({ userProfile: user });
      },

      addEvent: async (event) => {
        try {
          const res = await api.addTask(event);
          if (res.success) {
              const tasks = await api.fetchTasks();
              set({ events: tasks });
          } else {
              throw new Error(res.error || "Failed to add task");
          }
        } catch (err) {
          console.error("Add event error:", err);
          throw err;
        }
      },

      removeEvent: async (id) => {
        await api.deleteTask(id);
        const tasks = await api.fetchTasks();
        set({ events: tasks });
      },

      updateEvent: async (id, updates) => {
        const res = await api.updateTask(id, updates);
        if (res.success) {
           const [user, tasks] = await Promise.all([api.fetchUser(), api.fetchTasks()]);
           set({ userProfile: user, events: tasks });
        }
      },

      completeSetup: () => set({ isSetupComplete: true }),

      setMotivation: (level) => set({ lastMotivation: level }),

      syncCalendarEvents: async (newEvents, sourceUrl) => {
        try {
          await api.upsertTasks(newEvents);
          const tasks = await api.fetchTasks();
          set({ 
            events: tasks,
            lastCalendarSync: new Date()
          });
        } catch (err) {
          console.error("Sync calendar error:", err);
          throw err;
        }
      },

      removeExternalEvents: async () => {
        const state = get();
        const externalEvents = state.events.filter(e => e.type === 'external');
        // Delete each external event
        await Promise.all(externalEvents.map(e => api.deleteTask(e.id)));
        const tasks = await api.fetchTasks();
        set({ events: tasks });
      },

      runWeeklySync: async (assignments) => {
        return await api.runWeeklySync(assignments);
      }
    }),
    {
      name: "handall-storage",
    }
  )
);
