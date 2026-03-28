import ICAL from "ical.js";
import { CalendarEvent } from "../store/useAppStore";
import { supabase } from "../lib/supabase";

export interface ImportedTaskPreview {
  task_name: string;
  details: string;
  due_start: string;
  due_end: string;
  category: "school" | "work" | "personal" | "general";
  priority: "high" | "medium" | "low";
  location?: string;
  source_event_id: string;
}

const RECURRING_IMPORT_WINDOW_DAYS = 120;
const MAX_RECURRING_OCCURRENCES = 200;

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function inferEventType(summary: string, description: string): CalendarEvent["type"] {
  const combined = `${summary} ${description}`.toLowerCase();

  if (/(class|lecture|lab|office hours|quiz|exam|midterm|club meeting)/.test(combined)) {
    return "class";
  }

  if (/(assignment|homework|project|discussion post|report due|submission|due)/.test(combined)) {
    return "assignment";
  }

  return "external";
}

function inferTaskCategory(event: CalendarEvent): ImportedTaskPreview["category"] {
  const combined = `${event.title} ${event.description || ""}`.toLowerCase();

  if (/(csc|math|assignment|quiz|exam|lab|homework|project|study|office hours|club|resume review)/.test(combined)) {
    return "school";
  }

  if (/(work shift|help desk|part-time work|interview|meeting)/.test(combined)) {
    return "work";
  }

  if (/(doctor|family|birthday|gym|workout|personal)/.test(combined)) {
    return "personal";
  }

  return "general";
}

function inferTaskPriority(event: CalendarEvent): ImportedTaskPreview["priority"] {
  const combined = `${event.title} ${event.description || ""}`.toLowerCase();

  if (/(due|exam|midterm|quiz|project|deadline|submit)/.test(combined)) {
    return "high";
  }

  if (/(office hours|club|study|planning)/.test(combined)) {
    return "medium";
  }

  return event.type === "assignment" ? "high" : "low";
}

function mapOccurrenceToEvent(
  event: ICAL.Event,
  start: Date,
  end: Date,
  index: number,
): CalendarEvent {
  const summary = event.summary || "Untitled Event";
  const description = event.description || "";
  const eventIdBase = event.uid || `ical-${Date.now()}-${index}`;

  return {
    id: `${eventIdBase}-${start.toISOString()}`,
    title: summary,
    start,
    end,
    type: inferEventType(summary, description),
    description: description || undefined,
  };
}

/**
 * Fetches and parses iCal data from a URL
 * Note: Due to CORS restrictions, some calendar URLs may need to be accessed via a proxy
 */
export async function fetchCalendarEvents(url: string): Promise<CalendarEvent[]> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const session = supabase
      ? (await supabase.auth.getSession()).data.session
      : null;

    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }

    const response = await fetch("/api/calendar-url-preview", {
      method: "POST",
      headers,
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.error || `Failed to fetch calendar: ${response.statusText}`);
    }

    const payload = await response.json();
    const icalData = typeof payload?.icalData === "string" ? payload.icalData : "";
    if (!icalData) {
      throw new Error("Calendar response was empty.");
    }
    return parseICalData(icalData);
  } catch (error) {
    console.error("Error fetching calendar:", error);
    throw error;
  }
}

export function resolveCalendarImportUrl(url: string): string {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return "";

  if (trimmedUrl.includes("google.com/calendar")) {
    return getGoogleCalendarICalUrl(trimmedUrl) || trimmedUrl;
  }

  return trimmedUrl;
}

/**
 * Parses iCal string data into CalendarEvent objects
 */
export function parseICalData(icalData: string): CalendarEvent[] {
  try {
    const jcalData = ICAL.parse(icalData);
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents("vevent");
    const rangeStart = addDays(new Date(), -7);
    const rangeEnd = addDays(new Date(), RECURRING_IMPORT_WINDOW_DAYS);
    const events: CalendarEvent[] = [];

    vevents.forEach((vevent, idx) => {
      const event = new ICAL.Event(vevent);

      if (event.isRecurring()) {
        const iterator = event.iterator();
        let occurrence = iterator.next();
        let count = 0;

        while (occurrence && count < MAX_RECURRING_OCCURRENCES) {
          const details = event.getOccurrenceDetails(occurrence);
          const start = details.startDate.toJSDate();
          const end = details.endDate.toJSDate();

          if (start > rangeEnd) {
            break;
          }

          if (end >= rangeStart) {
            events.push(mapOccurrenceToEvent(event, start, end, idx));
          }

          count += 1;
          occurrence = iterator.next();
        }

        return;
      }

      events.push(
        mapOccurrenceToEvent(
          event,
          event.startDate.toJSDate(),
          event.endDate.toJSDate(),
          idx,
        ),
      );
    });

    return events.sort((a, b) => a.start.getTime() - b.start.getTime());
  } catch (error) {
    console.error("Error parsing iCal data:", error);
    throw new Error("Failed to parse calendar data. Please ensure the URL is a valid iCal format.");
  }
}

export function convertCalendarEventsToTaskPreview(events: CalendarEvent[]): ImportedTaskPreview[] {
  return events.map((event) => ({
    task_name: event.title,
    details: event.description || "",
    due_start: event.start.toISOString(),
    due_end: event.end.toISOString(),
    category: inferTaskCategory(event),
    priority: inferTaskPriority(event),
    location: undefined,
    source_event_id: event.id,
  }));
}

/**
 * Gets the public iCal URL from a Google Calendar link
 * Helps users convert their Google Calendar sharing link to iCal format
 */
export function getGoogleCalendarICalUrl(url: string): string | null {
  // Handle various Google Calendar URL formats
  
  // Format 1: Calendar settings URL with calendar ID
  // https://calendar.google.com/calendar/u/0/r/settings/calendar/...
  const settingsMatch = url.match(/calendar\.google\.com.*\/([^\/\?]+@[^\/\?]+|[a-z0-9]+)/i);
  
  // Format 2: Embed URL
  // https://calendar.google.com/calendar/embed?src=...
  const embedMatch = url.match(/[?&]src=([^&]+)/);
  
  // Format 3: Direct iCal URL
  // https://calendar.google.com/calendar/ical/...
  if (url.includes("/ical/")) {
    return url;
  }
  
  let calendarId = null;
  if (embedMatch) {
    calendarId = decodeURIComponent(embedMatch[1]);
  } else if (settingsMatch) {
    calendarId = settingsMatch[1];
  }
  
  if (calendarId) {
    return `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
  }
  
  return null;
}
