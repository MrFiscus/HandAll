import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { format, startOfWeek, addDays, isSameDay } from "date-fns";
import { ScrollArea } from "./ui/scroll-area";

const AGENT_API_BASE_URL =
  import.meta.env.VITE_AGENT_API_URL?.replace(/\/$/, "") ?? "/agent-api";
const AGENT_USER_ID_KEY = "handall-agent-user-id";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}
import { useAppStore } from "../store/useAppStore";
import { supabase } from "../lib/supabase";
import { getAuthHeaders } from "../utils/api";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Plus, CheckCircle2, Calendar as CalendarIcon, MessageSquare, Send } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { cn } from "./ui/utils";
import { toast } from "sonner";
import WelcomeGuide from "./WelcomeGuide";
import WeeklyCalendar from "./WeeklyCalendar";

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    events,
    userProfile,
    planningItems,
    addEvent,
    updateEvent,
    loadAppData,
    apiLoaded,
    lastMotivation,
  } = useAppStore();
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

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "Hi! I'm here to help you manage your tasks. Ask me to add tasks, check your schedule, or adjust your calendar.",
      timestamp: new Date(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const threadIdRef = useRef<string>(crypto.randomUUID());
  const chatSendGenRef = useRef(0);

  // Load app data on first mount
  useEffect(() => {
    if (!apiLoaded) {
      loadAppData();
    }
  }, [apiLoaded, loadAppData]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Welcome guide logic
  useEffect(() => {
    const hasSeenWelcome = localStorage.getItem("handall-welcome-seen");
    if (!hasSeenWelcome) {
      setShowWelcome(true);
      localStorage.setItem("handall-welcome-seen", "true");
    }
  }, []);

  const planningSummary = useMemo(() => {
    const subs = planningItems.filter((p) => p.item_type === "assignment_subtask").length;
    const goals = planningItems.filter((p) => p.item_type === "goal_task").length;
    return { subs, goals };
  }, [planningItems]);

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

    try {
      await addEvent({
        title: newEvent.title,
        start,
        end,
        type: newEvent.type,
        xpValue:
          newEvent.type === "working"
            ? 50
            : newEvent.type === "goal"
              ? 30
              : 10,
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
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not save this event.";
      toast.error(message);
    }
  };

  const handleCompleteTask = async (eventId: string) => {
    const event = events.find(e => e.id === eventId);
    if (event && !event.completed) {
      await updateEvent(eventId, { completed: true });
      toast.success(`XP earned! 🎉`);
    }
  };

  const handleSendMessage = async () => {
    const trimmedMessage = inputMessage.trim();
    if (!trimmedMessage || isSending) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: trimmedMessage,
      timestamp: new Date(),
    };

    setChatMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    const sendGen = ++chatSendGenRef.current;
    setIsSending(true);

    try {
      const session = supabase
        ? (await supabase.auth.getSession()).data.session
        : null;
      const authId = session?.user?.id;
      const userId = authId ?? localStorage.getItem(AGENT_USER_ID_KEY) ?? crypto.randomUUID();
      if (authId) localStorage.setItem(AGENT_USER_ID_KEY, authId);

      const headers = await getAuthHeaders();
      const response = await fetch(`${AGENT_API_BASE_URL}/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          user_id: userId,
          auth_user_id: authId ?? null,
          thread_id: threadIdRef.current,
          message: trimmedMessage,
          motivation: lastMotivation ?? 50,
        }),
      });

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }

      const data = await response.json();
      if (sendGen !== chatSendGenRef.current) return;

      const display = typeof data.response === "string" ? data.response : JSON.stringify(data.response);

      setChatMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: display || "I couldn't generate a reply just now.",
          timestamp: new Date(),
        },
      ]);

      if (data.schedule_updated) {
        await loadAppData();
      }
    } catch (error) {
      if (sendGen !== chatSendGenRef.current) return;

      const message = error instanceof Error ? error.message : "Unable to reach the AI backend right now.";
      setChatMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `I couldn't reach the AI backend just now (${message}). Make sure the app is running and try again.`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      if (sendGen === chatSendGenRef.current) {
        setIsSending(false);
      }
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
          {(planningSummary.subs > 0 || planningSummary.goals > 0) && (
            <p className="mt-1 text-sm text-muted-foreground">
              AI planning queue:{" "}
              <span className="font-medium text-foreground">{planningSummary.subs}</span> assignment
              subtasks,{" "}
              <span className="font-medium text-foreground">{planningSummary.goals}</span> personal-goal
              tasks (used when you rebalance or run Weekly Sync).
            </p>
          )}
        </div>
        <div className="flex gap-2">
           <Dialog open={showAddEvent} onOpenChange={setShowAddEvent}>
            <DialogTrigger asChild>
              <Button type="button">
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
                <Button type="button" onClick={handleAddEvent} className="w-full">
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

        {/* Sidebar: AI Chat */}
        <div className="space-y-4 overflow-y-auto pr-2 relative">
          <div className="absolute bottom-4 right-4 w-full max-w-[360px]">
            <Card className="h-[60vh] overflow-hidden flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  AI Assistant
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col p-0">
                <div className="flex-1 min-h-0">
                  <ScrollArea className="h-full">
                    <div className="p-4 space-y-4">
                      {chatMessages.map((message) => (
                        <div
                          key={message.id}
                          className={`flex ${
                            message.role === "user" ? "justify-end" : "justify-start"
                          }`}
                        >
                          <div
                            className={`max-w-[85%] p-3 rounded-2xl shadow-sm ${
                              message.role === "user"
                                ? "bg-primary text-primary-foreground rounded-tr-none"
                                : "bg-muted text-muted-foreground rounded-tl-none"
                            }`}
                          >
                            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
                            <p
                              className={`text-[9px] mt-1.5 font-bold uppercase tracking-widest ${
                                message.role === "user"
                                  ? "opacity-60"
                                  : "text-muted-foreground/50"
                              }`}
                            >
                              {format(message.timestamp, "h:mm a")}
                            </p>
                          </div>
                        </div>
                      ))}
                      <div ref={chatEndRef} />
                    </div>
                  </ScrollArea>
                </div>
                <div className="p-4 border-t">
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      placeholder="Type a message..."
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                      className="flex-1"
                      disabled={isSending}
                    />
                    <Button onClick={handleSendMessage} size="icon" disabled={isSending}>
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Connected to {AGENT_API_BASE_URL}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

