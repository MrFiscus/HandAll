import type { CalendarEvent } from "../store/useAppStore";

const CALENDAR_IMPORT_PREVIEW_KEY = "handall-calendar-import-preview";

type SerializedCalendarEvent = Omit<CalendarEvent, "start" | "end"> & {
  start: string;
  end: string;
};

export interface CalendarImportPreviewState {
  source: string;
  returnPath: string;
  events: CalendarEvent[];
}

function serializeEvent(event: CalendarEvent): SerializedCalendarEvent {
  return {
    ...event,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
  };
}

function deserializeEvent(event: SerializedCalendarEvent): CalendarEvent {
  return {
    ...event,
    start: new Date(event.start),
    end: new Date(event.end),
  };
}

export function saveCalendarImportPreviewState(
  state: CalendarImportPreviewState,
) {
  sessionStorage.setItem(
    CALENDAR_IMPORT_PREVIEW_KEY,
    JSON.stringify({
      source: state.source,
      returnPath: state.returnPath,
      events: state.events.map(serializeEvent),
    }),
  );
}

export function readCalendarImportPreviewState():
  | CalendarImportPreviewState
  | null {
  const raw = sessionStorage.getItem(CALENDAR_IMPORT_PREVIEW_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as {
      source: string;
      returnPath: string;
      events: SerializedCalendarEvent[];
    };
    return {
      source: parsed.source,
      returnPath: parsed.returnPath,
      events: parsed.events.map(deserializeEvent),
    };
  } catch (error) {
    console.error("Failed to read calendar import preview state:", error);
    sessionStorage.removeItem(CALENDAR_IMPORT_PREVIEW_KEY);
    return null;
  }
}

export function clearCalendarImportPreviewState() {
  sessionStorage.removeItem(CALENDAR_IMPORT_PREVIEW_KEY);
}
