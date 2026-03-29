import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
import { api } from "../utils/api";

export interface CalendarAiMeta {
  classification?: string;
  confidence?: number;
  subtype?: string;
  reason?: string;
  source?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type:
    | "class"
    | "assignment"
    | "working"
    | "goal"
    | "freetime"
    | "external"
    | "fixed"
    | "flexible";
  description?: string;
  sourceUrl?: string;
  completed?: boolean;
  xpValue?: number;
  /** Set after AI classifies imported/connected calendar rows */
  aiMeta?: CalendarAiMeta;
}

/** Persisted AI-generated units consumed by the planner (not calendar times). */
export interface PlanningItemRow {
  id: number;
  item_type: "assignment_subtask" | "goal_task";
  assignment_external_id?: string | null;
  assignment_title?: string | null;
  side_goal?: string | null;
  title: string;
  description?: string | null;
  estimated_minutes: number;
  sort_order: number;
  due_iso?: string | null;
  rationale?: string | null;
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
  motivation?: number;
  googleCalendarConnected: boolean;
  /** Canonical URL: `file://...ics` or `google-oauth:primary` — single active feed for planning/AI */
  activeCalendarSourceUrl?: string;
  activeCalendarResolution?: string;
  setupComplete?: boolean;
  id?: string;
}

export interface AppState {
  userProfile: UserProfile;
  events: CalendarEvent[];
  planningItems: PlanningItemRow[];
  pendingSuggestions: SuggestedTask[];
  isSetupComplete: boolean;
  lastMotivation: number;
  lastCalendarSync: Date | null;
  apiLoaded: boolean;
  isFullScreen: boolean;
  /** XP earned today (resets at midnight) */
  dailyXp: number;
  /** ISO date string "YYYY-MM-DD" for the last day dailyXp was incremented */
  dailyXpDate: string;
  /** Whether the burnout rest prompt is currently waiting to be shown */
  burnoutPromptPending: boolean;
  /** Timestamp — do not re-prompt until after this time (0 = not snoozed) */
  burnoutSnoozedUntil: number;
  resetAppState: () => void;

