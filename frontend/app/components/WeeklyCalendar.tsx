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
  isPast,
} from "date-fns";
import { 
  ChevronLeft, 
  ChevronRight, 
  Trash2, 
  Sparkles,
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
const HOUR_HEIGHT = 52; // GCal vertical density

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

export default function WeeklyCalendar({ viewMode: externalViewMode, setViewMode: externalSetViewMode }: { viewMode?: "week" | "day", setViewMode?: (mode: "week" | "day") => void }) {
  const { 
    events, 
    userProfile,
    addEvent, 
    updateEvent, 
    removeEvent,
    pendingSuggestions,
    updatePendingSuggestionStatus,
    updatePendingSuggestion,
    refreshSuggestion,
    confirmAllSuggestions
  } = useAppStore();
  
  const [internalViewMode, internalSetViewMode] = useState<"week" | "day">("week");
  const viewMode = externalViewMode ?? internalViewMode;
  const setViewMode = externalSetViewMode ?? internalSetViewMode;

  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 0 }));
  const [focusedDay, setFocusedDay] = useState(new Date());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const { startHour, visibleHours } = useMemo(() => {
    const wakeH = parseInt(userProfile.wakeTime?.split(":")[0]) || 7;
    const sleepH = parseInt(userProfile.sleepTime?.split(":")[0]) || 23;
    const start = Math.max(0, wakeH - 1);
    const end = Math.min(24, sleepH + 1);
    const hours = [];
    for (let i = start; i < end; i++) hours.push(i);
    return { startHour: start, visibleHours: hours };
  }, [userProfile.wakeTime, userProfile.sleepTime]);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragState | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [showSuggestionDialog, setShowSuggestionDialog] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState<SuggestedTask | null>(null);
  
  const [form, setForm] = useState({ title: "", date: format(new Date(), "yyyy-MM-dd"), startTime: "09:00", endTime: "10:00", type: "assignment" as CalendarEvent["type"] });

  const visibleDays = useMemo(() => {
    if (viewMode === "day") return [focusedDay];
    return Array.from({ length: DAYS_IN_WEEK }, (_, i) => addDays(currentWeekStart, i));
  }, [currentWeekStart, focusedDay, viewMode]);

  useEffect(() => {
    if (scrollContainerRef.current) {
      const now = new Date();
      const scrollPos = Math.max(0, (now.getHours() - 2 - startHour) * HOUR_HEIGHT);
      scrollContainerRef.current.scrollTop = scrollPos;
    }
  }, [startHour]);

  const navigate = (dir: "prev" | "next" | "today") => {
    if (dir === "today") {
      const today = new Date();
      setCurrentWeekStart(startOfWeek(today, { weekStartsOn: 0 }));
      setFocusedDay(today);
    } else {
      if (viewMode === "week") setCurrentWeekStart(prev => addDays(prev, dir === "next" ? 7 : -7));
      else setFocusedDay(prev => addDays(prev, dir === "next" ? 1 : -1));
    }
  };

  const getPositionedItems = (day: Date): PositionedItem[] => {
    const dayStart = startOfDay(day), dayEnd = addDays(dayStart, 1);
    const combinedItems: PositionedItem[] = [
      ...events.map(e => ({ ...e, isSuggestion: false })),
      ...pendingSuggestions.filter(s => s.status !== "rejected").map(s => ({ ...s, isSuggestion: true }))
    ];

    const dayItems = combinedItems
      .filter(item => {
        const s = new Date(item.start), en = new Date(item.end);
        return s < dayEnd && en > dayStart;
      })
      .map(item => {
        const s = new Date(item.start), en = new Date(item.end);
        return { ...item, vStart: s < dayStart ? dayStart : s, vEnd: en > dayEnd ? dayEnd : en };
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
    setForm({ title: "", date: format(day, "yyyy-MM-dd"), startTime: format(setMinutes(setHours(new Date(), Math.floor(snapped/60)), snapped%60), "HH:mm"), endTime: format(setMinutes(setHours(new Date(), Math.floor((snapped+60)/60)), (snapped+60)%60), "HH:mm"), type: "assignment" });
    setShowDialog(true);
  };

  const onEventClick = (e: React.MouseEvent, item: PositionedItem) => {
    e.stopPropagation();
    if (item.isSuggestion) {
      const sug = pendingSuggestions.find(s => s.id === item.id);
      if (sug) { setSelectedSuggestion(sug); setShowSuggestionDialog(true); }
      return;
    }
    setDialogMode("edit");
    setSelectedEventId(item.id);
    setForm({ title: item.title, date: format(new Date(item.start), "yyyy-MM-dd"), startTime: format(new Date(item.start), "HH:mm"), endTime: format(new Date(item.end), "HH:mm"), type: item.type });
    setShowDialog(true);
  };

  const onDragStart = (e: React.DragEvent, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    const img = new Image(); img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    e.dataTransfer.setDragImage(img, 0, 0);
  };

  const onDragOver = (e: React.DragEvent, day: Date) => {
    e.preventDefault(); if (!draggingId) return;
    const item = pendingSuggestions.find(s => s.id === draggingId) || events.find(ev => ev.id === draggingId);
    if (!item) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = ((e.clientY - rect.top) / HOUR_HEIGHT) * 60;
    const snapped = Math.round(minutes / 15) * 15 + (startHour * 60);
    const duration = differenceInMinutes(new Date(item.end), new Date(item.start));
    const newStart = startOfDay(day); newStart.setHours(Math.floor(snapped / 60)); newStart.setMinutes(snapped % 60);
    setDragPreview({ id: draggingId, day, start: newStart, end: addMinutes(newStart, duration), isSuggestion: !!pendingSuggestions.find(s => s.id === draggingId) });
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (draggingId && dragPreview) {
      if (dragPreview.isSuggestion) updatePendingSuggestion(draggingId, { start: dragPreview.start, end: dragPreview.end });
      else await updateEvent(draggingId, { start: dragPreview.start, end: dragPreview.end });
      toast.success("Event updated.");
    }
    setDraggingId(null); setDragPreview(null);
  };

  const saveEvent = async () => {
    const start = new Date(`${form.date}T${form.startTime}`), end = new Date(`${form.date}T${form.endTime}`);
    if (end <= start) return toast.error("End time must be after start time.");
    if (dialogMode === "create") await addEvent({ title: form.title, start, end, type: form.type, xpValue: 10, completed: false });
    else if (selectedEventId) await updateEvent(selectedEventId, { title: form.title, start, end, type: form.type });
    setShowDialog(false);
  };

  const getEventStyle = (item: PositionedItem | DragState, day: Date) => {
    const start = new Date(item.start), end = new Date(item.end);
    const dayStart = startOfDay(day);
    const top = (differenceInMinutes(start, addMinutes(dayStart, startHour * 60)) / 60) * HOUR_HEIGHT;
    const height = (differenceInMinutes(end, start) / 60) * HOUR_HEIGHT;
    
    const col = 'column' in item ? item.column : 0;
    const totalColumns = 'totalColumns' in item ? item.totalColumns : 1;
    const width = 100 / totalColumns;
    const offset = col * width;

    return {
      top: `${top}px`,
      height: `${height}px`,
      left: `${offset}%`,
      width: `calc(${width}% - 2px)`,
      zIndex: 10 + col,
    };
  };

  const getTaskVisuals = (type: string, date: Date, completed?: boolean) => {
    const now = new Date();
    const isPastEvent = isPast(new Date(date)) && !isSameDay(new Date(date), now);
    const map: Record<string, { bg: string, text: string }> = {
      working: { bg: "#F5DD90", text: "#0F2027" },
      class: { bg: "#F5DD90", text: "#0F2027" },
      freetime: { bg: "#883677", text: "#DAF1DE" },
      goal: { bg: "#F68E5F", text: "#0F2027" },
      assignment: { bg: "#911818", text: "#DAF1DE" },
      external: { bg: "#911818", text: "#DAF1DE" },
    };
    const visuals = map[type] || { bg: "#475569", text: "#DAF1DE" };
    return {
      style: { backgroundColor: visuals.bg, color: visuals.text },
      className: cn(
        "border border-black/5", // GCal style very subtle borders
        (isPastEvent || completed) && "opacity-50 grayscale"
      )
    };
  };

  const acceptedCount = pendingSuggestions.filter(s => s.status === "accepted").length;

  return (
    <div className="flex flex-col h-full bg-transparent font-sans">
      
      {/* Header Toolbar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("today")} className="font-medium uppercase tracking-widest text-[10px] text-primary hover:bg-white/5 border border-white/10 rounded-md h-8 px-4">Today</Button>
          <div className="flex items-center gap-1">
            <button onClick={() => navigate("prev")} className="p-2 rounded-full hover:bg-white/5 transition-all"><ChevronLeft className="h-5 w-5 text-primary opacity-60" /></button>
            <button onClick={() => navigate("next")} className="p-2 rounded-full hover:bg-white/5 transition-all"><ChevronRight className="h-5 w-5 text-primary opacity-60" /></button>
          </div>
          <h2 className="text-2xl font-normal tracking-tight text-foreground ml-2">
            {viewMode === "week" ? format(currentWeekStart, "MMMM yyyy") : format(focusedDay, "MMMM d, yyyy")}
          </h2>
        </div>
        
        <div className="flex items-center gap-4">
          {acceptedCount > 0 && (
            <Button size="sm" onClick={confirmAllSuggestions} className="rounded-md font-bold uppercase text-[9px] h-8 bg-primary text-primary-foreground px-4">
              Confirm ({acceptedCount})
            </Button>
          )}
          
          <div className="flex bg-white/[0.03] p-1 rounded-md border border-white/5">
            <button 
              onClick={() => setViewMode("day")} 
              className={cn(
                "h-7 px-4 text-[10px] font-bold uppercase tracking-wider transition-all rounded-[4px]",
                viewMode === "day" ? "bg-[#DAF1DE] text-[#0F2027]" : "text-[#DAF1DE]/40 hover:text-[#DAF1DE]"
              )}
            >
              Day
            </button>
            <button 
              onClick={() => setViewMode("week")} 
              className={cn(
                "h-7 px-4 text-[10px] font-bold uppercase tracking-wider transition-all rounded-[4px]",
                viewMode === "week" ? "bg-[#DAF1DE] text-[#0F2027]" : "text-[#DAF1DE]/40 hover:text-[#DAF1DE]"
              )}
            >
              Week
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Time Axis (Left) */}
        <div className="w-[65px] flex-shrink-0 border-r border-white/5 bg-transparent z-20">
          <div className="h-[70px]" /> {/* Header spacer */}
          <div className="relative overflow-hidden" style={{ height: `calc(100% - 70px)` }}>
            <div className="absolute w-full transition-none" style={{ top: `-${scrollContainerRef.current?.scrollTop || 0}px` }}>
              {visibleHours.map(h => (
                <div key={h} className="absolute w-full text-right pr-3 text-[10px] font-normal text-muted-foreground/40 uppercase" style={{ top: `${(h - startHour) * HOUR_HEIGHT - 7}px` }}>
                  {format(setHours(new Date(), h), "h a")}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main Calendar Area */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          
          {/* Day Headers */}
          <div className="flex-shrink-0 grid border-b border-white/5 z-20 bg-transparent" style={{ gridTemplateColumns: `repeat(${viewMode === "week" ? 7 : 1}, minmax(0, 1fr))` }}>
            {visibleDays.map(day => (
              <div key={day.toISOString()} className={cn("flex flex-col items-center justify-center h-[70px] border-r border-white/5 last:border-r-0")}>
                <span className={cn("text-[10px] font-medium uppercase tracking-wider mb-1", isSameDay(day, new Date()) ? "text-primary" : "text-muted-foreground/60")}>{format(day, "EEE")}</span>
                <div className={cn("h-9 w-9 flex items-center justify-center rounded-full text-xl font-normal", isSameDay(day, new Date()) ? "bg-primary text-primary-foreground" : "text-foreground")}>
                  {format(day, "d")}
                </div>
              </div>
            ))}
          </div>

          {/* Scrollable Grid Area */}
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden relative bg-transparent" onScroll={(e) => { 
            const target = e.target as HTMLDivElement;
            const timeAxis = target.parentElement?.previousElementSibling?.children[1]?.children[0] as HTMLDivElement;
            if (timeAxis) timeAxis.style.top = `-${target.scrollTop}px`;
          }}>
            
            {/* Horizontal Grid Lines */}
            <div className="absolute inset-0 pointer-events-none z-0">
               {visibleHours.map(h => (
                  <div key={h} className="border-b border-white/[0.03] w-full" style={{ height: `${HOUR_HEIGHT}px` }} />
               ))}
            </div>

            {/* Vertical Columns and Events */}
            <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${viewMode === "week" ? 7 : 1}, minmax(0, 1fr))`, height: `${visibleHours.length * HOUR_HEIGHT}px` }}>
              {visibleDays.map(day => {
                const items = getPositionedItems(day);
                return (
                  <div key={day.toISOString()} className={cn("relative h-full border-r border-white/5 last:border-r-0 transition-all", isSameDay(day, new Date()) ? "bg-white/[0.01]" : "")} onClick={(e) => onGridClick(day, e)} onDragOver={(e) => onDragOver(e, day)} onDrop={onDrop}>
                    
                    {items.map(item => {
                      const style = getEventStyle(item, day);
                      const visuals = getTaskVisuals(item.type, item.start, item.completed);
                      return (
                        <div key={item.id} draggable onDragStart={(e) => onDragStart(e, item.id)} onDragEnd={() => {setDraggingId(null); setDragPreview(null);}}
                             className={cn("event-block absolute rounded-[4px] px-2 py-1 text-[11px] leading-tight cursor-pointer overflow-hidden group select-none transition-all", visuals.className, item.isSuggestion && "border-2 border-dashed border-white/30 bg-transparent! text-white/60")}
                             style={{ ...style, ...visuals.style }} onClick={(e) => onEventClick(e, item)}>
                          <div className={cn("font-medium truncate mb-0.5", item.completed && "line-through")}>{item.title}</div>
                          <div className="text-[10px] font-normal opacity-70 truncate">{format(new Date(item.start), "h:mm a")}</div>
                          
                          {item.isSuggestion && item.status === "pending" && viewMode === "day" && (
                            <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-all bg-black/40 rounded p-0.5">
                              <button onClick={(e) => { e.stopPropagation(); updatePendingSuggestionStatus(item.id, "accepted"); }} className="p-0.5 hover:text-green-400"><Check className="h-3 w-3" /></button>
                              <button onClick={(e) => { e.stopPropagation(); updatePendingSuggestionStatus(item.id, "rejected"); }} className="p-0.5 hover:text-red-400"><X className="h-3 w-3" /></button>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {dragPreview && isSameDay(dragPreview.day, day) && (
                      <div className="absolute rounded-[4px] border-2 border-dashed border-white/30 bg-white/5 p-2 text-[11px] z-50 opacity-40 pointer-events-none" style={getEventStyle(dragPreview, day)}>
                         <div className="font-normal">{(events.find(e => e.id === draggingId) || pendingSuggestions.find(s => s.id === draggingId))?.title}</div>
                      </div>
                    )}
                  </div>
                );
              })}
              <TimeIndicator currentWeekStart={currentWeekStart} focusedDay={focusedDay} viewMode={viewMode} startHour={startHour} />
            </div>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[450px] border border-white/10 rounded-xl bg-card shadow-2xl p-8">
          <DialogHeader><DialogTitle className="text-2xl font-medium tracking-tight mb-6">{dialogMode === "create" ? "Add event" : "Edit event"}</DialogTitle></DialogHeader>
          <div className="space-y-6">
            <Input value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="h-12 bg-white/[0.02] border-white/10 rounded-md text-lg px-4 text-foreground" placeholder="Add title" autoFocus/>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2"><Label className="text-xs font-normal opacity-60">Start</Label><Input type="time" value={form.startTime} onChange={e => setForm({...form, startTime: e.target.value})} className="h-11 bg-white/[0.02] border-white/10 rounded-md px-4 font-normal" /></div>
              <div className="space-y-2"><Label className="text-xs font-normal opacity-60">End</Label><Input type="time" value={form.endTime} onChange={e => setForm({...form, endTime: e.target.value})} className="h-11 bg-white/[0.02] border-white/10 rounded-md px-4 font-normal" /></div>
            </div>
            <div className="flex gap-3 pt-6 border-t border-white/5">
              {dialogMode === "edit" && <Button variant="ghost" className="h-11 rounded-md text-destructive hover:bg-destructive/10" onClick={() => { removeEvent(selectedEventId!); setShowDialog(false); }}>Delete</Button>}
              <div className="flex-1" />
              <Button variant="ghost" className="h-11 rounded-md px-6 font-normal" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button onClick={saveEvent} className="h-11 rounded-md px-8 font-medium bg-primary text-primary-foreground">Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showSuggestionDialog} onOpenChange={setShowSuggestionDialog}>
        <DialogContent className="sm:max-w-[450px] border border-white/10 rounded-xl bg-card shadow-2xl p-8">
          <DialogHeader className="mb-6">
            <div className="flex items-center gap-2 text-primary mb-2">
              <Sparkles className="h-4 w-4" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Recommendation</span>
            </div>
            <DialogTitle className="text-3xl font-medium tracking-tight">{selectedSuggestion?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-8">
            <p className="text-base opacity-60 leading-relaxed font-normal">A recommended task to help you maintain balance and focus.</p>
            <div className="flex gap-3">
              <Button className="flex-1 h-12 rounded-md font-medium bg-primary text-primary-foreground" onClick={() => { if (selectedSuggestion) { updatePendingSuggestionStatus(selectedSuggestion.id, "accepted"); setShowSuggestionDialog(false); } }}>Add to day</Button>
              <Button variant="outline" className="h-12 rounded-md border-white/10 text-foreground hover:bg-white/5" onClick={() => { if (selectedSuggestion) { refreshSuggestion(selectedSuggestion.id); setShowSuggestionDialog(false); } }}>Refresh</Button>
              <Button variant="outline" className="h-12 rounded-md border-white/10 text-destructive hover:bg-destructive/10" onClick={() => { if (selectedSuggestion) { updatePendingSuggestionStatus(selectedSuggestion.id, "rejected"); setShowSuggestionDialog(false); } }}>Skip</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TimeIndicator({ currentWeekStart, focusedDay, viewMode, startHour }: { currentWeekStart: Date, focusedDay: Date, viewMode: "week" | "day", startHour: number }) {
  const [now, setNow] = useState(new Date()); useEffect(() => { const i = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(i); }, []);
  const top = ((now.getHours() * 60 + now.getMinutes()) / 60 - startHour) * HOUR_HEIGHT;
  if (top < 0 || top > 24 * HOUR_HEIGHT) return null; 
  const left = viewMode === "week" ? (now.getDay() * (100/7)) : 0, width = viewMode === "week" ? (100/7) : 100;
  if (viewMode === "week" && (now < currentWeekStart || now >= addDays(currentWeekStart, 7))) return null;
  if (viewMode === "day" && !isSameDay(now, focusedDay)) return null;
  return (<div className="absolute right-0 pointer-events-none z-40 flex items-center" style={{ top: `${top}px`, left: `${left}%`, width: `${width}%` }}><div className="h-2 w-2 rounded-full bg-red-500 shadow-xl -ml-1" /><div className="h-[1.5px] flex-1 bg-red-500/60" /></div>);
}
