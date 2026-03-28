import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { CalendarDays, MessageSquare, Settings, BarChart3, Send, HelpCircle } from "lucide-react";
import { Button } from "./ui/button";
import { useAppStore } from "../store/useAppStore";
import { ScrollArea } from "./ui/scroll-area";
import { Input } from "./ui/input";
import { format } from "date-fns";
import WelcomeGuide from "./WelcomeGuide";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface ChatApiResponse {
  response: string;
  user_id: string;
  thread_id: string;
}

const AGENT_API_BASE_URL =
  import.meta.env.VITE_AGENT_API_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";

export default function Root() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userProfile, isSetupComplete, setUserProfile } = useAppStore();
  const [showChat, setShowChat] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
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

  // Redirect to setup if not completed
  useEffect(() => {
    if (!isSetupComplete && location.pathname !== "/setup") {
      navigate("/setup");
    }
  }, [isSetupComplete, location.pathname, navigate]);

  // Auto scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    if (!userProfile.userId) {
      setUserProfile({ userId: crypto.randomUUID() });
    }
  }, [setUserProfile, userProfile.userId]);

  // Show setup page without layout
  if (location.pathname === "/setup") {
    return <Outlet />;
  }

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
    setIsSending(true);

    try {
      const response = await fetch(`${AGENT_API_BASE_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: userProfile.userId || crypto.randomUUID(),
          thread_id: threadIdRef.current,
          message: trimmedMessage,
        }),
      });

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }

      const data: ChatApiResponse = await response.json();
      setChatMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: data.response || "I couldn't generate a reply just now.",
          timestamp: new Date(),
        },
      ]);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to reach the AI backend right now.";

      setChatMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content:
            `I couldn't reach the backend just now (${message}). ` +
            "Make sure the FastAPI server is running on port 8000 and your user exists in Supabase.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card flex flex-col">
        <div className="p-6 border-b">
          <h1 className="text-2xl font-bold">HandAll</h1>
          <p className="text-sm text-muted-foreground">Time Manager</p>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <Button
            variant={location.pathname === "/" ? "secondary" : "ghost"}
            className="w-full justify-start"
            onClick={() => navigate("/")}
          >
            <CalendarDays className="mr-2 h-4 w-4" />
            Dashboard
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => navigate("/weekly-sync")}
          >
            <BarChart3 className="mr-2 h-4 w-4" />
            Weekly Sync
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => navigate("/daily-check-in")}
          >
            <Settings className="mr-2 h-4 w-4" />
            Daily Check-in
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => setShowHelp(true)}
          >
            <HelpCircle className="mr-2 h-4 w-4" />
            How It Works
          </Button>
        </nav>

        {/* User Profile & Level */}
        <div className="p-4 border-t">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold">
              {userProfile.level}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Level {userProfile.level}</p>
              <p className="text-xs text-muted-foreground">{userProfile.xp} XP</p>
            </div>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all"
              style={{ width: `${(userProfile.xp % 100)}%` }}
            />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>

      {showHelp && <WelcomeGuide onClose={() => setShowHelp(false)} />}

      {/* Floating Chat Button */}
      <Button
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg"
        onClick={() => setShowChat(!showChat)}
      >
        <MessageSquare className="h-6 w-6" />
      </Button>

      {/* Chat Panel */}
      {showChat && (
        <div className="fixed bottom-24 right-6 w-96 h-[500px] bg-card border rounded-lg shadow-xl flex flex-col">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold">AI Assistant</h3>
            <Button variant="ghost" size="sm" onClick={() => setShowChat(false)}>
              ×
            </Button>
          </div>
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
              {chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[80%] p-3 rounded-lg ${
                      message.role === "user"
                        ? "bg-blue-500 text-white"
                        : "bg-secondary"
                    }`}
                  >
                    <p className="text-sm">{message.content}</p>
                    <p
                      className={`text-xs mt-1 ${
                        message.role === "user"
                          ? "text-blue-100"
                          : "text-muted-foreground"
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
            <p className="mt-2 text-xs text-muted-foreground">
              Connected to {AGENT_API_BASE_URL}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
