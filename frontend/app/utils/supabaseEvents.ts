import { supabase } from "../lib/supabase";
import { CalendarEvent } from "../store/useAppStore";

/**
 * Supabase table: calendar_events
 *
 * Expected schema (run this in Supabase SQL editor):
 *
 * create table calendar_events (
 *   id text primary key,
 *   title text not null,
 *   start timestamptz not null,
 *   "end" timestamptz not null,
 *   type text not null default 'external',
 *   description text,
 *   completed boolean default false,
 *   xp_value integer default 0,
 *   source_url text,
 *   created_at timestamptz default now()
 * );
 *
 * -- Enable RLS but allow all access with anon key (for hackathon simplicity)
 * alter table calendar_events enable row level security;
 * create policy "Allow all access" on calendar_events for all using (true) with check (true);
 */

/** Convert a Supabase row to a CalendarEvent */
function rowToEvent(row: any): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    start: new Date(row.start),
    end: new Date(row.end),
    type: row.type,
    description: row.description ?? undefined,
    completed: row.completed ?? false,
    xpValue: row.xp_value ?? 0,
  };
}

/** Convert a CalendarEvent to a Supabase row */
function eventToRow(event: CalendarEvent, sourceUrl?: string) {
  return {
    id: event.id,
    title: event.title,
    start: event.start instanceof Date ? event.start.toISOString() : event.start,
    end: event.end instanceof Date ? event.end.toISOString() : event.end,
    type: event.type,
    description: event.description ?? null,
    completed: event.completed ?? false,
    xp_value: event.xpValue ?? 0,
    source_url: sourceUrl ?? null,
  };
}

/** Fetch all calendar events from Supabase */
export async function fetchEventsFromSupabase(): Promise<CalendarEvent[]> {
  const { data, error } = await supabase
    .from("calendar_events")
    .select("*")
    .order("start", { ascending: true });

  if (error) {
    console.error("Error fetching events from Supabase:", error);
    throw error;
  }

  return (data ?? []).map(rowToEvent);
}

/** Upsert multiple calendar events to Supabase (insert or update on conflict) */
export async function upsertEventsToSupabase(
  events: CalendarEvent[],
  sourceUrl?: string
): Promise<void> {
  if (events.length === 0) return;

  const rows = events.map((e) => eventToRow(e, sourceUrl));

  const { error } = await supabase
    .from("calendar_events")
    .upsert(rows, { onConflict: "id" });

  if (error) {
    console.error("Error upserting events to Supabase:", error);
    throw error;
  }
}

/** Remove all external (Google Calendar) events from Supabase */
export async function removeExternalEventsFromSupabase(): Promise<void> {
  const { error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("type", "external");

  if (error) {
    console.error("Error removing external events from Supabase:", error);
    throw error;
  }
}

/** Remove events that came from a specific source URL */
export async function removeEventsBySourceUrl(sourceUrl: string): Promise<void> {
  const { error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("source_url", sourceUrl);

  if (error) {
    console.error("Error removing events by source:", error);
    throw error;
  }
}

/** Update a single event in Supabase */
export async function updateEventInSupabase(
  id: string,
  updates: Partial<CalendarEvent>
): Promise<void> {
  const row: Record<string, any> = {};
  if (updates.title !== undefined) row.title = updates.title;
  if (updates.start !== undefined)
    row.start = updates.start instanceof Date ? updates.start.toISOString() : updates.start;
  if (updates.end !== undefined)
    row.end = updates.end instanceof Date ? updates.end.toISOString() : updates.end;
  if (updates.type !== undefined) row.type = updates.type;
  if (updates.description !== undefined) row.description = updates.description;
  if (updates.completed !== undefined) row.completed = updates.completed;
  if (updates.xpValue !== undefined) row.xp_value = updates.xpValue;

  const { error } = await supabase
    .from("calendar_events")
    .update(row)
    .eq("id", id);

  if (error) {
    console.error("Error updating event in Supabase:", error);
    throw error;
  }
}

/** Add a single event to Supabase */
export async function addEventToSupabase(
  event: CalendarEvent
): Promise<void> {
  const row = eventToRow(event);

  const { error } = await supabase
    .from("calendar_events")
    .upsert([row], { onConflict: "id" });

  if (error) {
    console.error("Error adding event to Supabase:", error);
    throw error;
  }
}

/** Delete a single event from Supabase */
export async function deleteEventFromSupabase(id: string): Promise<void> {
  const { error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting event from Supabase:", error);
    throw error;
  }
}
