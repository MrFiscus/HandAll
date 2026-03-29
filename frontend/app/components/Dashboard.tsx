import { useState, useMemo, useEffect, useRef } from "react";
import { format, isAfter } from "date-fns";
import { ScrollArea } from "./ui/scroll-area";
import { useAppStore } from "../store/useAppStore";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { 
  Plus, 
  MessageSquare, 
  Send, 
  Zap,
  Sparkles
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Slider } from "./ui/slider";
import { cn } from "./ui/utils";
import { toast } from "sonner";
import WelcomeGuide from "./WelcomeGuide";
import WeeklyCalendar from "./WeeklyCalendar";
import { supabase } from "../lib/supabase";

const AGENT_API_BASE_URL =
  import.meta.env.VITE_AGENT_API_URL?.replace(/\/$/, "") ?? "/agent-api";
const AGENT_USER_ID_KEY = "handall-agent-user-id";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export default function Dashboard() {
  const {
    events,
    userProfile,
    addEvent,
    loadAppData,
    apiLoaded,
    lastMotivation,
    setMotivation,
    pendingSuggestions,
    runWeeklySync,
    setPendingSuggestions,
  } = useAppStore();

  const [viewMode, setViewMode] = useState<"day" | "week">("day");
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showChat, setShowChat] = useState(false);
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
      content: "Hi! I'm here to help you manage your tasks. Ask me to add tasks, check your schedule, or adjust your calendar.",
      timestamp: new Date(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
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
    if (showChat) {
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, [chatMessages, showChat]);

  // Welcome guide logic
  useEffect(() => {
    const hasSeenWelcome = localStorage.getItem("handall-welcome-seen");
    if (!hasSeenWelcome) {
      setShowWelcome(true);
      localStorage.setItem("handall-welcome-seen", "true");
    }
  }, []);

  // Auto-trigger weekly sync if no suggestions but assignments exist
  useEffect(() => {
    const triggerAutoSync = async () => {
      const activeAssignments = events.filter(e => e.type === "assignment" && !e.completed && isAfter(new Date(e.start), new Date()));
      if (apiLoaded && activeAssignments.length > 0 && pendingSuggestions.length === 0 && !isSyncing) {
        setIsSyncing(true);
        try {
          const authId = (await supabase?.auth.getSession())?.data?.session?.user?.id;
          const userId = authId ?? localStorage.getItem(AGENT_USER_ID_KEY) ?? crypto.randomUUID();
          
          const result = await runWeeklySync({
            userId,
            name: userProfile.name || "Student",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            wakeTime: userProfile.wakeTime,
            sleepTime: userProfile.sleepTime,
            sideGoals: userProfile.sideGoals,
            motivation: lastMotivation,
            events,
            assignments: activeAssignments.map(e => ({
              id: e.id,
              title: e.title,
              description: e.description || "",
              dueDate: new Date(e.start),
              estimatedHours: 0,
            })),
          });

          setPendingSuggestions(
            result.suggested_tasks.map((task) => ({
              ...task,
              start: new Date(task.start),
              end: new Date(task.end),
              status: "pending",
            }))
          );
        } catch (e) {
          console.error("Auto-sync failed", e);
        } finally {
          setIsSyncing(false);
        }
      }
    };

    triggerAutoSync();
  }, [apiLoaded, events, pendingSuggestions.length, runWeeklySync, userProfile, lastMotivation]);

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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save event.");
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
      const userId = localStorage.getItem(AGENT_USER_ID_KEY) ?? crypto.randomUUID();
      const response = await fetch(`${AGENT_API_BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          auth_user_id: userProfile?.id ?? null,
          thread_id: threadIdRef.current,
          message: trimmedMessage,
          motivation: lastMotivation ?? null,
        }),
      });

      if (!response.ok) throw new Error(`Backend returned ${response.status}`);

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

      if (data.schedule_updated) await loadAppData();
    } catch (error) {
      if (sendGen !== chatSendGenRef.current) return;
      setChatMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "I couldn't reach the AI backend just now. Make sure the app is running.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      if (sendGen === chatSendGenRef.current) setIsSending(false);
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
            Welcome back, {userProfile.name}!
          </p>
        </div>
        <div className="flex gap-2">
           <Dialog open={showAddEvent} onOpenChange={setShowAddEvent}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" className="font-bold">
                <Plus className="mr-2 h-4 w-4" />
                Add Event
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add New Event</DialogTitle></DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Title</Label>
                  <Input id="title" value={newEvent.title} onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })} placeholder="Math assignment" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="date">Date</Label>
                  <Input id="date" type="date" value={newEvent.date} onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="startTime">Start Time</Label>
                    <Input id="startTime" type="time" value={newEvent.startTime} onChange={(e) => setNewEvent({ ...newEvent, startTime: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="endTime">End Time</Label>
                    <Input id="endTime" type="time" value={newEvent.endTime} onChange={(e) => setNewEvent({ ...newEvent, endTime: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <Select value={newEvent.type} onValueChange={(value: any) => setNewEvent({ ...newEvent, type: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="class">Class</SelectItem>
                      <SelectItem value="assignment">Assignment</SelectItem>
                      <SelectItem value="working">Working Task</SelectItem>
                      <SelectItem value="goal">Goal Task</SelectItem>
                      <SelectItem value="freetime">Free Time Task</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" onClick={handleAddEvent} className="w-full font-bold">Add Event</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 min-h-[800px]">
        {/* Calendar Column */}
        <div className="lg:col-span-4 space-y-4">
          <WeeklyCalendar viewMode={viewMode} setViewMode={setViewMode} />
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6 flex flex-col">
          {/* Today's Vibe Section */}
          <Card className="border-2 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2 font-bold">
                <Zap className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                Today's Vibe
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  <span>Downtime</span>
                  <span>Productive</span>
                </div>
                <Slider 
                  value={[lastMotivation]} 
                  onValueChange={(val) => setMotivation(val[0])} 
                  max={100} 
                  step={5}
                />
                <p className="text-xs text-center text-muted-foreground font-bold">
                  Motivation: <span className="text-foreground text-sm">{lastMotivation}%</span>
                </p>
              </div>
            </CardContent>
          </Card>

          {/* AI Chat Trigger Button */}
          <Dialog open={showChat} onOpenChange={setShowChat}>
            <DialogTrigger asChild>
              <Button className="w-full h-16 rounded-xl border-2 shadow-md flex items-center justify-between px-6 group transition-all hover:scale-[1.02] active:scale-[0.98]">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary-foreground/20 rounded-lg group-hover:rotate-12 transition-transform">
                    <Sparkles className="h-6 w-6 text-white" />
                  </div>
                  <div className="text-left">
                    <p className="font-black uppercase tracking-widest text-[10px] opacity-70">HandAll AI</p>
                    <p className="font-bold text-sm">Chat Assistant</p>
                  </div>
                </div>
                <MessageSquare className="h-5 w-5 opacity-50" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[450px] h-[600px] flex flex-col p-0 overflow-hidden border-2 shadow-2xl">
              <DialogHeader className="p-4 border-b bg-muted/30">
                <DialogTitle className="flex items-center gap-2 font-bold">
                  <Sparkles className="h-5 w-5 text-primary" />
                  AI Planning Assistant
                </DialogTitle>
              </DialogHeader>
              <div className="flex-1 flex flex-col overflow-hidden">
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-4">
                    {chatMessages.map((message) => (
                      <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                        <div className={cn(
                          "max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed shadow-sm",
                          message.role === "user" ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-muted text-muted-foreground rounded-tl-none"
                        )}>
                          {message.content}
                        </div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                </ScrollArea>
                <div className="p-4 border-t bg-background">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Ask me to adjust your schedule..."
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                      className="flex-1 h-12 text-sm border-2 rounded-xl focus:ring-primary"
                      disabled={isSending}
                    />
                    <Button onClick={handleSendMessage} size="icon" className="h-12 w-12 shrink-0 rounded-xl shadow-lg" disabled={isSending}>
                      <Send className="h-5 w-5" />
                    </Button>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
