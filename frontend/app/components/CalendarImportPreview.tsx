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
    <div className="h-screen overflow-hidden bg-background px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex h-[calc(100vh-2.5rem)] max-w-5xl flex-col gap-5">
        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={handleBack} className="rounded-xl">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={handleClear}
              disabled={isSubmitting}
              className="rounded-xl"
            >
              Clear Preview
            </Button>
            <Button
              onClick={handleImport}
              disabled={isSubmitting}
              className="rounded-xl"
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Import {summary.total} Events
            </Button>
          </div>
        </div>

        <Card className="flex-1 overflow-hidden rounded-[2rem] border border-border/60 bg-card/88 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
          <CardContent className="flex h-full flex-col gap-6 p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <Calendar className="h-5 w-5" />
              </div>
              <div className="space-y-2">
                <h1
                  className="text-3xl font-semibold tracking-tight text-foreground"
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                >
                  Import preview
                </h1>
                <p className="text-sm leading-6 text-muted-foreground">
                  Review the events and converted tasks before adding them to
                  HandAll.
                </p>
                <p className="inline-flex w-fit rounded-full border border-white/10 bg-[#1b4c2f] px-3 py-1.5 font-mono text-xs tracking-[0.03em] text-foreground/85">
                  {previewState.source.startsWith("file://")
                    ? previewState.source.replace("file://", "")
                    : previewState.source}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/8 bg-[#1f5634] p-4 text-center">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Classes
                </p>
                <p className="mt-2 text-3xl font-semibold text-foreground">
                  {summary.classes}
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-[#1f5634] p-4 text-center">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Assignments
                </p>
                <p className="mt-2 text-3xl font-semibold text-foreground">
                  {summary.assignments}
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-[#1f5634] p-4 text-center">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Other events
                </p>
                <p className="mt-2 text-3xl font-semibold text-foreground">
                  {summary.external}
                </p>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col space-y-3">
              <div className="flex items-end justify-between gap-3">
                <p className="text-lg font-semibold text-foreground">
                  Converted task preview
                </p>
                <p className="pr-10 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Difficulty
                </p>
              </div>
              <div className="handall-scrollbar grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1">
                {previewTasks.map((task) => (
                  <div
                    key={task.source_event_id}
                    className="rounded-2xl border border-white/8 bg-[#1f5634] p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-foreground">
                              {task.task_name}
                            </p>
                            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                              {task.category}
                            </p>
                          </div>
                          <span className="text-xs font-semibold uppercase text-muted-foreground">
                            {task.priority}
                          </span>
                        </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {task.details || "No details provided."}
                    </p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {format(new Date(task.due_start), "PPp")} -{" "}
                      {format(new Date(task.due_end), "PPp")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
