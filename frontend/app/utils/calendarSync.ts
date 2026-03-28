import ICAL from "ical.js";
import { CalendarEvent } from "../store/useAppStore";

/**
 * Fetches and parses iCal data from a URL
 * Note: Due to CORS restrictions, some calendar URLs may need to be accessed via a proxy
 */
export async function fetchCalendarEvents(url: string): Promise<CalendarEvent[]> {
  try {
    // Try direct fetch first
    let response;
    try {
      response = await fetch(url);
    } catch (corsError) {
      // If CORS fails, try with a CORS proxy
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      response = await fetch(proxyUrl);
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch calendar: ${response.statusText}`);
    }

    const icalData = await response.text();
    return parseICalData(icalData);
  } catch (error) {
    console.error("Error fetching calendar:", error);
    throw error;
  }
}

/**
 * Parses iCal string data into CalendarEvent objects
 */
export function parseICalData(icalData: string): CalendarEvent[] {
  try {
    const jcalData = ICAL.parse(icalData);
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents("vevent");

    const events: CalendarEvent[] = vevents.map((vevent, idx) => {
      const event = new ICAL.Event(vevent);
      
      // Get start and end times
      const start = event.startDate.toJSDate();
      const end = event.endDate.toJSDate();
      
      // Determine event type based on summary/description
      const summary = (event.summary || "").toLowerCase();
      let type: CalendarEvent["type"] = "external";
      
      if (summary.includes("class") || summary.includes("lecture") || summary.includes("lab")) {
        type = "class";
      } else if (summary.includes("assignment") || summary.includes("homework") || summary.includes("project")) {
        type = "assignment";
      }

      // Ensure we have a string ID for the backend
      const externalId = event.uid || `ical-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 9)}`;

      return {
        id: externalId,
        title: event.summary || "Untitled Event",
        start,
        end,
        type,
        description: event.description || undefined,
      };
    });

    return events;
  } catch (error) {
    console.error("Error parsing iCal data:", error);
    throw new Error("Failed to parse calendar data. Please ensure the URL is a valid iCal format.");
  }
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
