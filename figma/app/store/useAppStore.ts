import { create } from "zustand";
import { persist } from "zustand/middleware";

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
  
  // Actions
  setUserProfile: (profile: Partial<UserProfile>) => void;
  addEvent: (event: CalendarEvent) => void;
  removeEvent: (id: string) => void;
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => void;
  completeSetup: () => void;
  setMotivation: (level: number) => void;
  addXP: (amount: number) => void;
  syncCalendarEvents: (newEvents: CalendarEvent[]) => void;
  removeExternalEvents: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
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

      setUserProfile: (profile) =>
        set((state) => ({
          userProfile: { ...state.userProfile, ...profile },
        })),

      addEvent: (event) =>
        set((state) => ({
          events: [...state.events, event],
        })),

      removeEvent: (id) =>
        set((state) => ({
          events: state.events.filter((e) => e.id !== id),
        })),

      updateEvent: (id, updates) =>
        set((state) => ({
          events: state.events.map((e) =>
            e.id === id ? { ...e, ...updates } : e
          ),
        })),

      completeSetup: () => set({ isSetupComplete: true }),

      setMotivation: (level) => set({ lastMotivation: level }),

      addXP: (amount) =>
        set((state) => {
          const newXP = state.userProfile.xp + amount;
          const newLevel = Math.floor(newXP / 100);
          return {
            userProfile: {
              ...state.userProfile,
              xp: newXP,
              level: newLevel,
            },
          };
        }),

      syncCalendarEvents: (newEvents) =>
        set((state) => ({
          events: [...state.events, ...newEvents],
          lastCalendarSync: new Date(),
        })),

      removeExternalEvents: () =>
        set((state) => ({
          events: state.events.filter((e) => e.type !== "external"),
        })),
    }),
    {
      name: "handall-storage",
    }
  )
);