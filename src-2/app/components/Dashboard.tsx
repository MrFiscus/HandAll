import { useState, useMemo, useEffect } from "react";
import { format, startOfWeek, addDays, isSameDay, parseISO } from "date-fns";
import { useAppStore } from "../store/useAppStore";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Plus, Calendar as CalendarIcon, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { toast } from "sonner";
import WelcomeGuide from "./WelcomeGuide";

export default function Dashboard() {
  const { events, userProfile, addEvent, updateEvent, addXP } = useAppStore();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: "",
    date: format(new Date(), "yyyy-MM-dd"),
    startTime: "09:00",
    endTime: "10:00",
    type: "assignment" as const,
  });

  // Add sample events on first load and show welcome guide
  useEffect(() => {
    const hasSeenWelcome = localStorage.getItem("handall-welcome-seen");
    if (!hasSeenWelcome) {
      setShowWelcome(true);
      localStorage.setItem("handall-welcome-seen", "true");
    }

    if (events.length === 0) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const sampleEvents = [
        {
          id: "sample-1",
          title: "Morning Study Session",
          start: new Date(tomorrow.setHours(9, 0, 0, 0)),
          end: new Date(tomorrow.setHours(10, 30, 0, 0)),
          type: "working" as const,
          xpValue: 50,
        },
        {
          id: "sample-2",
          title: userProfile.sideGoals[0] || "Exercise",
          start: new Date(tomorrow.setHours(17, 0, 0, 0)),
          end: new Date(tomorrow.setHours(18, 0, 0, 0)),
          type: "goal" as const,
          xpValue: 30,
        },
      ];
      
      sampleEvents.forEach(event => addEvent(event));
    }
  }, []);

  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 0 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const todayEvents = useMemo(() => {
    return events.filter((event) =>
      isSameDay(new Date(event.start), selectedDate)
    );
  }, [events, selectedDate]);

  const handleAddEvent = () => {
    if (!newEvent.title.trim()) {
      toast.error("Please enter a title");
      return;
    }

    const start = new Date(`${newEvent.date}T${newEvent.startTime}`);
    const end = new Date(`${newEvent.date}T${newEvent.endTime}`);

    addEvent({
      id: Date.now().toString(),
      title: newEvent.title,
      start,
      end,
      type: newEvent.type,
      xpValue: newEvent.type === "working" ? 50 : newEvent.type === "goal" ? 30 : 10,
    });

    toast.success("Event added to calendar!");
    setShowAddEvent(false);
    setNewEvent({
      title: "",
      date: format(new Date(), "yyyy-MM-dd"),
      startTime: "09:00",
      endTime: "10:00",
      type: "assignment",
    });
  };

  const handleCompleteTask = (eventId: string) => {
    const event = events.find(e => e.id === eventId);
    if (event && !event.completed) {
      updateEvent(eventId, { completed: true });
      addXP(event.xpValue || 0);
      toast.success(`+${event.xpValue} XP earned! 🎉`);
    }
  };

  const getEventColor = (type: string) => {
    switch (type) {
      case "class":
        return "bg-blue-500";
      case "assignment":
        return "bg-red-500";
      case "working":
        return "bg-orange-500";
      case "goal":
        return "bg-green-500";
      case "freetime":
        return "bg-purple-500";
      default:
        return "bg-gray-500";
    }
  };

  const getEventBadge = (type: string) => {
    switch (type) {
      case "working":
        return "Working Task";
      case "goal":
        return "Goal Task";
      case "freetime":
        return "Free Time Task";
      default:
        return type.charAt(0).toUpperCase() + type.slice(1);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {showWelcome && <WelcomeGuide onClose={() => setShowWelcome(false)} />}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            {format(selectedDate, "EEEE, MMMM d, yyyy")}
          </p>
        </div>
        <Dialog open={showAddEvent} onOpenChange={setShowAddEvent}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Event
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Event</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={newEvent.title}
                  onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                  placeholder="Math assignment"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={newEvent.date}
                  onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="startTime">Start Time</Label>
                  <Input
                    id="startTime"
                    type="time"
                    value={newEvent.startTime}
                    onChange={(e) => setNewEvent({ ...newEvent, startTime: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endTime">End Time</Label>
                  <Input
                    id="endTime"
                    type="time"
                    value={newEvent.endTime}
                    onChange={(e) => setNewEvent({ ...newEvent, endTime: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">Type</Label>
                <Select value={newEvent.type} onValueChange={(value: any) => setNewEvent({ ...newEvent, type: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="class">Class</SelectItem>
                    <SelectItem value="assignment">Assignment</SelectItem>
                    <SelectItem value="working">Working Task</SelectItem>
                    <SelectItem value="goal">Goal Task</SelectItem>
                    <SelectItem value="freetime">Free Time Task</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleAddEvent} className="w-full">
                Add Event
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Week View */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>This Week</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-2">
              {weekDays.map((day) => {
                const dayEvents = events.filter((event) =>
                  isSameDay(new Date(event.start), day)
                );
                const isToday = isSameDay(day, new Date());
                const isSelected = isSameDay(day, selectedDate);

                return (
                  <button
                    key={day.toISOString()}
                    onClick={() => setSelectedDate(day)}
                    className={`p-3 rounded-lg border transition-all ${
                      isSelected
                        ? "border-blue-500 bg-blue-50"
                        : isToday
                        ? "border-purple-300 bg-purple-50"
                        : "border-border hover:border-gray-300"
                    }`}
                  >
                    <div className="text-xs text-muted-foreground">
                      {format(day, "EEE")}
                    </div>
                    <div className="text-lg font-semibold">{format(day, "d")}</div>
                    {dayEvents.length > 0 && (
                      <div className="mt-1 flex gap-1 flex-wrap">
                        {dayEvents.slice(0, 3).map((event) => (
                          <div
                            key={event.id}
                            className={`h-1.5 w-1.5 rounded-full ${getEventColor(event.type)}`}
                          />
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <Card>
          <CardHeader>
            <CardTitle>Today's Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Tasks Completed</span>
                <span className="font-semibold">
                  {todayEvents.filter(e => e.completed).length} / {todayEvents.length}
                </span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-blue-500"
                  style={{
                    width: `${
                      todayEvents.length > 0
                        ? (todayEvents.filter(e => e.completed).length / todayEvents.length) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            <div className="pt-4 border-t space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Level Progress</span>
                <span className="text-sm font-medium">{userProfile.xp % 100}/100 XP</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Side Goals</span>
                <span className="text-sm font-medium">{userProfile.sideGoals.length}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Today's Schedule */}
      <Card>
        <CardHeader>
          <CardTitle>Today's Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          {todayEvents.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <p className="text-muted-foreground">
                No events scheduled for today
              </p>
              <p className="text-sm text-muted-foreground">
                Try the Weekly Sync to get AI-generated task suggestions!
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {todayEvents
                .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
                .map((event) => (
                  <div
                    key={event.id}
                    className={`flex items-center gap-4 p-4 rounded-lg border hover:border-gray-300 transition-all ${
                      event.completed ? "opacity-60" : ""
                    }`}
                  >
                    <div className={`h-12 w-1 rounded-full ${getEventColor(event.type)}`} />
                    <div className="flex-1">
                      <h4 className={`font-medium ${event.completed ? "line-through" : ""}`}>
                        {event.title}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(event.start), "h:mm a")} -{" "}
                        {format(new Date(event.end), "h:mm a")}
                      </p>
                    </div>
                    <Badge variant="secondary">{getEventBadge(event.type)}</Badge>
                    {!event.completed && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCompleteTask(event.id)}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Complete
                      </Button>
                    )}
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}