import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  format,
  startOfWeek,
  addDays,
  isSameDay,
  startOfDay,
  setHours,
  setMinutes,
  differenceInMinutes,
  addMinutes,
} from "date-fns";
import { ChevronLeft, ChevronRight, Clock, Plus, Trash2, CheckCircle2 } from "lucide-react";
import { Button } from "./ui/button";
import { useAppStore, CalendarEvent } from "../store/useAppStore";
import { cn } from "./ui/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { toast } from "sonner";

// --- Constants ---
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS_IN_WEEK = 7;
const HOUR_HEIGHT = 42; 

// --- Types ---
interface PositionedEvent extends CalendarEvent {
  column: number;
  totalColumns: number;
}

interface DragState {
  id: string;
  start: Date;
  end: Date;
  day: Date;
}

export default function WeeklyCalendar() {
  const { events, addEvent, updateEvent, removeEvent } = useAppStore();
  
  // -- View State --
  const [viewMode, setViewMode] = useState<"week" | "day">("week");
  const [currentWeekStart, setCurrentWeekStart] = useState(
    startOfWeek(new Date(), { weekStartsOn: 0 })
  );
  const [focusedDay, setFocusedDay] = useState(new Date());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // -- Drag State --
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragState | null>(null);

  // -- Dialog State --
  const [showDialog, setShowDialog] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    date: format(new Date(), "yyyy-MM-dd"),
    startTime: "09:00",
    endTime: "10:00",
    type: "assignment" as CalendarEvent["type"],
  });

  // -- Initialization --
  const visibleDays = useMemo(() => {
    if (viewMode === "day") return [focusedDay];
    return Array.from({ length: DAYS_IN_WEEK }, (_, i) => addDays(currentWeekStart, i));
  }, [currentWeekStart, focusedDay, viewMode]);

  useEffect(() => {
    if (scrollContainerRef.current) {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      scrollContainerRef.current.scrollTop = (currentMinutes / 60) * HOUR_HEIGHT - 150;
    }
  }, []);

  // -- Navigation --
  const navigate = (dir: "prev" | "next" | "today") => {
    if (dir === "today") {
      const today = new Date();
      setCurrentWeekStart(startOfWeek(today, { weekStartsOn: 0 }));
      setFocusedDay(today);
    } else {
      if (viewMode === "week") {
        setCurrentWeekStart(prev => addDays(prev, dir === "next" ? 7 : -7));
      } else {
        setFocusedDay(prev => addDays(prev, dir === "next" ? 1 : -1));
      }
    }
  };

  // -- Collision Algorithm (Side-by-Side) --
  const getPositionedEvents = (day: Date): PositionedEvent[] => {
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);

    const dayEvents = events
      .filter(e => {
        const s = new Date(e.start);
        const en = new Date(e.end);
        return s < dayEnd && en > dayStart;
      })
      .map(e => {
        const s = new Date(e.start);
        const en = new Date(e.end);
        return {
          ...e,
          vStart: s < dayStart ? dayStart : s,
          vEnd: en > dayEnd ? dayEnd : en
        };
      })
      .sort((a, b) => a.vStart.getTime() - b.vStart.getTime());

    if (!dayEvents.length) return [];

    const clusters: any[][] = [];
    dayEvents.forEach(event => {
      let cluster = clusters.find(c => c.some(ce => 
        event.vStart < ce.vEnd && event.vEnd > ce.vStart
      ));
      if (cluster) cluster.push(event);
      else clusters.push([event]);
    });

    const positioned: PositionedEvent[] = [];
    clusters.forEach(cluster => {
      const columns: any[][] = [];
      cluster.forEach(event => {
        let colIdx = columns.findIndex(col => {
          const last = col[col.length - 1];
          return event.vStart >= last.vEnd;
        });
        if (colIdx === -1) {
          columns.push([event]);
          colIdx = columns.length - 1;
        } else {
          columns[colIdx].push(event);
        }
        positioned.push({ ...event, column: colIdx, totalColumns: 0 });
      });
      cluster.forEach(e => {
        const pe = positioned.find(p => p.id === e.id);
        if (pe) pe.totalColumns = columns.length;
      });
    });

    return positioned;
  };

  // -- Event Handlers --
  const onGridClick = (day: Date, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".event-block")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = ((e.clientY - rect.top) / HOUR_HEIGHT) * 60;
    const snapped = Math.floor(minutes / 30) * 30;
    
    setDialogMode("create");
    setForm({
      title: "",
      date: format(day, "yyyy-MM-dd"),
      startTime: format(setMinutes(setHours(new Date(), Math.floor(snapped/60)), snapped%60), "HH:mm"),
      endTime: format(setMinutes(setHours(new Date(), Math.floor((snapped+60)/60)), (snapped+60)%60), "HH:mm"),
      type: "assignment"
    });
    setShowDialog(true);
  };

  const onEventClick = (e: React.MouseEvent, event: CalendarEvent) => {
    e.stopPropagation();
    
    // Toggle completion on Shift + Click
    if (e.shiftKey) {
      updateEvent(event.id, { completed: !event.completed });
      toast.success(event.completed ? "Task reactivated" : "Task completed!");
      return;
    }

    setDialogMode("edit");
    setSelectedEventId(event.id);
    setForm({
      title: event.title,
      date: format(new Date(event.start), "yyyy-MM-dd"),
      startTime: format(new Date(event.start), "HH:mm"),
      endTime: format(new Date(event.end), "HH:mm"),
      type: event.type
    });
    setShowDialog(true);
  };

  const onDragStart = (e: React.DragEvent, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    const img = new Image();
    img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    e.dataTransfer.setDragImage(img, 0, 0);
  };

  const onDragOver = (e: React.DragEvent, day: Date) => {
    e.preventDefault();
    if (!draggingId) return;
    const event = events.find(ev => ev.id === draggingId);
    if (!event) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = ((e.clientY - rect.top) / HOUR_HEIGHT) * 60;
    const snapped = Math.round(minutes / 15) * 15;
    const duration = differenceInMinutes(new Date(event.end), new Date(event.start));
    
    const newStart = startOfDay(day);
    newStart.setHours(Math.floor(snapped / 60));
    newStart.setMinutes(snapped % 60);
    
    setDragPreview({
      id: draggingId,
      day,
      start: newStart,
      end: addMinutes(newStart, duration)
    });
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (draggingId && dragPreview) {
      try {
        await updateEvent(draggingId, { start: dragPreview.start, end: dragPreview.end });
        toast.success("Event moved");
      } catch {
        toast.error("Failed to move event");
      }
    }
    setDraggingId(null);
    setDragPreview(null);
  };

  const saveEvent = async () => {
    const start = new Date(`${form.date}T${form.startTime}`);
    const end = new Date(`${form.date}T${form.endTime}`);
    if (end <= start) return toast.error("End time must be after start time");

    try {
      if (dialogMode === "create") {
        await addEvent({ title: form.title, start, end, type: form.type, xpValue: form.type === "working" ? 50 : 10, completed: false });
        toast.success("Event added");
      } else if (selectedEventId) {
        await updateEvent(selectedEventId, { title: form.title, start, end, type: form.type });
        toast.success("Event updated");
      }
      setShowDialog(false);
    } catch {
      toast.error("Error saving event");
    }
  };

  // -- Styles --
  const getEventStyle = (e: CalendarEvent | DragState, day: Date, col: number = 0, total: number = 1) => {
    const start = new Date(e.start);
    const end = new Date(e.end);
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);

    const effectiveStart = start < dayStart ? dayStart : start;
    const effectiveEnd = end > dayEnd ? dayEnd : end;

    const top = (effectiveStart.getHours() * 60 + effectiveStart.getMinutes()) / 60 * HOUR_HEIGHT;
    const height = Math.max(differenceInMinutes(effectiveEnd, effectiveStart) / 60 * HOUR_HEIGHT, 22);
    
    return {
      top: `${top}px`,
      height: `${height}px`,
      left: `${(col / total) * 100}%`,
      width: `${(1 / total) * 100 - 1}%`,
    };
  };

  const getColor = (type: string) => {
    const map: Record<string, string> = {
      class: "bg-blue-500/20 border-blue-500 text-blue-700",
      assignment: "bg-red-500/20 border-red-500 text-red-700",
      working: "bg-orange-500/20 border-orange-500 text-orange-700",
      goal: "bg-green-500/20 border-green-500 text-green-700",
      freetime: "bg-purple-500/20 border-purple-500 text-purple-700",
      fixed: "bg-slate-600/20 border-slate-600 text-slate-800",
      flexible: "bg-teal-500/20 border-teal-500 text-teal-800",
      external: "bg-gray-500/20 border-gray-500 text-gray-700",
    };
    return map[type] || "bg-gray-500/20 border-gray-500 text-gray-700";
  };

  return (
    <div className="flex flex-col h-full bg-card border rounded-xl overflow-hidden shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-muted/5">
        <div className="flex items-center gap-4">
          <div className="flex items-center border rounded-lg overflow-hidden">
            <Button variant="ghost" size="sm" className="rounded-none px-4 font-bold border-r" onClick={() => navigate("today")}>Today</Button>
            <Button variant="ghost" size="icon" className="rounded-none border-r h-9 w-9" onClick={() => navigate("prev")}><ChevronLeft className="h-4 w-4"/></Button>
            <Button variant="ghost" size="icon" className="rounded-none h-9 w-9" onClick={() => navigate("next")}><ChevronRight className="h-4 w-4"/></Button>
          </div>
          <h2 className="text-xl font-bold">
            {viewMode === "week" 
              ? format(currentWeekStart, "MMMM yyyy")
              : format(focusedDay, "MMMM d, yyyy")
            }
          </h2>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex bg-muted p-1 rounded-lg">
            <Button 
              variant={viewMode === "day" ? "secondary" : "ghost"} 
              size="sm" 
              className="h-7 px-3 text-xs font-bold"
              onClick={() => setViewMode("day")}
            >
              Day
            </Button>
            <Button 
              variant={viewMode === "week" ? "secondary" : "ghost"} 
              size="sm" 
              className="h-7 px-3 text-xs font-bold"
              onClick={() => setViewMode("week")}
            >
              Week
            </Button>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground bg-secondary/50 px-3 py-1.5 rounded-full uppercase tracking-tighter">
            <Clock className="h-3 w-3" /> {viewMode === "week" ? "Week View" : "Day View"}
          </div>
        </div>
      </div>

      {/* Week Header */}
      <div className="grid grid-cols-[60px_1fr] border-b bg-muted/20">
        <div className="border-r" />
        <div className={cn("grid h-16", viewMode === "week" ? "grid-cols-7" : "grid-cols-1")}>
          {visibleDays.map(day => (
            <div key={day.toISOString()} className={cn("flex flex-col items-center justify-center border-r last:border-r-0", isSameDay(day, new Date()) && "bg-primary/5")}>
              <span className={cn("text-[10px] font-black uppercase", isSameDay(day, new Date()) ? "text-primary" : "text-muted-foreground")}>{format(day, "EEE")}</span>
              <span className={cn("text-lg font-black h-8 w-8 flex items-center justify-center rounded-full mt-0.5", isSameDay(day, new Date()) && "bg-primary text-white")}>{format(day, "d")}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto relative bg-background select-none">
        <div className="grid grid-cols-[60px_1fr] min-h-0">
          <div className="border-r bg-muted/5">
            {HOURS.map(h => (
              <div key={h} className="h-[42px] text-[9px] font-bold text-muted-foreground text-right pr-2 pt-0.5">
                {h === 0 ? "" : format(setHours(new Date(), h), "h a")}
              </div>
            ))}
          </div>

          <div className={cn("relative h-[1008px] grid", viewMode === "week" ? "grid-cols-7" : "grid-cols-1")}>
            {visibleDays.map(day => {
              const dayEvents = getPositionedEvents(day);
              return (
                <div key={day.toISOString()} className={cn("relative border-r last:border-r-0 h-full", isSameDay(day, new Date()) && "bg-primary/[0.02]")}
                     onClick={(e) => onGridClick(day, e)} onDragOver={(e) => onDragOver(e, day)} onDrop={onDrop}>
                  {HOURS.map(h => <div key={h} className="h-[42px] border-b border-border/40" />)}
                  
                  {dayEvents.map(event => {
                    const isDragging = draggingId === event.id;
                    return (
                      <div key={event.id} draggable onDragStart={(e) => onDragStart(e, event.id)} onDragEnd={() => {setDraggingId(null); setDragPreview(null);}}
                           className={cn(
                             "event-block absolute rounded-md border-l-4 p-1.5 text-[10px] leading-tight overflow-hidden shadow-sm z-10 transition-all cursor-pointer hover:z-20 group", 
                             getColor(event.type), 
                             isDragging && "opacity-30",
                             event.completed && "opacity-50 grayscale-[0.3]"
                           )}
                           style={getEventStyle(event, day, event.column, event.totalColumns)} onClick={(e) => onEventClick(e, event)}>
                        <div className={cn("font-black truncate", event.completed && "line-through text-muted-foreground")}>{event.title}</div>
                        <div className="opacity-80 font-bold flex items-center justify-between">
                          <span>{format(new Date(event.start), "h:mm a")}</span>
                          {event.completed && <CheckCircle2 className="h-3 w-3 text-green-600" />}
                        </div>
                        <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/5 transition-colors pointer-events-none" />
                      </div>
                    );
                  })}

                  {dragPreview && isSameDay(dragPreview.day, day) && (
                    <div className={cn("absolute rounded-md border-l-4 border-dashed p-1.5 text-[10px] leading-tight overflow-hidden shadow-lg z-50 pointer-events-none opacity-60", getColor(events.find(e => e.id === draggingId)?.type || ""))}
                         style={getEventStyle(dragPreview, day)}>
                      <div className="font-black truncate">{events.find(e => e.id === draggingId)?.title}</div>
                      <div className="font-bold">{format(dragPreview.start, "h:mm a")}</div>
                    </div>
                  )}
                </div>
              );
            })}
            <TimeIndicator currentWeekStart={currentWeekStart} focusedDay={focusedDay} viewMode={viewMode} />
          </div>
        </div>
      </div>

      {/* Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader><DialogTitle className="flex items-center gap-2">{dialogMode === "create" ? <Plus className="h-5 w-5 text-primary" /> : <Clock className="h-5 w-5 text-primary" />}{dialogMode === "create" ? "Create Event" : "Edit Event"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5"><Label htmlFor="t">Title</Label><Input id="t" value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="e.g., Study Session" autoFocus /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5"><Label htmlFor="s">Start</Label><Input id="s" type="time" value={form.startTime} onChange={e => setForm({...form, startTime: e.target.value})} /></div>
              <div className="grid gap-1.5"><Label htmlFor="e">End</Label><Input id="e" type="time" value={form.endTime} onChange={e => setForm({...form, endTime: e.target.value})} /></div>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="ty">Type</Label>
              <Select value={form.type} onValueChange={(v:any) => setForm({...form, type: v})}><SelectTrigger id="ty"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="class">Class</SelectItem><SelectItem value="assignment">Assignment</SelectItem><SelectItem value="working">Working Task</SelectItem><SelectItem value="goal">Goal Task</SelectItem><SelectItem value="freetime">Free Time Task</SelectItem></SelectContent></Select>
            </div>
          </div>
          <DialogFooter className="flex justify-between w-full">
            {dialogMode === "edit" ? <Button variant="destructive" size="icon" onClick={() => { removeEvent(selectedEventId!); setShowDialog(false); toast.success("Deleted"); }}><Trash2 className="h-4 w-4"/></Button> : <div/>}
            <div className="flex gap-2"><Button variant="ghost" onClick={() => setShowDialog(false)}>Cancel</Button><Button onClick={saveEvent}>{dialogMode === "create" ? "Create" : "Save"}</Button></div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TimeIndicator({ currentWeekStart, focusedDay, viewMode }: { currentWeekStart: Date, focusedDay: Date, viewMode: "week" | "day" }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(i); }, []);
  
  if (viewMode === "week") {
    const weekEnd = addDays(currentWeekStart, 7);
    if (now < currentWeekStart || now >= weekEnd) return null;
    const top = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT;
    const left = (now.getDay() * (100/7));
    return (
      <div className="absolute right-0 pointer-events-none z-30 flex items-center" style={{ top: `${top}px`, left: `${left}%`, width: `${100/7}%` }}>
        <div className="h-2.5 w-2.5 rounded-full bg-red-500 -ml-1.5 shadow-sm" />
        <div className="h-[1.5px] flex-1 bg-red-500 shadow-sm" />
      </div>
    );
  } else {
    if (!isSameDay(now, focusedDay)) return null;
    const top = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT;
    return (
      <div className="absolute left-0 right-0 pointer-events-none z-30 flex items-center" style={{ top: `${top}px`, width: "100%" }}>
        <div className="h-2.5 w-2.5 rounded-full bg-red-500 -ml-1.5 shadow-sm" />
        <div className="h-[1.5px] flex-1 bg-red-500 shadow-sm" />
      </div>
    );
  }
}
