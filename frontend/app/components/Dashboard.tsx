import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { ScrollArea } from "./ui/scroll-area";
import { useAppStore } from "../store/useAppStore";
import { Button } from "./ui/button";
import {
  Plus,
  Send,
  Sparkles,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Slider } from "./ui/slider";
import { cn } from "./ui/utils";
import { toast } from "sonner";
import WeeklyCalendar from "./WeeklyCalendar";
import { supabase } from "../lib/supabase";
import { getAuthHeaders } from "../utils/api";
import { normalizeChatResponseContent } from "../utils/chatResponse";
import { TimePickerField } from "./ui/time-picker";

const AGENT_API_BASE_URL = import.meta.env.VITE_AGENT_API_URL?.replace(/\/$/, "") ?? "/agent-api";
const AGENT_USER_ID_KEY = "handall-agent-user-id";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export default function Dashboard() {
  const {
    userProfile,
    addEvent,
    loadAppData,
    apiLoaded,
    lastMotivation,
    setMotivation,
    isFullScreen,
    motivationRebalancePending,
  } = useAppStore();

  const [draftMotivation, setDraftMotivation] = useState(lastMotivation);
  useEffect(() => {
    setDraftMotivation(lastMotivation);
  }, [lastMotivation]);

  const [viewMode, setViewMode] = useState<"day" | "week">("day");
  const [showAddEvent, setShowAddEvent] = useState(false);
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
      content: "How can I help you find focus today?",
      timestamp: new Date(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const threadIdRef = useRef<string>(crypto.randomUUID());
  const chatSendGenRef = useRef(0);

  useEffect(() => {
    if (!apiLoaded) loadAppData();
  }, [apiLoaded, loadAppData]);

  useEffect(() => {
    if (showChat) {
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }, [chatMessages, showChat]);

  const handleAddEvent = async () => {
    if (!newEvent.title.trim()) return toast.error("What are we working on?");
    const start = new Date(`${newEvent.date}T${newEvent.startTime}`);
    const end = new Date(`${newEvent.date}T${newEvent.endTime}`);
    if (end <= start) return toast.error("Time must flow forward.");
    try {
      await addEvent({
        title: newEvent.title,
        start,
        end,
        type: newEvent.type,
        xpValue: 10,
      });
      toast.success("Added to your path.");
      setNewEvent({
        title: "",
        date: format(new Date(), "yyyy-MM-dd"),
        startTime: "09:00",
        endTime: "10:00",
        type: "assignment" as const,
      });
      setShowAddEvent(false);
    } catch (error) {
      console.error("handleAddEvent failed:", error);
      const message = error instanceof Error ? error.message : "Flow interrupted.";
      toast.error(message);
    }
  };

  const handleSendMessage = async () => {
    const trimmedMessage = inputMessage.trim();
    if (!trimmedMessage || isSending) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: trimmedMessage,
      timestamp: new Date(),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setInputMessage("");
    const sendGen = ++chatSendGenRef.current;
    setIsSending(true);

    try {
      const session = supabase ? (await supabase.auth.getSession()).data.session : null;
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

      const display = normalizeChatResponseContent(data.response);
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
      const message = error instanceof Error ? error.message : "Unable to reach the AI backend.";
      setChatMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `I lost the connection (${message}). Try again?`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      if (sendGen === chatSendGenRef.current) {
        setIsSending(false);
      }
    }
  };

  return (
    <div
      className={cn(
        "h-full min-h-0 transition-all duration-1000 ease-in-out mx-auto flex flex-col overflow-hidden",
        isFullScreen ? "p-0 max-w-full" : "p-8 lg:p-12 max-w-[1800px] gap-10",
      )}
    >
      {!isFullScreen && (
        <header className="flex items-end justify-between transition-all duration-500 animate-in fade-in slide-in-from-top-8 shrink-0">
          <div className="space-y-8">
            <h1 className="text-2xl font-normal tracking-tight text-foreground lowercase mb-0">
              <span className="text-sm font-medium text-muted-foreground/60 mr-2">welcome,</span>
              {userProfile.name}
            </h1>

            <div className="w-48 space-y-1.5">
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-1000"
                  style={{ width: `${userProfile.xp % 100}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-medium uppercase tracking-widest text-muted-foreground/40">
                <span>Level {userProfile.level}</span>
                <span>{userProfile.xp % 100}%</span>
              </div>
            </div>
          </div>

          <Dialog open={showAddEvent} onOpenChange={setShowAddEvent}>
            <DialogTrigger asChild>
              <button
                type="button"
                className="h-14 px-8 rounded-full bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 text-base font-bold transition-all hover:scale-105 active:scale-95 flex items-center gap-3"
              >
                <Plus className="h-5 w-5 text-primary" />
                <span>Add Event</span>
              </button>
            </DialogTrigger>
            <DialogContent className="rounded-[3rem] border-none p-10 bg-[#1a3a2a] shadow-4xl sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle className="text-4xl font-black tracking-tighter mb-6">New Entry</DialogTitle>
              </DialogHeader>
              <div className="space-y-8">
                <div className="space-y-2">
                  <Label>Activity</Label>
                  <Input
                    value={newEvent.title}
                    onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                    placeholder="What's next?"
                    className="h-14 bg-white/[0.02] border-none rounded-2xl text-lg px-6"
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={newEvent.date}
                    onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })}
                    className="h-14 bg-white/[0.02] border-none rounded-2xl px-6 font-bold [color-scheme:dark]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <TimePickerField
                    id="startTime"
                    label="Start Time"
                    value={newEvent.startTime}
                    onChange={(next) => setNewEvent({ ...newEvent, startTime: next })}
                  />
                  <TimePickerField
                    id="endTime"
                    label="End Time"
                    value={newEvent.endTime}
                    onChange={(next) => setNewEvent({ ...newEvent, endTime: next })}
                  />
                </div>
                <Button
                  type="button"
                  onClick={handleAddEvent}
                  className="w-full h-14 rounded-3xl font-black uppercase tracking-widest shadow-2xl"
                >
                  Confirm Entry
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </header>
      )}

      <div
        className={cn("grid gap-10 flex-1 min-h-0", isFullScreen ? "grid-cols-1" : "grid-cols-12")}
      >
        <div
          className={cn(
            "transition-all duration-1000 ease-in-out h-full min-h-0",
            isFullScreen ? "col-span-1" : "col-span-12 lg:col-span-10",
          )}
        >
          <WeeklyCalendar viewMode={viewMode} setViewMode={setViewMode} />
        </div>

        {!isFullScreen && (
          <div className="col-span-12 lg:col-span-2 flex flex-col gap-8 py-4 h-full animate-in fade-in slide-in-from-right-8 duration-700">
            <div className="p-8 rounded-[2rem] bg-white/[0.01] border border-white/[0.03] flex flex-col items-center gap-6 backdrop-blur-sm">
              <div className="flex flex-col items-center">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-3xl">
                  {draftMotivation <= 20
                    ? "😴"
                    : draftMotivation <= 40
                      ? "☕"
                      : draftMotivation <= 60
                        ? "🧘"
                        : draftMotivation <= 80
                          ? "🚀"
                          : "⚡"}
                </div>
              </div>

              <div className="h-32 flex items-center justify-center mt-4">
                <Slider
                  orientation="vertical"
                  value={[draftMotivation]}
                  onValueChange={(v) => setDraftMotivation(v[0])}
                  onValueCommit={(v) => {
                    void setMotivation(v[0]);
                  }}
                  max={100}
                  step={5}
                  disabled={motivationRebalancePending}
                  className={cn("h-full", motivationRebalancePending && "opacity-60 pointer-events-none")}
                />
              </div>

              <div className="text-center font-black h-8 flex items-center mt-4">
                <span className="text-lg text-primary uppercase tracking-tighter leading-tight">
                  {draftMotivation <= 20
                    ? "Deep Chill"
                    : draftMotivation <= 40
                      ? "Chill"
                      : draftMotivation <= 60
                        ? "Balanced"
                        : draftMotivation <= 80
                          ? "Lock-in"
                          : "Deep Lock-in"}
                </span>
              </div>
            </div>

            <Dialog open={showChat} onOpenChange={setShowChat}>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className="w-full h-24 rounded-[2rem] bg-primary text-primary-foreground shadow-[0_20px_40px_rgba(221,251,92,0.1)] flex flex-col items-center justify-center gap-2 group hover:scale-[1.02] transition-all duration-500 border-none"
                >
                  <Sparkles className="h-6 w-6 transition-transform group-hover:rotate-12" />
                  <span className="font-black uppercase tracking-widest text-[9px]">Assistant</span>
                </button>
              </DialogTrigger>
              <DialogContent 
                overlayClassName="bg-transparent"
                className="sm:max-w-[500px] h-[600px] border-none rounded-[3rem] bg-card/60 backdrop-blur-xl shadow-4xl flex flex-col p-0 overflow-hidden"
              >
                <div className="p-10 border-b border-white/5 bg-white/2">
                  <h2 className="text-3xl font-black tracking-tighter">Let&apos;s Chat.</h2>
                  <p className="opacity-40 font-medium text-sm">Refine your experience.</p>
                </div>
                <ScrollArea className="flex-1" type="always">
                  <div className="p-10 space-y-6">
                    {chatMessages.map((m) => (
                      <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                        <div
                          className={cn(
                            "max-w-[85%] p-5 rounded-[1.5rem] text-base font-medium leading-relaxed break-words",
                            m.role === "user"
                              ? "bg-primary text-primary-foreground rounded-tr-none"
                              : "bg-white/[0.03] border border-white/5 rounded-tl-none",
                          )}
                        >
                          {m.content}
                        </div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                </ScrollArea>
                <div className="p-12 pt-0">
                  <div className="flex gap-4 p-3 rounded-[2rem] bg-white/[0.03] border border-white/5 focus-within:border-primary/20 transition-all">
                    <Input
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                      placeholder="Type something..."
                      className="flex-1 h-14 bg-transparent border-none text-lg px-6 focus:ring-0"
                      disabled={isSending}
                    />
                    <Button
                      type="button"
                      onClick={handleSendMessage}
                      className="h-14 w-14 rounded-2xl transition-all hover:scale-105"
                      disabled={isSending}
                    >
                      <Send className="h-6 w-6" />
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <div className="flex-1" />
          </div>
        )}
      </div>
    </div>
  );
}
