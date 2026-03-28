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
  syncCalendarEvents: (newEvents: CalendarEvent[], sourceUrl?: string) => void;
  removeExternalEvents: () => void;
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
        set((state) => ({
          userProfile: { ...state.userProfile, ...profile },
        }));
      },

      addEvent: async (event) => {
        const res = await api.addTask(event);
        if (res.success) {
            const tasks = await api.fetchTasks();
            set({ events: tasks });
        }
      },

      removeEvent: async (id) => {
        await api.deleteTask(id);
        set((state) => ({
          events: state.events.filter((e) => e.id !== id),
        }));
      },

      updateEvent: async (id, updates) => {
        const res = await api.updateTask(id, updates);
        if (res.success) {
           // Reload user for XP/Level updates if task was completed
           if (updates.completed) {
               const user = await api.fetchUser();
               set({ userProfile: user });
           }
           const tasks = await api.fetchTasks();
           set({ events: tasks });
        }
      },

      completeSetup: () => set({ isSetupComplete: true }),

      setMotivation: (level) => set({ lastMotivation: level }),

      syncCalendarEvents: (newEvents, sourceUrl) => {
        set((state) => ({
          events: [...state.events.filter(e => e.type !== 'external'), ...newEvents],
          lastCalendarSync: new Date(),
        }));
      },

      removeExternalEvents: () => {
        set((state) => ({
          events: state.events.filter((e) => e.type !== "external"),
        }));
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
