import React, { useState, useMemo, useEffect } from "react";
import {
  format,
  startOfWeek,
  addDays,
  isSameDay,
  startOfDay,
  addMinutes,
  isWithinInterval,
  setHours,
  setMinutes,
} from "date-fns";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { Button } from "./ui/button";
import { useAppStore, CalendarEvent } from "../store/useAppStore";
import { cn } from "./ui/utils";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS_IN_WEEK = 7;

export default function WeeklyCalendar() {
  const { events, userProfile } = useAppStore();
  const [currentWeekStart, setCurrentWeekStart] = useState(
    startOfWeek(new Date(), { weekStartsOn: 0 })
  );

  const weekDays = useMemo(() => {
    return Array.from({ length: DAYS_IN_WEEK }, (_, i) =>
      addDays(currentWeekStart, i)
    );
  }, [currentWeekStart]);

  const navigateWeek = (direction: "prev" | "next") => {
    setCurrentWeekStart((prev) =>
      addDays(prev, direction === "next" ? 7 : -7)
    );
  };

  const navigateToday = () => {
    setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 }));
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        navigateWeek("prev");
      } else if (e.key === "ArrowRight") {
        navigateWeek("next");
      } else if (e.key === "t" || e.key === "T") {
        navigateToday();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const getEventStyle = (event: CalendarEvent) => {
    const start = new Date(event.start);
    const end = new Date(event.end);
    
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const endMinutes = end.getHours() * 60 + end.getMinutes();
    const duration = endMinutes - startMinutes;

    // Each hour is 60px height
    const top = (startMinutes / 60) * 60;
    const height = (duration / 60) * 60;

    return {
      top: `${top}px`,
      height: `${Math.max(height, 20)}px`, // Minimum height for visibility
    };
  };

  const getEventColorClass = (type: string) => {
    switch (type) {
      case "class":
        return "bg-blue-500/20 border-blue-500 text-blue-700 dark:text-blue-300";
      case "assignment":
        return "bg-red-500/20 border-red-500 text-red-700 dark:text-red-300";
      case "working":
        return "bg-orange-500/20 border-orange-500 text-orange-700 dark:text-orange-300";
      case "goal":
        return "bg-green-500/20 border-green-500 text-green-700 dark:text-green-300";
      case "freetime":
        return "bg-purple-500/20 border-purple-500 text-purple-700 dark:text-purple-300";
      default:
        return "bg-gray-500/20 border-gray-500 text-gray-700 dark:text-gray-300";
    }
  };

  return (
    <div className="flex flex-col h-full bg-card border rounded-xl overflow-hidden shadow-sm">
      {/* Calendar Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold min-w-[200px]">
            {format(currentWeekStart, "MMMM yyyy")}
          </h2>
          <div className="flex items-center bg-secondary rounded-lg p-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => navigateWeek("prev")}
              title="Previous Week (ArrowLeft)"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              className="h-8 px-3 text-xs font-medium"
              onClick={navigateToday}
              title="Today (T)"
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => navigateWeek("next")}
              title="Next Week (ArrowRight)"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>Week View</span>
        </div>
      </div>

      {/* Days Header */}
      <div className="grid grid-cols-[60px_1fr] border-b bg-muted/30">
        <div className="border-r" />
        <div className="grid grid-cols-7 h-16">
          {weekDays.map((day) => (
            <div
              key={day.toISOString()}
              className={cn(
                "flex flex-col items-center justify-center border-r last:border-r-0",
                isSameDay(day, new Date()) && "bg-primary/5"
              )}
            >
              <span className="text-xs font-medium text-muted-foreground uppercase">
                {format(day, "EEE")}
              </span>
              <span
                className={cn(
                  "text-lg font-bold h-8 w-8 flex items-center justify-center rounded-full mt-1",
                  isSameDay(day, new Date()) && "bg-primary text-primary-foreground"
                )}
              >
                {format(day, "d")}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 overflow-y-auto relative bg-background">
        <div className="grid grid-cols-[60px_1fr] min-h-[1440px]">
          {/* Time Labels */}
          <div className="border-r bg-muted/10">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="h-[60px] text-[10px] text-muted-foreground text-right pr-2 pt-1 border-b border-dashed border-border/50"
              >
                {format(setHours(startOfDay(new Date()), hour), "ha")}
              </div>
            ))}
          </div>

          {/* Day Columns */}
          <div className="grid grid-cols-7 relative">
            {weekDays.map((day) => (
              <div
                key={day.toISOString()}
                className={cn(
                  "relative border-r last:border-r-0 min-h-full",
                  isSameDay(day, new Date()) && "bg-primary/[0.02]"
                )}
              >
                {/* Hour Grid Lines */}
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="h-[60px] border-b border-dashed border-border/50"
                  />
                ))}

                {/* Events for this day */}
                {events
                  .filter((event) => isSameDay(new Date(event.start), day))
                  .map((event) => (
                    <div
                      key={event.id}
                      className={cn(
                        "absolute left-1 right-1 rounded-md border-l-4 p-1.5 text-[10px] leading-tight overflow-hidden shadow-sm z-10 hover:z-20 transition-all cursor-pointer hover:ring-2 hover:ring-primary/20",
                        getEventColorClass(event.type),
                        event.completed && "opacity-60 grayscale-[0.5]"
                      )}
                      style={getEventStyle(event)}
                      title={`${event.title} (${format(new Date(event.start), "h:mm a")} - ${format(new Date(event.end), "h:mm a")})`}
                    >
                      <div className="font-bold truncate">{event.title}</div>
                      <div className="opacity-80">
                        {format(new Date(event.start), "h:mm a")}
                      </div>
                      {event.completed && (
                        <div className="absolute top-1 right-1 text-green-600">✓</div>
                      )}
                    </div>
                  ))}
              </div>
            ))}

            {/* Current Time Indicator (only for today) */}
            {isWithinInterval(new Date(), {
              start: weekDays[0],
              end: addDays(weekDays[6], 1),
            }) && (
              <div
                className="absolute left-0 right-0 pointer-events-none z-30"
                style={{
                  top: `${(new Date().getHours() * 60 + new Date().getMinutes())}px`,
                }}
              >
                <div className="flex items-center">
                  <div className="h-2 w-2 rounded-full bg-red-500 -ml-1 shadow-sm" />
                  <div className="h-[1px] flex-1 bg-red-500 shadow-sm" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
