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
import { 
  ChevronLeft, 
  ChevronRight, 
  Clock, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Check, 
  X, 
  RefreshCw
} from "lucide-react";
import { Button } from "./ui/button";
import { useAppStore, CalendarEvent, SuggestedTask } from "../store/useAppStore";
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
const DAYS_IN_WEEK = 7;
const HOUR_HEIGHT = 50; // Balanced height: not too big, not too small

// --- Types ---
interface PositionedItem extends CalendarEvent {
  column: number;
  totalColumns: number;
  isSuggestion?: boolean;
  status?: SuggestedTask["status"];
}

interface DragState {
  id: string;
  start: Date;
  end: Date;
  day: Date;
  isSuggestion?: boolean;
}

interface WeeklyCalendarProps {
  viewMode?: "week" | "day";
  setViewMode?: (mode: "week" | "day") => void;
}

export default function WeeklyCalendar({ viewMode: externalViewMode, setViewMode: externalSetViewMode }: WeeklyCalendarProps) {
  const { 
    events, 
    userProfile,
    addEvent, 
    updateEvent, 
    removeEvent,
    pendingSuggestions,
    updatePendingSuggestionStatus,
    updatePendingSuggestion,
    removePendingSuggestion,
    refreshSuggestion,
    confirmAllSuggestions
  } = useAppStore();
  
  const [internalViewMode, internalSetViewMode] = useState<"week" | "day">("week");
  const viewMode = externalViewMode ?? internalViewMode;
  const setViewMode = externalSetViewMode ?? internalSetViewMode;

  const [currentWeekStart, setCurrentWeekStart] = useState(
    startOfWeek(new Date(), { weekStartsOn: 0 })
  );
  const [focusedDay, setFocusedDay] = useState(new Date());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const { startHour, visibleHours } = useMemo(() => {
    const wakeH = parseInt(userProfile.wakeTime.split(":")[0]) || 7;
    const sleepH = parseInt(userProfile.sleepTime.split(":")[0]) || 23;
    const start = Math.max(0, Math.min(6, wakeH - 1));
    const end = Math.min(24, Math.max(24, sleepH + 1));
    const hours = [];
    for (let i = start; i <= end; i++) hours.push(i % 24);
    return { startHour: start, visibleHours: hours };
  }, [userProfile.wakeTime, userProfile.sleepTime]);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragState | null>(null);

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

  const visibleDays = useMemo(() => {
    if (viewMode === "day") return [focusedDay];
    return Array.from({ length: DAYS_IN_WEEK }, (_, i) => addDays(currentWeekStart, i));
  }, [currentWeekStart, focusedDay, viewMode]);

  useEffect(() => {
    if (scrollContainerRef.current) {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const scrollPos = ((currentMinutes / 60) - startHour) * HOUR_HEIGHT - 100;
      scrollContainerRef.current.scrollTop = Math.max(0, scrollPos);
    }
  }, [startHour]);

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

  const getPositionedItems = (day: Date): PositionedItem[] => {
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);
    const combinedItems: PositionedItem[] = [
      ...events.map(e => ({ ...e, isSuggestion: false })),
      ...pendingSuggestions
        .filter(s => s.status !== "rejected")
        .map(s => ({ ...s, isSuggestion: true }))
    ];

    const dayItems = combinedItems
      .filter(item => {
        const s = new Date(item.start);
        const en = new Date(item.end);
        return s < dayEnd && en > dayStart;
      })
      .map(item => {
        const s = new Date(item.start);
        const en = new Date(item.end);
        return {
          ...item,
          vStart: s < dayStart ? dayStart : s,
          vEnd: en > dayEnd ? dayEnd : en
        };
      })
      .sort((a, b) => a.vStart.getTime() - b.vStart.getTime());

    if (!dayItems.length) return [];
    const clusters: any[][] = [];
    dayItems.forEach(item => {
      let cluster = clusters.find(c => c.some(ce => item.vStart < ce.vEnd && item.vEnd > ce.vStart));
      if (cluster) cluster.push(item); else clusters.push([item]);
    });

    const positioned: PositionedItem[] = [];
    clusters.forEach(cluster => {
      const columns: any[][] = [];
      cluster.forEach(item => {
        let colIdx = columns.findIndex(col => item.vStart >= col[col.length - 1].vEnd);
        if (colIdx === -1) { columns.push([item]); colIdx = columns.length - 1; }
        else columns[colIdx].push(item);
        positioned.push({ ...item, column: colIdx, totalColumns: 0 });
      });
      cluster.forEach(item => {
        const pe = positioned.find(p => p.id === item.id);
        if (pe) pe.totalColumns = columns.length;
      });
    });
    return positioned;
  };

  const onGridClick = (day: Date, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".event-block")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = ((e.clientY - rect.top) / HOUR_HEIGHT) * 60;
    const snapped = Math.floor(minutes / 30) * 30 + (startHour * 60);
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

  const onEventClick = (e: React.MouseEvent, item: PositionedItem) => {
    e.stopPropagation();
    if (item.isSuggestion) return;
    if (e.shiftKey) {
      updateEvent(item.id, { completed: !item.completed });
      toast.success(item.completed ? "Task reactivated" : "Task completed!");
      return;
    }
    setDialogMode("edit");
    setSelectedEventId(item.id);
    setForm({
      title: item.title,
      date: format(new Date(item.start), "yyyy-MM-dd"),
      startTime: format(new Date(item.start), "HH:mm"),
      endTime: format(new Date(item.end), "HH:mm"),
      type: item.type
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
    const item = pendingSuggestions.find(s => s.id === draggingId) || events.find(ev => ev.id === draggingId);
    if (!item) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = ((e.clientY - rect.top) / HOUR_HEIGHT) * 60;
    const snapped = Math.round(minutes / 15) * 15 + (startHour * 60);
    const duration = differenceInMinutes(new Date(item.end), new Date(item.start));
    const newStart = startOfDay(day);
    newStart.setHours(Math.floor(snapped / 60));
    newStart.setMinutes(snapped % 60);
    setDragPreview({ id: draggingId, day, start: newStart, end: addMinutes(newStart, duration), isSuggestion: !!pendingSuggestions.find(s => s.id === draggingId) });
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (draggingId && dragPreview) {
      try {
        if (dragPreview.isSuggestion) updatePendingSuggestion(draggingId, { start: dragPreview.start, end: dragPreview.end });
        else await updateEvent(draggingId, { start: dragPreview.start, end: dragPreview.end });
        toast.success("Item moved");
      } catch { toast.error("Failed to move item"); }
    }
    setDraggingId(null); setDragPreview(null);
  };

  const saveEvent = async () => {
    const start = new Date(`${form.date}T${form.startTime}`);
    const end = new Date(`${form.date}T${form.endTime}`);
    if (end <= start) return toast.error("End time must be after start time");
    try {
      if (dialogMode === "create") await addEvent({ title: form.title, start, end, type: form.type, xpValue: form.type === "working" ? 50 : 10, completed: false });
      else if (selectedEventId) await updateEvent(selectedEventId, { title: form.title, start, end, type: form.type });
      setShowDialog(false);
    } catch { toast.error("Error saving event"); }
  };

  const getEventStyle = (e: CalendarEvent | DragState, day: Date, col: number = 0, total: number = 1) => {
    const start = new Date(e.start), end = new Date(e.end);
    const dayStart = startOfDay(day), dayEnd = addDays(dayStart, 1);
    const effectiveStart = start < dayStart ? dayStart : start;
    const effectiveEnd = end > dayEnd ? dayEnd : end;
    const startMinutes = (effectiveStart.getHours() * 60 + effectiveStart.getMinutes());
    const top = ((startMinutes / 60) - startHour) * HOUR_HEIGHT;
    const height = Math.max(differenceInMinutes(effectiveEnd, effectiveStart) / 60 * HOUR_HEIGHT, 28);
    return {
      top: `${top}px`,
      height: `${height}px`,
      left: `${(col / total) * 100}%`,
      width: `${(1 / total) * 100 - 3}%`, // More horizontal gap
      marginLeft: '1.5%', // Center in column space
    };
  };

  const getColor = (type: string) => {
    const map: Record<string, string> = {
      class: "bg-blue-500/10 border-blue-500/50 text-blue-700",
      assignment: "bg-red-500/10 border-red-500/50 text-red-700",
      working: "bg-orange-500/10 border-orange-500/50 text-orange-700",
      goal: "bg-green-500/10 border-green-500/50 text-green-700",
      freetime: "bg-purple-500/10 border-purple-500/50 text-purple-700",
      external: "bg-gray-500/10 border-gray-500/50 text-gray-700",
    };
    return map[type] || "bg-gray-500/10 border-gray-500/50 text-gray-700";
  };

  const acceptedCount = pendingSuggestions.filter(s => s.status === "accepted").length;

  return (
    <div className="flex flex-col h-full bg-card border rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between p-3 border-b bg-muted/5">
        <div className="flex items-center gap-3">
          <div className="flex items-center border rounded-lg overflow-hidden">
            <Button variant="ghost" size="sm" className="h-8 rounded-none px-3 font-bold border-r" onClick={() => navigate("today")}>Today</Button>
            <Button variant="ghost" size="icon" className="h-8 rounded-none border-r w-8" onClick={() => navigate("prev")}><ChevronLeft className="h-4 w-4"/></Button>
            <Button variant="ghost" size="icon" className="h-8 rounded-none w-8" onClick={() => navigate("next")}><ChevronRight className="h-4 w-4"/></Button>
          </div>
          <h2 className="text-lg font-bold">
            {viewMode === "week" ? format(currentWeekStart, "MMMM yyyy") : format(focusedDay, "MMMM d, yyyy")}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {acceptedCount > 0 && (
            <Button size="sm" onClick={confirmAllSuggestions} className="font-bold uppercase tracking-widest text-[9px] h-7 bg-green-600 hover:bg-green-700">
              Confirm ({acceptedCount})
            </Button>
          )}
          <div className="flex bg-muted p-0.5 rounded-lg">
            <Button variant={viewMode === "day" ? "secondary" : "ghost"} size="sm" className="h-6 px-2 text-[10px] font-bold" onClick={() => setViewMode("day")}>Day</Button>
            <Button variant={viewMode === "week" ? "secondary" : "ghost"} size="sm" className="h-6 px-2 text-[10px] font-bold" onClick={() => setViewMode("week")}>Week</Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[50px_1fr] border-b bg-muted/10">
        <div className="border-r" />
        <div className={cn("grid h-12", viewMode === "week" ? "grid-cols-7" : "grid-cols-1")}>
          {visibleDays.map(day => (
            <div key={day.toISOString()} className={cn("flex flex-col items-center justify-center border-r last:border-r-0", isSameDay(day, new Date()) && "bg-primary/[0.03]")}>
              <span className={cn("text-[9px] font-black uppercase tracking-tighter", isSameDay(day, new Date()) ? "text-primary" : "text-muted-foreground")}>{format(day, "EEE")}</span>
              <span className={cn("text-sm font-black", isSameDay(day, new Date()) ? "text-primary" : "text-foreground")}>{format(day, "d")}</span>
            </div>
          ))}
        </div>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto relative bg-background select-none">
        <div className="grid grid-cols-[50px_1fr] min-h-0">
          <div className="border-r bg-muted/5">
            {visibleHours.map(h => (
              <div key={h} className="h-[50px] text-[9px] font-medium text-muted-foreground text-right pr-2 pt-1 border-b border-transparent">
                {h === 0 && startHour === 0 ? "" : format(setHours(new Date(), h), "ha")}
              </div>
            ))}
          </div>
          <div className={cn("relative grid", viewMode === "week" ? "grid-cols-7" : "grid-cols-1")} style={{ height: `${visibleHours.length * HOUR_HEIGHT}px` }}>
            {visibleDays.map(day => {
              const items = getPositionedItems(day);
              return (
                <div key={day.toISOString()} className={cn("relative border-r last:border-r-0 h-full", isSameDay(day, new Date()) && "bg-primary/[0.01]")}
                     onClick={(e) => onGridClick(day, e)} onDragOver={(e) => onDragOver(e, day)} onDrop={onDrop}>
                  {visibleHours.map(h => <div key={h} className="h-[50px] border-b border-border/30" />)}
                  {items.map(item => {
                    const isDragging = draggingId === item.id, style = getEventStyle(item, day, item.column, item.totalColumns);
                    if (parseFloat(style.top) < 0 || parseFloat(style.top) > visibleHours.length * HOUR_HEIGHT) return null;
                    return (
                      <div key={item.id} draggable onDragStart={(e) => onDragStart(e, item.id)} onDragEnd={() => {setDraggingId(null); setDragPreview(null);}}
                           className={cn("event-block absolute rounded-md border-l-2 p-1 text-[10px] leading-tight shadow-sm z-10 transition-all cursor-pointer hover:z-20 group", getColor(item.type), isDragging && "opacity-20", item.completed && "opacity-40 grayscale-[0.5]", item.isSuggestion && "border-dashed border-2 opacity-70", item.status === "accepted" && "border-green-500 bg-green-500/10")}
                           style={style} onClick={(e) => onEventClick(e, item)}>
                        <div className={cn("font-bold truncate", item.completed && "line-through")}>{item.title}</div>
                        <div className="opacity-70 text-[9px] mt-0.5">{format(new Date(item.start), "h:mm")}</div>
                        {item.isSuggestion && item.status === "pending" && (
                          <div className="absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-background/90 rounded border shadow-sm p-0.5">
                            <button onClick={(e) => { e.stopPropagation(); updatePendingSuggestionStatus(item.id, "accepted"); }} className="hover:text-green-600 p-0.5"><Check className="h-2.5 w-2.5" /></button>
                            <button onClick={(e) => { e.stopPropagation(); updatePendingSuggestionStatus(item.id, "rejected"); }} className="hover:text-orange-600 p-0.5"><X className="h-2.5 w-2.5" /></button>
                            <button onClick={(e) => { e.stopPropagation(); refreshSuggestion(item.id); }} className="hover:text-blue-600 p-0.5"><RefreshCw className="h-2.5 w-2.5" /></button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {dragPreview && isSameDay(dragPreview.day, day) && (
                    <div className={cn("absolute rounded-md border-l-2 border-dashed p-1 text-[10px] shadow-lg z-50 opacity-40 pointer-events-none", getColor(events.find(e => e.id === draggingId)?.type || pendingSuggestions.find(s => s.id === draggingId)?.type || ""))}
                         style={getEventStyle(dragPreview, day)}><div className="font-bold">{(events.find(e => e.id === draggingId) || pendingSuggestions.find(s => s.id === draggingId))?.title}</div></div>
                  )}
                </div>
              );
            })}
            <TimeIndicator currentWeekStart={currentWeekStart} focusedDay={focusedDay} viewMode={viewMode} startHour={startHour} />
          </div>
        </div>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader><DialogTitle className="text-base font-bold">{dialogMode === "create" ? "Add Event" : "Edit Event"}</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1"><Label className="text-xs">Title</Label><Input className="h-9 text-sm" value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="Session name" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1"><Label className="text-xs">Start</Label><Input className="h-9 text-sm" type="time" value={form.startTime} onChange={e => setForm({...form, startTime: e.target.value})} /></div>
              <div className="grid gap-1"><Label className="text-xs">End</Label><Input className="h-9 text-sm" type="time" value={form.endTime} onChange={e => setForm({...form, endTime: e.target.value})} /></div>
            </div>
            <div className="grid gap-1"><Label className="text-xs">Type</Label>
              <Select value={form.type} onValueChange={(v:any) => setForm({...form, type: v})}><SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="class">Class</SelectItem><SelectItem value="assignment">Assignment</SelectItem><SelectItem value="working">Working Task</SelectItem><SelectItem value="goal">Goal Task</SelectItem><SelectItem value="freetime">Free Time</SelectItem></SelectContent></Select>
            </div>
          </div>
          <DialogFooter className="flex justify-between w-full pt-2">
            {dialogMode === "edit" ? <Button variant="destructive" size="sm" onClick={() => { removeEvent(selectedEventId!); setShowDialog(false); }}><Trash2 className="h-4 w-4"/></Button> : <div/>}
            <div className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => setShowDialog(false)}>Cancel</Button><Button size="sm" onClick={saveEvent}>{dialogMode === "create" ? "Add" : "Save"}</Button></div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TimeIndicator({ currentWeekStart, focusedDay, viewMode, startHour }: { currentWeekStart: Date, focusedDay: Date, viewMode: "week" | "day", startHour: number }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(i); }, []);
  const top = ((now.getHours() * 60 + now.getMinutes()) / 60 - startHour) * HOUR_HEIGHT;
  if (top < 0 || top > 24 * HOUR_HEIGHT) return null;
  const left = viewMode === "week" ? (now.getDay() * (100/7)) : 0, width = viewMode === "week" ? (100/7) : 100;
  if (viewMode === "week" && (now < currentWeekStart || now >= addDays(currentWeekStart, 7))) return null;
  if (viewMode === "day" && !isSameDay(now, focusedDay)) return null;
  return (
    <div className="absolute right-0 pointer-events-none z-30 flex items-center" style={{ top: `${top}px`, left: `${left}%`, width: `${width}%` }}>
      <div className="h-1.5 w-1.5 rounded-full bg-red-500 -ml-0.5" />
      <div className="h-[1px] flex-1 bg-red-500" />
    </div>
  );
}
