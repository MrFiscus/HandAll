import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, Calendar, Loader2 } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useAppStore } from "../store/useAppStore";
import { api } from "../utils/api";
import {
  clearCalendarImportPreviewState,
  readCalendarImportPreviewState,
} from "../utils/calendarImportPreview";
import { clearSetupDraft, readSetupDraft } from "../utils/setupDraft";
import {
  convertCalendarEventsToTaskPreview,
  formatCalendarDateTime,
} from "../utils/calendarSync";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { cn } from "./ui/utils";

export default function CalendarImportPreview() {
  const navigate = useNavigate();
  const { userProfile, setUserProfile, syncCalendarEvents, completeSetup } =
    useAppStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const previewState = useMemo(() => readCalendarImportPreviewState(), []);

  if (!previewState) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-lg rounded-[2rem] border border-border/60 bg-card/90">
          <CardContent className="space-y-4 p-8 text-center">
            <p className="text-xl font-semibold text-foreground">
              No import preview available
            </p>
            <p className="text-sm text-muted-foreground">
              Start a calendar import first, then review it here.
            </p>
            <Button onClick={() => navigate("/setup")}>Back to setup</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const previewTasks = convertCalendarEventsToTaskPreview(previewState.events);
  const summary = {
    total: previewState.events.length,
    classes: previewState.events.filter((event) => event.type === "class").length,
    assignments: previewState.events.filter((event) => event.type === "assignment").length,
    external: previewState.events.filter((event) => event.type === "external").length,
  };

  const handleBack = () => {
    navigate(previewState.returnPath);
  };

  const handleClear = () => {
    clearCalendarImportPreviewState();
    navigate(previewState.returnPath);
  };

  const handleImport = async () => {
    setIsSubmitting(true);
    try {
      const persistenceResult = await api.saveCalendarImportBreakdown({
        sourceUrl: previewState.source,
        importType: previewState.source.startsWith("file://")
          ? "file-upload"
          : "url-sync",
        events: previewState.events.map((event) => ({
          id: event.id,
          title: event.title,
          description: event.description,
          start: formatCalendarDateTime(event.start),
          end: formatCalendarDateTime(event.end),
          type: event.type,
          sourceUrl: event.sourceUrl ?? previewState.source,
        })),
        tasks: previewTasks,
      });

      await syncCalendarEvents(previewState.events, previewState.source);

      if (!userProfile.calendarUrls.includes(previewState.source)) {
        await setUserProfile({
          calendarUrls: [...userProfile.calendarUrls, previewState.source],
        });
      }

      if (previewState.returnPath === "/setup") {
        const setupDraft = readSetupDraft();
        if (setupDraft) {
          const sideGoals = setupDraft.sideGoals
            .split("\n")
            .map((goal) => goal.trim())
            .filter(Boolean);

          await setUserProfile({
            name: setupDraft.name.trim() || "Student",
            wakeTime: setupDraft.wakeTime,
            sleepTime: setupDraft.sleepTime,
            sideGoals,
            motivation: setupDraft.motivation,
          });
        }
        completeSetup();
        clearSetupDraft();
      }

      clearCalendarImportPreviewState();
      toast.success(
        `Imported ${previewState.events.length} events and saved the breakdown to ${persistenceResult.filePath}.`,
      );
      navigate("/");
    } catch (error) {
      console.error("Calendar import error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to import calendar",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-transparent px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto flex h-full max-w-5xl flex-col gap-8">
        <div className="flex items-center justify-between animate-in fade-in slide-in-from-top-4 duration-700">
          <Button variant="ghost" onClick={handleBack} className="rounded-xl hover:bg-white/5 font-bold">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={handleClear}
              disabled={isSubmitting}
              className="rounded-xl text-muted-foreground/40 hover:text-foreground"
            >
              Clear
            </Button>
            <Button
              onClick={handleImport}
              disabled={isSubmitting}
              className="h-12 px-8 rounded-xl font-black uppercase tracking-widest bg-primary text-primary-foreground shadow-2xl transition-all hover:scale-105"
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Import {summary.total} Events
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden rounded-[2.5rem] bg-white/[0.01] border border-white/[0.03] backdrop-blur-md flex flex-col p-8 sm:p-10 space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="flex items-start gap-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-primary/10 text-primary shadow-inner">
              <Calendar className="h-8 w-8" />
            </div>
            <div className="space-y-2">
              <h1 className="text-4xl font-black tracking-tighter text-foreground mb-0">
                Import Preview.
              </h1>
              <p className="text-sm font-medium text-muted-foreground">
                Review the {summary.total} events discovered in your calendar source.
              </p>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/5 bg-white/[0.03] px-4 py-1.5 font-mono text-[10px] tracking-tight text-foreground/60">
                <div className="h-1 w-1 rounded-full bg-primary/40" />
                {previewState.source.startsWith("file://")
                  ? previewState.source.replace("file://", "")
                  : previewState.source}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-[1.5rem] border border-white/5 bg-white/[0.02] p-6 text-center space-y-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">
                Classes
              </p>
              <p className="text-4xl font-black text-primary">
                {summary.classes}
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-white/5 bg-white/[0.02] p-6 text-center space-y-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">
                Assignments
              </p>
              <p className="text-4xl font-black text-primary">
                {summary.assignments}
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-white/5 bg-white/[0.02] p-6 text-center space-y-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">
                Other
              </p>
              <p className="text-4xl font-black text-primary">
                {summary.external}
              </p>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col space-y-6">
            <div className="flex items-end justify-between border-b border-white/5 pb-4">
              <p className="text-sm font-black uppercase tracking-widest text-muted-foreground/60">
                Converted Tasks
              </p>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/30">
                Smart Processing Applied
              </p>
            </div>
            <div className="custom-scrollbar grid min-h-0 flex-1 gap-4 overflow-y-auto pr-2">
              {previewTasks.map((task, idx) => (
                <div
                  key={task.source_event_id}
                  className="rounded-2xl border border-white/5 bg-white/[0.01] p-6 transition-all hover:bg-white/[0.03] animate-in fade-in slide-in-from-bottom-2"
                  style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'both' }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-3 flex-1">
                      <div className="flex items-center gap-3">
                        <p className="text-lg font-bold text-foreground leading-tight">
                          {task.task_name}
                        </p>
                        <div className="px-2 py-0.5 rounded-md bg-white/5 border border-white/5 text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">
                          {task.category}
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground font-medium leading-relaxed max-w-2xl">
                        {task.details || "No details provided."}
                      </p>
                      <div className="flex items-center gap-4 pt-1">
                        <div className="flex items-center gap-2 text-[10px] font-bold text-primary/60">
                          <div className="h-1 w-1 rounded-full bg-primary" />
                          {format(new Date(task.due_start), "MMM d, h:mm a")}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className={cn(
                        "text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full",
                        task.priority === "high" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                      )}>
                        {task.priority}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
