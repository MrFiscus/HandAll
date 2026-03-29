import { Outlet, useNavigate, useLocation } from "react-router";
import { useState, useEffect } from "react";
import {
  CalendarDays,
  Settings as SettingsIcon,
  LogOut,
  AlertTriangle,
  Target,
  HelpCircle,
} from "lucide-react";
import { Button } from "./ui/button";
import { useAppStore } from "../store/useAppStore";
import WelcomeGuide from "./WelcomeGuide";
import { supabase } from "../lib/supabase";
import { api } from "../utils/api";
import { toast } from "sonner";

const GOOGLE_CALENDAR_SYNC_KEY = "handall-google-calendar-sync";
const GOOGLE_CALENDAR_CONNECT_QUERY = "google_calendar_connect";

export default function Root() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    userProfile,
    isSetupComplete,
    apiLoaded,
    loadAppData,
    syncCalendarEvents,
  } = useAppStore();
  const [showHelp, setShowHelp] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
    const maybeHandleGoogleCalendarConnection = async () => {
      if (!session || !apiLoaded) {
        return;
      }

      const syncKey = `${GOOGLE_CALENDAR_SYNC_KEY}:${session.user.id}`;
      const url = new URL(window.location.href);
      const connectRequested = url.searchParams.get(GOOGLE_CALENDAR_CONNECT_QUERY) === "1";
      const provider = session.user?.app_metadata?.provider;
      const providerToken = (session as any)?.provider_token as string | undefined;
      const providerRefreshToken = (session as any)?.provider_refresh_token as string | undefined;
      const providerExpiresAt = (session as any)?.expires_at
        ? new Date(Number((session as any).expires_at) * 1000).toISOString()
        : undefined;

      if (connectRequested && provider === "google" && providerToken) {
        try {
          const result = await api.connectGoogleCalendar({
            providerToken,
            providerRefreshToken,
            providerTokenExpiry: providerExpiresAt,
            maxResults: 500,
          });

          const importedEvents = api.mapGoogleEventsToCalendarEvents(result.events, result.sourceUrl);
          if (importedEvents.length > 0) {
            await syncCalendarEvents(importedEvents, result.sourceUrl);
          }

          await loadAppData();
          sessionStorage.setItem(syncKey, "connected");
          url.searchParams.delete(GOOGLE_CALENDAR_CONNECT_QUERY);
          window.history.replaceState({}, "", url.toString());
          toast.success(`Connected Google Calendar and imported ${importedEvents.length} events.`);
          return;
        } catch (error) {
          console.error("Google Calendar connect callback failed:", error);
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not complete Google Calendar connection.",
          );
        }
      }

      if (!userProfile.googleCalendarConnected) {
        return;
      }

      const todayKey = `${syncKey}:${new Date().toISOString().slice(0, 10)}`;
      if (sessionStorage.getItem(todayKey) === "done") {
        return;
      }

      try {
        const result = await api.syncConnectedGoogleCalendar({ maxResults: 500 });
        const importedEvents = api.mapGoogleEventsToCalendarEvents(result.events, result.sourceUrl);
        if (importedEvents.length > 0) {
          await syncCalendarEvents(importedEvents, result.sourceUrl);
        }
        sessionStorage.setItem(todayKey, "done");
      } catch (error) {
        console.error("Connected Google Calendar sync failed:", error);
      }
    };

    maybeHandleGoogleCalendarConnection();
  }, [session, apiLoaded, syncCalendarEvents, loadAppData, userProfile.googleCalendarConnected]);

  const handleLogout = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    navigate("/login");
  };

  if (!supabase && !loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full p-8 border rounded-2xl shadow-xl bg-card text-center space-y-6">
          <AlertTriangle className="h-16 w-16 text-yellow-500 mx-auto" />
          <h1 className="text-2xl font-bold">Supabase Not Configured</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            I couldn't find your Supabase credentials. Please create a <code className="bg-muted px-1 rounded">.env</code> file.
          </p>
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
            className="w-full justify-start font-bold"
            onClick={() => navigate("/")}
          >
            <CalendarDays className="mr-2 h-4 w-4" />
            Dashboard
          </Button>
          <Button
            variant={location.pathname === "/goals" ? "secondary" : "ghost"}
            className="w-full justify-start font-bold"
            onClick={() => navigate("/goals")}
          >
            <Target className="mr-2 h-4 w-4" />
            Goals
          </Button>
          <Button
            variant={location.pathname === "/settings" ? "secondary" : "ghost"}
            className="w-full justify-start font-bold"
            onClick={() => navigate("/settings")}
          >
            <SettingsIcon className="mr-2 h-4 w-4" />
            Settings
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start font-bold"
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
                />
              ) : (
                <div className="flex h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 items-center justify-center text-white font-bold">
                  {userProfile.level}
                </div>
              )}
              <div className="min-w-0 text-left">
                <p className="text-sm font-bold truncate">{displayName}</p>
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
            className="w-full justify-start text-red-500 font-bold hover:text-red-600 hover:bg-red-50"
            onClick={handleLogout}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Log Out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-muted/10">
        <Outlet />
      </main>

      {showHelp && <WelcomeGuide onClose={() => setShowHelp(false)} />}
    </div>
  );
}
