import { Outlet, useNavigate, useLocation } from "react-router";
import { useState, useEffect, useRef } from "react";
import {
  CalendarDays,
  MessageSquare,
  Settings as SettingsIcon,
  BarChart3,
  Send,
  HelpCircle,
  CheckSquare,
  LogOut,
  AlertTriangle,
} from "lucide-react";
import { Button } from "./ui/button";
import { useAppStore } from "../store/useAppStore";
import { ScrollArea } from "./ui/scroll-area";
import { Input } from "./ui/input";
import { format } from "date-fns";
import WelcomeGuide from "./WelcomeGuide";
import { supabase } from "../lib/supabase";

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
  import.meta.env.VITE_AGENT_API_URL?.replace(/\/$/, "") ?? "/agent-api";
const AGENT_USER_ID_KEY = "handall-agent-user-id";

export default function Root() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userProfile, isSetupComplete, apiLoaded, loadAppData, lastMotivation } = useAppStore();
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
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const threadIdRef = useRef<string>(crypto.randomUUID());
  const displayName =
    userProfile.name ||
    session?.user?.user_metadata?.full_name ||
    session?.user?.user_metadata?.name ||
    "Student";
  const avatarUrl =
    session?.user?.user_metadata?.custom_avatar ||
    session?.user?.user_metadata?.avatar_url ||
    session?.user?.user_metadata?.picture ||
    null;

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      if (!session) {
        navigate("/login");
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) {
        navigate("/login");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (session && !apiLoaded) {
      loadAppData();
    }
  }, [session, apiLoaded, loadAppData]);

  useEffect(() => {
    if (session && apiLoaded && !isSetupComplete && location.pathname !== "/setup") {
      navigate("/setup");
    }
  }, [session, apiLoaded, isSetupComplete, location.pathname, navigate]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleLogout = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    navigate("/login");
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
    setIsSending(true);

    try {
      const userId = localStorage.getItem(AGENT_USER_ID_KEY) ?? crypto.randomUUID();
      localStorage.setItem(AGENT_USER_ID_KEY, userId);

      const response = await fetch(`${AGENT_API_BASE_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: userId,
          auth_user_id: session?.user?.id ?? null,
          thread_id: threadIdRef.current,
          message: trimmedMessage,
          motivation: lastMotivation,
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
            `I couldn't reach the AI backend just now (${message}). ` +
            "Make sure `npm run dev` is still running, then try again.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  if (!supabase && !loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full p-8 border rounded-2xl shadow-xl bg-card text-center space-y-6">
          <AlertTriangle className="h-16 w-16 text-yellow-500 mx-auto" />
          <h1 className="text-2xl font-bold">Supabase Not Configured</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            I couldn't find your Supabase credentials. Please create a <code className="bg-muted px-1 rounded">.env</code> file in the <code className="bg-muted px-1 rounded">frontend/</code> directory with:
          </p>
          <pre className="bg-black text-green-400 p-4 rounded-lg text-xs text-left overflow-x-auto border border-white/10">
            VITE_SUPABASE_URL=your_url_here{"\n"}
            VITE_SUPABASE_ANON_KEY=your_anon_key_here
          </pre>
          <Button onClick={() => window.location.reload()} className="w-full">
            Retry Connection
          </Button>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="h-screen w-screen flex items-center justify-center">Loading HandAll...</div>;
  }

  if (!session && location.pathname !== "/login") {
    return null;
  }

  if (location.pathname === "/setup") {
    return <Outlet />;
  }

  return (
    <div className="flex h-screen bg-background">
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
            variant={location.pathname === "/weekly-sync" ? "secondary" : "ghost"}
            className="w-full justify-start"
            onClick={() => navigate("/weekly-sync")}
          >
            <BarChart3 className="mr-2 h-4 w-4" />
            Weekly Sync
          </Button>
          <Button
            variant={location.pathname === "/daily-check-in" ? "secondary" : "ghost"}
            className="w-full justify-start"
            onClick={() => navigate("/daily-check-in")}
          >
            <CheckSquare className="mr-2 h-4 w-4" />
            Daily Check-in
          </Button>
          <Button
            variant={location.pathname === "/settings" ? "secondary" : "ghost"}
            className="w-full justify-start"
            onClick={() => navigate("/settings")}
          >
            <SettingsIcon className="mr-2 h-4 w-4" />
            Settings
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

        <div className="p-4 border-t space-y-4">
          <Button
            variant="ghost"
            className="h-auto w-full justify-start rounded-xl p-2 hover:bg-accent/60"
            onClick={() => navigate("/settings")}
          >
            <div className="flex items-center gap-3">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={`${displayName} profile`}
                  className="h-10 w-10 rounded-full object-cover ring-2 ring-border"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 items-center justify-center text-white font-bold">
                  {userProfile.level}
                </div>
              )}
              <div className="min-w-0 text-left">
                <p className="text-sm font-medium truncate">{displayName}</p>
                <p className="text-xs text-muted-foreground">Level {userProfile.level}</p>
              </div>
            </div>
          </Button>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all"
              style={{ width: `${userProfile.xp % 100}%` }}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-red-500 hover:text-red-600 hover:bg-red-50"
            onClick={handleLogout}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Log Out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>

      {showHelp && <WelcomeGuide onClose={() => setShowHelp(false)} />}

      <Button
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg"
        onClick={() => setShowChat(!showChat)}
      >
        <MessageSquare className="h-6 w-6" />
      </Button>

      {showChat && (
        <div className="fixed bottom-24 right-6 w-96 h-[500px] bg-card border rounded-lg shadow-xl flex flex-col">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold">AI Assistant</h3>
            <Button variant="ghost" size="sm" onClick={() => setShowChat(false)}>
              x
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
