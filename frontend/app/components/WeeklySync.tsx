import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { useAppStore, CalendarEvent, SuggestedTask } from "../store/useAppStore";
import { Check, X, XCircle, Calendar, Clock, Loader2, Sparkles } from "lucide-react";
import { format, isAfter } from "date-fns";
import { toast } from "sonner";

interface AssignmentInput {
  id: string;
  title: string;
  description: string;
  dueDate: Date;
  estimatedHours: number;
  estimateReason?: string;
}

const AGENT_USER_ID_KEY = "handall-agent-user-id";

export default function WeeklySync() {
  const {
    addEvent,
    events,
    userProfile,
    lastMotivation,
    runWeeklySync,
    loadAppData,
    apiLoaded,
    pendingSuggestions,
    setPendingSuggestions,
    updatePendingSuggestionStatus,
    removePendingSuggestion,
  } = useAppStore();
  const [stage, setStage] = useState<"assignments" | "suggestions">("assignments");
  const [loading, setLoading] = useState(false);
  const [assignments, setAssignments] = useState<AssignmentInput[]>([]);

  useEffect(() => {
    if (!apiLoaded) {
      loadAppData();
    }
  }, [apiLoaded, loadAppData]);

  const importedAssignments = useMemo(() => {
    return events
      .filter((event) => event.type === "assignment" && !event.completed && isAfter(new Date(event.start), new Date()))
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .map((event) => ({
        id: event.id,
        title: event.title,
        description: event.description || "",
        dueDate: new Date(event.start),
        estimatedHours: 0,
      }));
  }, [events]);

  useEffect(() => {
    if (assignments.length === 0 && importedAssignments.length > 0) {
      setAssignments(importedAssignments);
    }
  }, [assignments.length, importedAssignments]);

  useEffect(() => {
    if (pendingSuggestions.length > 0) {
      setStage("suggestions");
    }
  }, [pendingSuggestions.length]);

  const handleEstimateChange = (id: string, hours: number) => {
    setAssignments(
      assignments.map((a) =>
        a.id === id ? { ...a, estimatedHours: hours } : a
      )
    );
  };

  const handleAIEstimate = (id: string) => {
    const assignment = assignments.find((item) => item.id === id);
    if (!assignment) return;

    const combined = `${assignment.title} ${assignment.description}`.toLowerCase();
    let estimate = 2;

    if (/(midterm|final|exam)/.test(combined)) estimate = 4;
    else if (/(project|implementation|simulator|hash table|openmp|shell)/.test(combined)) estimate = 5;
    else if (/(lab report|report due)/.test(combined)) estimate = 3;
    else if (/(discussion post|resume review)/.test(combined)) estimate = 1;
    else if (/(quiz)/.test(combined)) estimate = 2;
    else if (/(assignment|homework)/.test(combined)) estimate = 3;

    setAssignments(
      assignments.map((item) =>
        item.id === id
          ? { ...item, estimatedHours: estimate, estimateReason: "Quick local estimate. Weekly planning will refine it with AI." }
          : item
      )
    );
    toast.success(`Estimated ${estimate} hours for this task`);
  };

  const proceedToSuggestions = async () => {
    if (assignments.length === 0) {
      toast.error("Import assignment deadlines from your calendar first.");
      return;
    }
    
    setLoading(true);
    try {
        const userId = localStorage.getItem(AGENT_USER_ID_KEY) ?? crypto.randomUUID();
        localStorage.setItem(AGENT_USER_ID_KEY, userId);

        const result = await runWeeklySync({
          userId,
          name: userProfile.name || "Student",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          wakeTime: userProfile.wakeTime,
          sleepTime: userProfile.sleepTime,
          sideGoals: userProfile.sideGoals,
          motivation: lastMotivation,
          events,
          assignments,
        });

        setAssignments(
          result.assignments.map((assignment) => ({
            id: assignment.id,
            title: assignment.title,
            description: assignment.description,
            dueDate: new Date(assignment.due_date),
            estimatedHours: assignment.estimated_hours,
            estimateReason: assignment.estimate_reason,
          }))
        );

        setPendingSuggestions(
          result.suggested_tasks.map((task) => ({
            ...task,
            start: new Date(task.start),
            end: new Date(task.end),
            status: "pending",
          }))
        );
        setStage("suggestions");
    } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to generate suggestions");
    } finally {
        setLoading(false);
    }
  };

  const handleAcceptTask = async (taskId: string) => {
    const task = pendingSuggestions.find((t) => t.id === taskId);
    if (task) {
      await addEvent({
        title: task.title,
        start: task.start,
        end: task.end,
        type: task.type,
        description: task.description,
        xpValue: task.xpValue,
      });
      
      updatePendingSuggestionStatus(taskId, "accepted");
      toast.success("Task added to your calendar!");
    }
  };

  const handleRejectTask = (taskId: string) => {
    updatePendingSuggestionStatus(taskId, "rejected");
    toast.info("Task rejected");
  };

  const handleRemoveTask = (taskId: string) => {
    removePendingSuggestion(taskId);
    toast.success("Time slot freed up");
  };

  const finishSync = () => {
    const acceptedTasks = pendingSuggestions.filter((t) => t.status === "accepted");
    toast.success(`Weekly sync complete! ${acceptedTasks.length} tasks scheduled.`);
    setTimeout(() => {
      window.location.href = "/";
    }, 1500);
  };

  const getTaskColor = (type: string) => {
    switch (type) {
      case "working":
        return "border-orange-500 bg-orange-50";
      case "goal":
        return "border-green-500 bg-green-50";
      case "freetime":
        return "border-purple-500 bg-purple-50";
      default:
        return "border-gray-300";
    }
  };

  const getTaskBadge = (type: string) => {
    switch (type) {
      case "working":
        return "Working Task";
      case "goal":
        return "Goal Task";
      case "freetime":
        return "Free Time";
      default:
        return type;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Weekly Sync</h1>
        <p className="text-muted-foreground">
          Let's plan your week ahead
        </p>
      </div>

      {stage === "assignments" ? (
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Assignments</CardTitle>
            <p className="text-sm text-muted-foreground">
              Pulled from your imported calendar. Leave hours blank if you want the AI planner to estimate them.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
              Motivation score for this planning run: <span className="font-semibold text-foreground">{lastMotivation}</span>/100
              {" • "}
              Side goals in play: <span className="font-semibold text-foreground">{userProfile.sideGoals.length}</span>
            </div>

            {assignments.length === 0 && (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No assignment deadlines found in your imported calendar yet. Import a calendar with due dates first, then come back to Weekly Sync.
              </div>
            )}

            {assignments.map((assignment) => (
              <div
                key={assignment.id}
                className="flex items-center gap-4 p-4 border rounded-lg"
              >
                <div className="flex-1">
                  <h4 className="font-medium">{assignment.title}</h4>
                  <p className="text-sm text-muted-foreground">
                    Due: {format(assignment.dueDate, "MMM d, yyyy")}
                  </p>
                  {assignment.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{assignment.description}</p>
                  )}
                  {assignment.estimateReason && (
                    <p className="mt-1 text-xs text-blue-600">{assignment.estimateReason}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    max="20"
                    value={assignment.estimatedHours || ""}
                    onChange={(e) =>
                      handleEstimateChange(
                        assignment.id,
                        parseInt(e.target.value) || 0
                      )
                    }
                    className="w-20"
                    placeholder="Hours"
                  />
                  <span className="text-sm text-muted-foreground">hours</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAIEstimate(assignment.id)}
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    Quick Estimate
                  </Button>
                </div>
              </div>
            ))}

            <Button onClick={proceedToSuggestions} className="w-full" size="lg" disabled={loading || assignments.length === 0}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {loading ? "Generating Your Week..." : "Generate Working, Goal, and Free Time Tasks"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Suggested Tasks</CardTitle>
            <p className="text-sm text-muted-foreground">
              Review and accept or reject the AI planner suggestions. Only 50% of your free time is used so the rest stays open.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {pendingSuggestions.length === 0 && (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No pending AI task recommendations right now. Generate a weekly plan from the assignments step first.
              </div>
            )}

            {pendingSuggestions.map((task) => (
              <div
                key={task.id}
                className={`p-4 rounded-lg border-2 transition-all ${
                  task.status === "accepted"
                    ? "border-green-500 bg-green-50"
                    : task.status === "rejected"
                    ? "border-red-300 bg-red-50 opacity-50"
                    : getTaskColor(task.type)
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium">{task.title}</h4>
                      <Badge variant="secondary" className="text-xs">
                        {getTaskBadge(task.type)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(task.start, "MMM d")}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {format(task.start, "h:mm a")} - {format(task.end, "h:mm a")}
                      </div>
                      <div className="text-xs">+{task.xpValue} XP</div>
                    </div>
                  </div>

                  {task.status === "pending" && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleAcceptTask(task.id)}
                        className="text-green-600 hover:text-green-700 hover:bg-green-50"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRejectTask(task.id)}
                        className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRemoveTask(task.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  )}

                  {task.status === "accepted" && (
                    <Badge variant="default" className="bg-green-500">
                      <Check className="mr-1 h-3 w-3" />
                      Accepted
                    </Badge>
                  )}

                  {task.status === "rejected" && (
                    <Badge variant="secondary">Rejected</Badge>
                  )}
                </div>
              </div>
            ))}

            <Button onClick={finishSync} className="w-full" size="lg">
              Finish Weekly Sync
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
