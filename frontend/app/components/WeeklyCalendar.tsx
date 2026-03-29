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
  CheckCircle2, 
  Sparkles
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
const HOUR_HEIGHT = 100; 

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
    const wakeH = parseInt(userProfile.wakeTime.split(":")[0]) || 7;
    const sleepH = parseInt(userProfile.sleepTime.split(":")[0]) || 23;
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
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const scrollPos = ((currentMinutes / 60) - startHour) * HOUR_HEIGHT - 150;
      scrollContainerRef.current.scrollTop = Math.max(0, scrollPos);
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
      toast.success("Flow adjusted.");
    }
    setDraggingId(null); setDragPreview(null);
  };

  const saveEvent = async () => {
    const start = new Date(`${form.date}T${form.startTime}`), end = new Date(`${form.date}T${form.endTime}`);
    if (end <= start) return toast.error("Time must flow forward.");
    if (dialogMode === "create") await addEvent({ title: form.title, start, end, type: form.type, xpValue: 10, completed: false });
    else if (selectedEventId) await updateEvent(selectedEventId, { title: form.title, start, end, type: form.type });
    setShowDialog(false);
  };

  const getEventStyle = (e: CalendarEvent | DragState, day: Date, col: number = 0, total: number = 1) => {
    const start = new Date(e.start), end = new Date(e.end);
    const dayStart = startOfDay(day), dayEnd = addDays(dayStart, 1);
    const effectiveStart = start < dayStart ? dayStart : start, effectiveEnd = end > dayEnd ? dayEnd : end;
    const startMinutes = (effectiveStart.getHours() * 60 + effectiveStart.getMinutes());
    const top = ((startMinutes / 60) - startHour) * HOUR_HEIGHT;
    const height = Math.max(differenceInMinutes(effectiveEnd, effectiveStart) / 60 * HOUR_HEIGHT, 40);
    
    // Step 4: Natural Layering - Stacking Logic
    // Overlapping events get 85% width and offset by column index
    const width = total > 1 ? 85 : 94;
    const offset = total > 1 ? (col * (15 / (total - 1))) : 3;

    return {
      top: `${top}px`, height: `${height}px`,
      left: `${offset}%`,
      width: `${width}%`,
      zIndex: 10 + col, // Higher column index = on top
    };
  };

  const getColor = (type: string, date: Date, completed?: boolean) => {
    const now = new Date();
    const isPastEvent = isPast(new Date(date)) && !isSameDay(new Date(date), now);
    
    const map: Record<string, string> = {
      working: "bg-[#F5DD90] text-[#0F2027]",
      class: "bg-[#F5DD90] text-[#0F2027]",
      freetime: "bg-[#883677] text-[#DAF1DE]",
      goal: "bg-[#F68E5F] text-[#0F2027]",
      assignment: "bg-[#911818] text-[#DAF1DE]",
      external: "bg-[#911818] text-[#DAF1DE]",
    };
    
    const base = map[type] || "bg-[#28623A]/40 text-[#DAF1DE]";
    return cn(base, (isPastEvent || completed) && "opacity-20 grayscale");
  };

  const acceptedCount = pendingSuggestions.filter(s => s.status === "accepted").length;

  return (
    <div className="flex flex-col h-full bg-transparent font-sans">
      <div className="flex items-center justify-between mb-16">
        <div className="flex items-center gap-12">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate("prev")} className="p-4 rounded-full hover:bg-white/5 transition-all"><ChevronLeft className="h-6 w-6 opacity-30" /></button>
            <h2 className="text-5xl font-medium tracking-tighter">{viewMode === "week" ? format(currentWeekStart, "MMMM") : format(focusedDay, "MMMM d")}</h2>
            <button onClick={() => navigate("next")} className="p-4 rounded-full hover:bg-white/5 transition-all"><ChevronRight className="h-6 w-6 opacity-30" /></button>
          </div>
          
          <div className="flex bg-white/[0.03] p-1.5 rounded-full backdrop-blur-xl border border-white/5">
            <button onClick={() => setViewMode("day")} className={cn("h-11 px-10 text-[11px] font-black uppercase tracking-[0.2em] transition-all rounded-full", viewMode === "day" ? "bg-[#DAF1DE] text-[#0F2027] shadow-2xl" : "text-[#DAF1DE]/40 hover:text-[#DAF1DE]")}>Day</button>
            <button onClick={() => setViewMode("week")} className={cn("h-11 px-10 text-[11px] font-black uppercase tracking-[0.2em] transition-all rounded-full", viewMode === "week" ? "bg-[#DAF1DE] text-[#0F2027] shadow-2xl" : "text-[#DAF1DE]/40 hover:text-[#DAF1DE]")}>Week</button>
          </div>
        </div>

        {acceptedCount > 0 && (
          <button onClick={confirmAllSuggestions} className="h-16 px-12 rounded-full bg-primary text-primary-foreground font-black uppercase tracking-widest text-[11px] shadow-4xl hover:scale-105 transition-all">
            Confirm Flow ({acceptedCount})
          </button>
        )}
      </div>

      <div className="grid grid-cols-[120px_1fr] mb-12">
        <div />
        <div className={cn("grid", viewMode === "week" ? "grid-cols-7" : "grid-cols-1")}>
          {visibleDays.map(day => (
            <div key={day.toISOString()} className={cn("flex flex-col items-center justify-center transition-all", isSameDay(day, new Date()) ? "scale-110" : "opacity-30")}>
              <span className="text-[11px] font-bold uppercase tracking-[0.4em] mb-3 opacity-40">{format(day, "EEE")}</span>
              <span className="text-4xl font-light tracking-tighter">{format(day, "d")}</span>
              {isSameDay(day, new Date()) && <div className="h-1.5 w-1.5 rounded-full bg-primary mt-4" />}
            </div>
          ))}
        </div>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto relative select-none pr-6 custom-scrollbar overflow-x-hidden">
        <div className="grid grid-cols-[120px_1fr]">
          <div className="pr-12">
            {visibleHours.map(h => (
              <div key={h} className="h-[100px] text-[11px] font-bold text-muted-foreground/40 text-right uppercase tracking-[0.3em] border-b border-white/[0.02]">
                {format(setHours(new Date(), h), "ha")}
              </div>
            ))}
          </div>

          <div className={cn("relative grid gap-8", viewMode === "week" ? "grid-cols-7" : "grid-cols-1")} style={{ height: `${visibleHours.length * HOUR_HEIGHT}px` }}>
            {visibleDays.map(day => {
              const items = getPositionedItems(day);
              return (
                <div key={day.toISOString()} className={cn("relative h-full transition-all", isSameDay(day, new Date()) ? "bg-primary/[0.03] rounded-[3rem]" : "")} onClick={(e) => onGridClick(day, e)} onDragOver={(e) => onDragOver(e, day)} onDrop={onDrop}>
                  {visibleHours.map(h => <div key={h} className="h-[100px] border-b border-white/5" />)}

                  {items.map(item => {
                    const style = getEventStyle(item, day, item.column, item.totalColumns);
                    if (parseFloat(style.top) < 0 || parseFloat(style.top) > visibleHours.length * HOUR_HEIGHT) return null;
                    return (
                      <div key={item.id} draggable onDragStart={(e) => onDragStart(e, item.id)} onDragEnd={() => {setDraggingId(null); setDragPreview(null);}}
                           className={cn("event-block absolute rounded-[2rem] p-6 text-[11px] leading-snug transition-all duration-500 cursor-pointer group select-none shadow-2xl border-none", getColor(item.type, item.start, item.completed), item.isSuggestion && "bg-transparent border-2 border-dashed border-white/10 text-white/40 backdrop-blur-md")}
                           style={style} onClick={(e) => onEventClick(e, item)}>
                        <div className={cn("font-light text-[15px] tracking-tight mb-1 truncate", item.completed && "opacity-40")}>{item.title}</div>
                        <div className="text-[10px] font-medium uppercase tracking-[0.1em] opacity-40">{format(new Date(item.start), "h:mm a")}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <TimeIndicator currentWeekStart={currentWeekStart} focusedDay={focusedDay} viewMode={viewMode} startHour={startHour} />
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[500px] border-none rounded-[4rem] bg-card/95 backdrop-blur-3xl shadow-4xl p-16">
          <DialogHeader><DialogTitle className="text-5xl font-black tracking-tighter mb-12">{dialogMode === "create" ? "Focus." : "Detail."}</DialogTitle></DialogHeader>
          <div className="space-y-12">
            <div className="space-y-4"><Label className="ml-4">Activity</Label><Input value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="h-20 bg-white/[0.02] border-none rounded-[2rem] text-2xl px-10" /></div>
            <div className="grid grid-cols-2 gap-10">
              <div className="space-y-4"><Label className="ml-4">Start</Label><Input type="time" value={form.startTime} onChange={e => setForm({...form, startTime: e.target.value})} className="h-20 bg-white/[0.02] border-none rounded-[2rem] px-10 text-xl font-bold" /></div>
              <div className="space-y-4"><Label className="ml-4">End</Label><Input type="time" value={form.endTime} onChange={e => setForm({...form, endTime: e.target.value})} className="h-20 bg-white/[0.02] border-none rounded-[2rem] px-10 text-xl font-bold" /></div>
            </div>
            <div className="flex gap-6 pt-12">
              {dialogMode === "edit" && <Button variant="ghost" className="h-20 rounded-[2rem] text-destructive hover:bg-destructive/10 px-10" onClick={() => { removeEvent(selectedEventId!); setShowDialog(false); }}><Trash2 className="h-8 w-8" /></Button>}
              <Button onClick={saveEvent} className="h-20 rounded-[2rem] flex-1 font-black uppercase tracking-[0.2em] text-[12px]">Set Path</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showSuggestionDialog} onOpenChange={setShowSuggestionDialog}>
        <DialogContent className="sm:max-w-[550px] border-none rounded-[4rem] bg-card shadow-4xl p-0 overflow-hidden">
          <div className="bg-primary/5 p-16"><div className="flex items-center gap-4 mb-6"><Sparkles className="text-primary h-8 w-8" /><span className="text-[12px] font-black uppercase tracking-[0.4em] opacity-40 text-primary">Suggestion</span></div><h2 className="text-5xl font-black tracking-tighter leading-none">{selectedSuggestion?.title}</h2></div>
          <div className="p-16 space-y-12"><p className="text-xl opacity-50 leading-relaxed font-medium">A space intelligently carved out for your focus and growth.</p><div className="grid gap-6"><Button onClick={() => { if (selectedSuggestion) { updatePendingSuggestionStatus(selectedSuggestion.id, "accepted"); setShowSuggestionDialog(false); } }} className="h-20 rounded-[2rem] font-black uppercase tracking-[0.2em] text-[12px]">Add to my day</Button><div className="grid grid-cols-2 gap-6"><Button variant="ghost" onClick={() => { if (selectedSuggestion) { refreshSuggestion(selectedSuggestion.id); setShowSuggestionDialog(false); } }} className="h-16 rounded-[1.5rem] font-bold bg-white/5">Refresh</Button><Button variant="ghost" onClick={() => { if (selectedSuggestion) { updatePendingSuggestionStatus(selectedSuggestion.id, "rejected"); setShowSuggestionDialog(false); } }} className="h-16 rounded-[1.5rem] font-bold bg-white/2 hover:bg-destructive/10 hover:text-destructive">Skip</Button></div></div></div>
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
  return (<div className="absolute right-0 pointer-events-none z-30 flex items-center" style={{ top: `${top}px`, left: `${left}%`, width: `${width}%` }}><div className="h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_20px_var(--color-primary)] -ml-1.5" /><div className="h-[1px] flex-1 bg-gradient-to-r from-primary/60 to-transparent" /></div>);
}
