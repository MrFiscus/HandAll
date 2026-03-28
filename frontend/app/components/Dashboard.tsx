import { useState, useMemo, useEffect } from "react";
import { format, startOfWeek, addDays, isSameDay } from "date-fns";
import { useAppStore } from "../store/useAppStore";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Plus, CheckCircle2, Calendar as CalendarIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { toast } from "sonner";
import WelcomeGuide from "./WelcomeGuide";
import WeeklyCalendar from "./WeeklyCalendar";

export default function Dashboard() {
  const { events, userProfile, addEvent, updateEvent, loadAppData, apiLoaded } = useAppStore();
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

  // Load app data on first mount
  useEffect(() => {
    if (!apiLoaded) {
      loadAppData();
    }
  }, [apiLoaded, loadAppData]);

  // Welcome guide logic
  useEffect(() => {
    const hasSeenWelcome = localStorage.getItem("handall-welcome-seen");
    if (!hasSeenWelcome) {
      setShowWelcome(true);
      localStorage.setItem("handall-welcome-seen", "true");
    }
  }, []);

  const todayEvents = useMemo(() => {
    return events.filter((event) =>
      isSameDay(new Date(event.start), selectedDate)
    );
  }, [events, selectedDate]);

  const handleAddEvent = async () => {
    if (!newEvent.title.trim()) {
      toast.error("Please enter a title");
      return;
    }

    const start = new Date(`${newEvent.date}T${newEvent.startTime}`);
    const end = new Date(`${newEvent.date}T${newEvent.endTime}`);

    if (end <= start) {
      toast.error("End time must be after start time");
      return;
    }

    await addEvent({
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

  const handleCompleteTask = async (eventId: string) => {
    const event = events.find(e => e.id === eventId);
    if (event && !event.completed) {
      await updateEvent(eventId, { completed: true });
      toast.success(`XP earned! 🎉`);
    }
  };

  const getEventColor = (type: string) => {
    switch (type) {
      case "class": return "bg-blue-500";
      case "assignment": return "bg-red-500";
      case "working": return "bg-orange-500";
      case "goal": return "bg-green-500";
      case "freetime": return "bg-purple-500";
      default: return "bg-gray-500";
    }
  };

  const getEventBadge = (type: string) => {
    switch (type) {
      case "working": return "Working Task";
      case "goal": return "Goal Task";
      case "freetime": return "Free Time Task";
      default: return type.charAt(0).toUpperCase() + type.slice(1);
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
            Welcome back! Here's your weekly overview.
          </p>
        </div>
        <div className="flex gap-2">
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[800px]">
        {/* Weekly Calendar - Major component */}
        <div className="lg:col-span-3 h-full">
          <WeeklyCalendar />
        </div>

        {/* Sidebar Stats and Today's Schedule */}
        <div className="space-y-6 overflow-y-auto pr-2">
          {/* Stats Card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Your Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span>Level {userProfile.level}</span>
                  <span className="font-semibold">{userProfile.xp % 100}/100 XP</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
                    style={{ width: `${(userProfile.xp % 100)}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-2 bg-muted/50 rounded-lg">
                  <div className="text-xl font-bold">{userProfile.level}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">Level</div>
                </div>
                <div className="p-2 bg-muted/50 rounded-lg">
                  <div className="text-xl font-bold">{userProfile.sideGoals.length}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">Goals</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Today's Schedule Sidebar */}
          <Card className="flex-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CalendarIcon className="h-4 w-4" />
                Today's Tasks
              </CardTitle>
            </CardHeader>
            <CardContent>
              {todayEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No tasks for today.
                </p>
              ) : (
                <div className="space-y-3">
                  {todayEvents
                    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
                    .map((event) => (
                      <div
                        key={event.id}
                        className={cn(
                          "p-2 rounded-md border text-xs relative group",
                          event.completed && "opacity-60"
                        )}
                      >
                        <div className={cn("absolute left-0 top-0 bottom-0 w-1 rounded-l-md", getEventColor(event.type))} />
                        <div className="pl-2">
                          <div className={cn("font-medium truncate", event.completed && "line-through")}>
                            {event.title}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {format(new Date(event.start), "h:mm a")}
                          </div>
                          {!event.completed && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-full mt-1 text-[10px] py-0 hidden group-hover:flex"
                              onClick={() => handleCompleteTask(event.id)}
                            >
                              Complete
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}