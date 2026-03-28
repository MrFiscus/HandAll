import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { useAppStore, CalendarEvent } from "../store/useAppStore";
import { Check, X, XCircle, Calendar, Clock, Loader2 } from "lucide-react";
import { format, addDays } from "date-fns";
import { toast } from "sonner";

interface SuggestedTask extends CalendarEvent {
  status: "pending" | "accepted" | "rejected";
  isImportant?: boolean;
}

export default function WeeklySync() {
  const { addEvent, runWeeklySync } = useAppStore();
  const [stage, setStage] = useState<"assignments" | "suggestions">("assignments");
  const [loading, setLoading] = useState(false);
  const [assignments, setAssignments] = useState<
    Array<{ id: string; title: string; dueDate: Date; estimatedHours: number }>
  >([
    {
      id: "1",
      title: "Physics Lab Report",
      dueDate: addDays(new Date(), 5),
      estimatedHours: 0,
    },
    {
      id: "2",
      title: "Math Problem Set",
      dueDate: addDays(new Date(), 3),
      estimatedHours: 0,
    },
    {
      id: "3",
      title: "Literature Essay",
      dueDate: addDays(new Date(), 7),
      estimatedHours: 0,
    },
  ]);

  const [suggestedTasks, setSuggestedTasks] = useState<SuggestedTask[]>([]);

  const handleEstimateChange = (id: string, hours: number) => {
    setAssignments(
      assignments.map((a) =>
        a.id === id ? { ...a, estimatedHours: hours } : a
      )
    );
  };

  const handleAIEstimate = (id: string) => {
    const estimates = [3, 4, 5, 6];
    const randomEstimate = estimates[Math.floor(Math.random() * estimates.length)];
    handleEstimateChange(id, randomEstimate);
    toast.success(`AI estimated ${randomEstimate} hours for this task`);
  };

  const proceedToSuggestions = async () => {
    if (assignments.some((a) => a.estimatedHours === 0)) {
      toast.error("Please estimate hours for all assignments");
      return;
    }
    
    setLoading(true);
    try {
        const payload = assignments.map(a => ({ title: a.title, hours: a.estimatedHours }));
        const suggestions = await runWeeklySync(payload);
        setSuggestedTasks(suggestions.map(s => ({ ...s, status: 'pending' })));
        setStage("suggestions");
    } catch (e) {
        toast.error("Failed to generate suggestions");
    } finally {
        setLoading(false);
    }
  };

  const handleAcceptTask = async (taskId: string) => {
    const task = suggestedTasks.find((t) => t.id === taskId);
    if (task) {
      await addEvent({
        title: task.title,
        start: task.start,
        end: task.end,
        type: task.type,
        xpValue: task.xpValue,
      });
      
      setSuggestedTasks(
        suggestedTasks.map((t) =>
          t.id === taskId ? { ...t, status: "accepted" } : t
        )
      );
      toast.success("Task added to your calendar!");
    }
  };

  const handleRejectTask = (taskId: string) => {
    const task = suggestedTasks.find((t) => t.id === taskId);
    setSuggestedTasks(
      suggestedTasks.map((t) =>
        t.id === taskId ? { ...t, status: "rejected" } : t
      )
    );
    toast.info("Task rejected");
  };

  const handleRemoveTask = (taskId: string) => {
    setSuggestedTasks(suggestedTasks.filter((t) => t.id !== taskId));
    toast.success("Time slot freed up");
  };

  const finishSync = () => {
    const acceptedTasks = suggestedTasks.filter((t) => t.status === "accepted");
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
              How long will each assignment take? (AI can estimate for you)
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
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
                    AI Estimate
                  </Button>
                </div>
              </div>
            ))}

            <Button onClick={proceedToSuggestions} className="w-full" size="lg" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {loading ? "Generating Suggestions..." : "Continue to Task Suggestions"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Suggested Tasks</CardTitle>
            <p className="text-sm text-muted-foreground">
              Review and accept/reject suggested tasks. AI schedules only 50% of your free time.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {suggestedTasks.map((task) => (
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