  loadAppData: () => Promise<void>;
  refreshPlanningItems: () => Promise<void>;
  setUserProfile: (profile: Partial<UserProfile>) => Promise<void>;
  addEvent: (event: Omit<CalendarEvent, "id">) => Promise<void>;
  removeEvent: (id: string) => Promise<void>;
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => Promise<void>;
  completeSetup: () => void;
  setMotivation: (level: number) => Promise<void>;
  syncCalendarEvents: (newEvents: CalendarEvent[], sourceUrl?: string) => Promise<void>;
  removeExternalEvents: (sourceUrl?: string) => Promise<void>;
  setPendingSuggestions: (suggestions: SuggestedTask[]) => void;
  updatePendingSuggestionStatus: (id: string, status: SuggestedTask["status"]) => void;
  updatePendingSuggestion: (id: string, updates: Partial<SuggestedTask>) => void;
  removePendingSuggestion: (id: string) => void;
  clearPendingSuggestions: () => void;
  confirmAllSuggestions: () => Promise<void>;
  refreshSuggestion: (id: string) => Promise<void>;
  setIsFullScreen: (val: boolean) => void;
  dismissBurnoutPrompt: () => void;
  snoozeBurnoutPrompt: () => void;
  rescheduleTodayTasks: (taskIds: string[]) => Promise<void>;
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
        googleCalendarConnected: false,
        setupComplete: false,
      },
      events: [],
      planningItems: [],
      pendingSuggestions: [],
      isSetupComplete: false,
      lastMotivation: 50,
      lastCalendarSync: null,
      apiLoaded: false,
      isFullScreen: false,
      dailyXp: 0,
      dailyXpDate: "",
      burnoutPromptPending: false,
      burnoutSnoozedUntil: 0,
      resetAppState: () =>
        set({
          userProfile: {
            name: "Student",
            level: 0,
            xp: 0,
            wakeTime: "07:00",
            sleepTime: "23:00",
            sideGoals: [],
            calendarUrls: [],
            googleCalendarConnected: false,
            setupComplete: false,
          },
          events: [],
          planningItems: [],
          pendingSuggestions: [],
          isSetupComplete: false,
          lastMotivation: 50,
          lastCalendarSync: null,
          apiLoaded: false,
          isFullScreen: false,
          dailyXp: 0,
          dailyXpDate: "",
          burnoutPromptPending: false,
          burnoutSnoozedUntil: 0,
        }),

      loadAppData: async () => {
        try {
          const [user, tasks, planningItems] = await Promise.all([
            api.fetchUser(),
            api.fetchTasks(),
            api.fetchPlanningItems().catch(() => [] as PlanningItemRow[]),
          ]);
          const motivationFromServer =
            typeof user.motivation === "number" ? user.motivation : get().lastMotivation;
          set({
            userProfile: user,
            events: tasks.map(normalizeCalendarEvent),
            planningItems,
            lastMotivation: motivationFromServer,
            isSetupComplete: !!user.setupComplete,
            apiLoaded: true,
          });
        } catch (e) {
          console.error("Failed to load app data", e);
        }
      },

      refreshPlanningItems: async () => {
        try {
          const planningItems = await api.fetchPlanningItems();
          set({ planningItems });
        } catch (e) {
          console.error("refreshPlanningItems", e);
        }
      },

      setUserProfile: async (profile) => {
        const current = get().userProfile;
        const prevGoals = JSON.stringify(current.sideGoals);
        const maybeClearGeneratedIfFullyDetached = async (mergedProfile: UserProfile) => {
          if (
            mergedProfile.sideGoals.length === 0 &&
            mergedProfile.calendarUrls.length === 0
          ) {
            await api.clearGeneratedSchedule();
            const [tasks, planningItems] = await Promise.all([
              api.fetchTasks(),
              api.fetchPlanningItems().catch(() => [] as PlanningItemRow[]),
            ]);
            set({
              events: tasks.map(normalizeCalendarEvent),
              planningItems,
            });
          }
        };
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
          const merged = get().userProfile;
          await api.pushAgentProfile({
            name: merged.name,
            wakeTime: merged.wakeTime,
            sleepTime: merged.sleepTime,
            sideGoals: merged.sideGoals,
            calendarUrls: merged.calendarUrls,
            motivation: merged.motivation ?? get().lastMotivation,
          });
          const nextGoals = JSON.stringify(merged.sideGoals);
          if (nextGoals !== prevGoals) {
            void api
              .regenerateGoalTasks()
              .then(() => get().refreshPlanningItems())
              .catch(() => {});
          }
          await maybeClearGeneratedIfFullyDetached(merged);
          return;
        }

        const user = await api.fetchUser();
        set({ userProfile: user });
        const merged = get().userProfile;
        await api.pushAgentProfile({
          name: merged.name,
          wakeTime: merged.wakeTime,
          sleepTime: merged.sleepTime,
          sideGoals: merged.sideGoals,
          calendarUrls: merged.calendarUrls,
          motivation: merged.motivation ?? get().lastMotivation,
        });
        const nextGoals = JSON.stringify(merged.sideGoals);
        if (nextGoals !== prevGoals) {
          void api
            .regenerateGoalTasks()
            .then(() => get().refreshPlanningItems())
            .catch(() => {});
        }
        await maybeClearGeneratedIfFullyDetached(merged);
      },

      addEvent: async (event) => {
        try {
          const created = await api.addTask(event);
          const tasks = await api.fetchTasks();
          set({ events: tasks.map(normalizeCalendarEvent) });
          if (event.type === "assignment") {
            const taskKey =
              created?.id != null
                ? String(created.id)
                : created?.external_id != null
                  ? String(created.external_id)
                  : null;
            if (taskKey) {
              void api
                .requestAssignmentBreakdown(taskKey)
                .then(() => get().refreshPlanningItems())
                .catch((e) => console.warn("Assignment AI breakdown:", e));
            }
          }
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
        const { events, userProfile, setUserProfile } = get();
        const event = events.find((e) => e.id === id);

        const res = await api.updateTask(id, updates);
        if (res.success) {
          // If task is being marked as completed and it wasn't before
          if (updates.completed === true && event && !event.completed) {
            const xpGain = event.xpValue || 10;
            const newXp = userProfile.xp + xpGain;
            const newLevel = Math.floor(newXp / 100);

            await setUserProfile({
              xp: newXp,
              level: newLevel,
            });

            toast.success(`Task completed! +${xpGain} XP`);

            // --- Burnout Calculator ---
            const today = new Date().toISOString().slice(0, 10);
            const state = get();
            const currentDailyXp = state.dailyXpDate === today ? state.dailyXp : 0;
            const newDailyXp = currentDailyXp + xpGain;
            // Threshold scales with motivation: low energy → trigger sooner
            const burnoutThreshold = 30 + state.lastMotivation * 0.4;
            const shouldPrompt =
              newDailyXp >= burnoutThreshold &&
              Date.now() > state.burnoutSnoozedUntil &&
              !state.burnoutPromptPending;
            set({
              dailyXp: newDailyXp,
              dailyXpDate: today,
              ...(shouldPrompt ? { burnoutPromptPending: true } : {}),
            });
          }

          const [user, tasks] = await Promise.all([api.fetchUser(), api.fetchTasks()]);
          set({ userProfile: user, events: tasks.map(normalizeCalendarEvent) });
        }
      },

      completeSetup: () =>
        set((state) => ({
          isSetupComplete: true,
          userProfile: {
            ...state.userProfile,
            setupComplete: true,
          },
        })),

      setMotivation: async (level) => {
        const m = Math.max(0, Math.min(100, Math.round(level)));
        set({ lastMotivation: m });
        try {
          await api.patchMotivation(m);
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const result = await api.rebalanceSchedule({
            motivation: m,
            horizonDays: 7,
            timezone: tz,
          });
          if (result.success) {
            set({
              events: result.tasks.map(normalizeCalendarEvent),
              userProfile: {
                ...get().userProfile,
                motivation: result.motivation ?? m,
              },
            });
          } else if ("soft" in result && result.soft && result.user) {
            set({ userProfile: result.user });
          }
        } catch (e) {
          console.error("setMotivation / rebalance:", e);
        }
        try {
          const p = get().userProfile;
          await api.pushAgentProfile({
            name: p.name,
            wakeTime: p.wakeTime,
            sleepTime: p.sleepTime,
            sideGoals: p.sideGoals,
            calendarUrls: p.calendarUrls,
            motivation: m,
          });
        } catch {
          /* optional */
        }
      },

      syncCalendarEvents: async (newEvents, sourceUrl) => {
        try {
          const bulk = await api.upsertTasks(newEvents, sourceUrl);
          const [tasks, planningItems] = await Promise.all([
            api.fetchTasks(),
            api.fetchPlanningItems().catch(() => [] as PlanningItemRow[]),
          ]);
          const motivation =
            bulk.rebalance && typeof bulk.rebalance.motivation === "number"
              ? bulk.rebalance.motivation
              : undefined;
          set({
            events: tasks.map(normalizeCalendarEvent),
            planningItems,
            lastCalendarSync: new Date(),
            ...(motivation !== undefined
              ? {
                  userProfile: { ...get().userProfile, motivation },
                  lastMotivation: motivation,
                }
              : {}),
          });
          if (bulk.breakdown?.error) {
            console.warn("Calendar import: assignment breakdown issue:", bulk.breakdown.error);
          }
          if (bulk.classification?.error) {
            console.warn("Calendar import: AI classification issue:", bulk.classification.error);
          }
          if (bulk.rebalance && bulk.rebalance.success === false) {
            console.warn(
              "Calendar import: schedule rebalance skipped or failed:",
              bulk.rebalance.error,
            );
          }
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

      updatePendingSuggestion: (id, updates) =>
        set((state) => ({
          pendingSuggestions: state.pendingSuggestions.map((suggestion) =>
            suggestion.id === id ? { ...suggestion, ...updates } : suggestion,
          ),
        })),

      removePendingSuggestion: (id) =>
        set((state) => ({
          pendingSuggestions: state.pendingSuggestions.filter((suggestion) => suggestion.id !== id),
        })),

      clearPendingSuggestions: () => set({ pendingSuggestions: [] }),

      confirmAllSuggestions: async () => {
        const { pendingSuggestions, addEvent } = get();
        const acceptedTasks = pendingSuggestions.filter((t) => t.status === "accepted");
        
        for (const task of acceptedTasks) {
          await addEvent({
            title: task.title,
            start: task.start,
            end: task.end,
            type: task.type,
            description: task.description,
            xpValue: task.xpValue,
          });
        }
        
        set({ pendingSuggestions: [] });
      },

      refreshSuggestion: async (id) => {
        // For now, refreshing just removes the current one and triggers a rebalance
        // or we could just simulate a refresh by showing a toast
        const { removePendingSuggestion, lastMotivation, setMotivation } = get();
        removePendingSuggestion(id);
        // Triggering rebalance by re-setting motivation
        await setMotivation(lastMotivation);
      },

      setIsFullScreen: (val) => set({ isFullScreen: val }),

      dismissBurnoutPrompt: () => set({ burnoutPromptPending: false }),

      snoozeBurnoutPrompt: () =>
        set({
          burnoutPromptPending: false,
          burnoutSnoozedUntil: Date.now() + 60 * 60 * 1000,
        }),

      rescheduleTodayTasks: async (taskIds) => {
        const { events } = get();
        const MS_PER_DAY = 24 * 60 * 60 * 1000;
        for (const id of taskIds) {
          const event = events.find((e) => e.id === id);
          if (!event) continue;
          await api.updateTask(id, {
            start: new Date(event.start.getTime() + MS_PER_DAY),
            end: new Date(event.end.getTime() + MS_PER_DAY),
          });
        }
        const tasks = await api.fetchTasks();
        set({ events: tasks.map(normalizeCalendarEvent) });
      },

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
        state.planningItems = [];
        state.lastCalendarSync = state.lastCalendarSync
          ? ensureDate(state.lastCalendarSync as unknown as string | Date)
          : null;
      },
    },
  ),
);
