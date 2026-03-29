import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Info,
  Link,
  RefreshCw,
  Upload,
  X,
  Plus,
} from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useAppStore, CalendarEvent } from "../store/useAppStore";
import { api } from "../utils/api";
import {
  fetchCalendarEvents,
  parseICalData,
  resolveCalendarImportUrl,
} from "../utils/calendarSync";
import { saveCalendarImportPreviewState } from "../utils/calendarImportPreview";
import { Button } from "./ui/button";
import { cn } from "./ui/utils";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

const GOOGLE_CALENDAR_CONNECT_QUERY = "google_calendar_connect";

interface CalendarSyncProps {
  redirectPath?: string;
  compact?: boolean;
}

export default function CalendarSync({
  redirectPath = "/settings",
  compact = false,
}: CalendarSyncProps) {
  const navigate = useNavigate();
  const {
    userProfile,
    setUserProfile,
    syncCalendarEvents,
    removeExternalEvents,
    lastCalendarSync,
    loadAppData,
  } = useAppStore();
  const [calendarUrl, setCalendarUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [isGoogleCalendarConnected, setIsGoogleCalendarConnected] = useState(
    userProfile.googleCalendarConnected,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsGoogleCalendarConnected(userProfile.googleCalendarConnected);
  }, [userProfile.googleCalendarConnected]);

  useEffect(() => {
    const loadConnectionState = async () => {
      try {
        const connection = await api.fetchGoogleCalendarConnection();
        setIsGoogleCalendarConnected(connection.connected);
      } catch (error) {
        console.error("Failed to load Google Calendar connection state:", error);
      }
    };

    loadConnectionState();
  }, []);

  const openPreviewPage = (events: CalendarEvent[], source: string) => {
    saveCalendarImportPreviewState({
      events,
      source,
      returnPath: redirectPath,
    });
    setShowDialog(false);
    setCalendarUrl("");
    navigate("/calendar-import-preview");
  };

  const handleSyncUrl = async () => {
    if (!calendarUrl.trim()) {
      toast.error("Please enter a calendar URL");
      return;
    }

    setIsLoading(true);
    try {
      const icalUrl = resolveCalendarImportUrl(calendarUrl);
      const events = await fetchCalendarEvents(icalUrl);

      if (events.length === 0) {
        toast.warning("No events found in calendar");
        setIsLoading(false);
        return;
      }

      toast.success(`Loaded ${events.length} events. Review them on the next page.`);
      openPreviewPage(events, icalUrl);
    } catch (error) {
      console.error("Calendar sync error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to sync calendar",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const icalData = event.target?.result as string;
          const events = parseICalData(icalData);

          if (events.length === 0) {
            toast.warning("No events found in the uploaded file");
            return;
          }

          const fileSource = `file://${file.name}`;
          toast.success(`Loaded ${events.length} events from ${file.name}.`);
          openPreviewPage(events, fileSource);
        } catch {
          toast.error(
            "Failed to parse .ical file. Please ensure it's a valid iCal format.",
          );
        } finally {
          setIsLoading(false);
        }
      };
      reader.readAsText(file);
    } catch {
      toast.error("Failed to read file");
      setIsLoading(false);
    }
  };

  const handleResync = async (url: string) => {
    if (url.startsWith("file://")) {
      toast.info(
        "Local files cannot be resynced automatically. Please upload the file again if it changed.",
      );
      return;
    }
    setIsLoading(true);
    try {
      const events = await fetchCalendarEvents(url);
      if (!url.startsWith("file://")) {
        try {
          await api.patchActiveCalendarSource(url);
        } catch (e) {
          console.warn("[CalendarSync] patchActiveCalendarSource:", e);
        }
      }
      await syncCalendarEvents(events, url);
      await loadAppData();
      toast.success(`Resynced ${events.length} events!`);
    } catch (error) {
      console.error("Calendar resync error:", error);
      toast.error("Failed to resync calendar");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveCalendar = async (url: string) => {
    if (url.startsWith("google-oauth:")) {
      await handleDisconnectGoogleCalendar();
      return;
    }

    await setUserProfile({
      calendarUrls: userProfile.calendarUrls.filter((u) => u !== url),
    });
    await removeExternalEvents(url);
    toast.success("Calendar removed");
  };

  const handleConnectGoogleCalendar = async () => {
    if (!supabase) {
      toast.error("Supabase is not configured.");
      return;
    }

    const redirectUrl = new URL(`${window.location.origin}${redirectPath}`);
    redirectUrl.searchParams.set(GOOGLE_CALENDAR_CONNECT_QUERY, "1");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: "https://www.googleapis.com/auth/calendar.readonly",
        redirectTo: redirectUrl.toString(),
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    if (error) {
      toast.error(error.message || "Google Calendar connection failed");
    }
  };

  const handleSyncConnectedGoogleCalendar = async () => {
    setIsLoading(true);
    try {
      const result = await api.syncConnectedGoogleCalendar({ maxResults: 500 });
      const importedEvents = api.mapGoogleEventsToCalendarEvents(
        result.events,
        result.sourceUrl,
      );
      await syncCalendarEvents(importedEvents, result.sourceUrl);
      toast.success(
        `Synced ${importedEvents.length} events from your connected Google Calendar.`,
      );
    } catch (error) {
      console.error("Connected Google Calendar sync error:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to sync connected Google Calendar",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnectGoogleCalendar = async () => {
    setIsLoading(true);
    try {
      const result = await api.disconnectGoogleCalendar();
      await setUserProfile({
        calendarUrls: userProfile.calendarUrls.filter(
          (url) => url !== result.sourceUrl,
        ),
        googleCalendarConnected: false,
      });
      await removeExternalEvents(result.sourceUrl);
      setIsGoogleCalendarConnected(false);
      toast.success("Disconnected Google Calendar.");
    } catch (error) {
      console.error("Failed to disconnect Google Calendar:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to disconnect Google Calendar",
      );
    } finally {
      setIsLoading(false);
    }
  };
  return (
    <div className="space-y-6">
      <div className="p-8 rounded-[2.5rem] bg-white/[0.01] border border-white/[0.03] backdrop-blur-sm space-y-8">
        <div className="space-y-1.5">
          <label>Google Connection</label>
          <p className="text-sm text-muted-foreground font-medium">
            Connect once and sync your Google events automatically.
          </p>
        </div>

        <div className="p-6 rounded-[1.5rem] bg-white/[0.02] border border-white/[0.03] flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={cn(
              "h-12 w-12 rounded-2xl flex items-center justify-center transition-all duration-500",
              isGoogleCalendarConnected ? "bg-primary/20 text-primary" : "bg-white/5 text-muted-foreground/40"
            )}>
              <Calendar className="h-6 w-6" />
            </div>
            <div>
              <p className="font-bold text-foreground">Google Calendar</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 mt-0.5">
                {isGoogleCalendarConnected ? "Synced & Active" : "Not Linked"}
              </p>
            </div>
          </div>
          <div className={cn(
            "h-2 w-2 rounded-full",
            isGoogleCalendarConnected ? "bg-primary shadow-[0_0_10px_var(--color-primary)]" : "bg-white/10"
          )} />
        </div>

        <div className="flex gap-3 pt-2">
          {!isGoogleCalendarConnected ? (
            <Button
              onClick={handleConnectGoogleCalendar}
              className="h-14 flex-1 rounded-2xl font-black uppercase tracking-widest bg-primary text-primary-foreground shadow-2xl"
            >
              Connect Account
            </Button>
          ) : (
            <>
              <Button
                onClick={handleSyncConnectedGoogleCalendar}
                disabled={isLoading}
                className="h-14 flex-1 rounded-2xl font-black uppercase tracking-widest bg-primary text-primary-foreground shadow-2xl"
              >
                {isLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Sync Now
              </Button>
              <Button
                variant="outline"
                onClick={handleDisconnectGoogleCalendar}
                disabled={isLoading}
                className="h-14 rounded-2xl font-bold border-white/5 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20 transition-all px-6"
              >
                Disconnect
              </Button>
            </>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowDialog(true)}
        className="group w-full p-8 rounded-[2.5rem] bg-white/[0.01] border border-white/[0.03] backdrop-blur-sm flex items-center justify-between transition-all hover:bg-white/[0.03] hover:border-primary/20"
      >
        <div className="flex items-center gap-6">
          <div className="h-14 w-14 rounded-3xl bg-white/5 flex items-center justify-center text-muted-foreground group-hover:text-primary transition-colors">
            <Upload className="h-6 w-6" />
          </div>
          <div className="text-left space-y-1">
            <p className="text-lg font-bold text-foreground">Import .ical</p>
            <p className="text-sm text-muted-foreground font-medium">Upload a file or paste a private link.</p>
          </div>
        </div>
        <div className="h-10 w-10 rounded-full border border-white/5 flex items-center justify-center group-hover:bg-primary group-hover:border-none transition-all">
          <Plus className="h-4 w-4 group-hover:text-primary-foreground" />
        </div>
      </button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[600px] border-none rounded-[3rem] bg-card/98 backdrop-blur-3xl shadow-4xl flex flex-col p-0 overflow-hidden">
          <div className="p-10 pb-0">
            <h2 className="text-3xl font-black tracking-tighter text-foreground">Import Calendar.</h2>
            <p className="opacity-40 font-medium text-sm">Choose how you'd like to sync your events.</p>
          </div>

          <div className="p-10 flex-1 overflow-y-auto custom-scrollbar">
            <Tabs defaultValue="url" className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-white/5 rounded-2xl p-1">
                <TabsTrigger value="url" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-bold text-[10px] uppercase tracking-widest py-3">
                  <Link className="mr-2 h-4 w-4" />
                  URL Sync
                </TabsTrigger>
                <TabsTrigger value="file" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-bold text-[10px] uppercase tracking-widest py-3">
                  <Upload className="mr-2 h-4 w-4" />
                  File Upload
                </TabsTrigger>
              </TabsList>

              <TabsContent value="url" className="space-y-8 pt-8 animate-in fade-in zoom-in-95 duration-500">
                <div className="p-6 rounded-[1.5rem] bg-white/[0.03] border border-white/[0.05] flex gap-4">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Info className="h-5 w-5 text-primary" />
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground font-medium">
                    <strong>Quick Tip:</strong> In Google Calendar, go to Settings → Integrate calendar → Copy "Secret address in iCal format".
                  </p>
                </div>
                <div className="space-y-3">
                  <Label htmlFor="calendarUrl" className="text-[10px] font-black uppercase tracking-widest opacity-40">iCal Private Link</Label>
                  <Input
                    id="calendarUrl"
                    placeholder="https://calendar.google.com/..."
                    value={calendarUrl}
                    onChange={(e) => setCalendarUrl(e.target.value)}
                    className="h-16 rounded-2xl bg-white/[0.02] border-white/5 px-6 text-lg font-bold focus:border-primary/20 transition-all"
                  />
                </div>
                <Button
                  onClick={handleSyncUrl}
                  disabled={isLoading}
                  className="w-full h-16 rounded-2xl font-black uppercase tracking-widest bg-primary text-primary-foreground shadow-2xl hover:scale-[1.02] transition-all"
                >
                  {isLoading ? <RefreshCw className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
                  Confirm Link
                </Button>
              </TabsContent>

              <TabsContent value="file" className="space-y-8 pt-8 animate-in fade-in zoom-in-95 duration-500">
                <div
                  className="flex cursor-pointer flex-col items-center justify-center rounded-[2.5rem] border-2 border-dashed border-white/5 bg-white/[0.01] p-16 transition-all hover:bg-white/[0.03] hover:border-primary/20 group"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="h-20 w-20 rounded-[2rem] bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500">
                    <Upload className="h-10 w-10 text-primary" />
                  </div>
                  <p className="text-xl font-black tracking-tight text-foreground">
                    Drop .ics here
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground font-medium opacity-40">
                    or click to browse files
                  </p>
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept=".ics,.ical"
                    onChange={handleFileUpload}
                  />
                </div>
                {isLoading && (
                  <div className="flex items-center justify-center gap-3 text-sm font-bold text-primary animate-pulse">
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    Processing Calendar...
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>

      {!compact && userProfile.calendarUrls.length > 0 && (
        <div className="p-8 rounded-[2.5rem] bg-white/[0.01] border border-white/[0.03] backdrop-blur-sm space-y-6">
          <div className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">Active Syncs</p>
            {lastCalendarSync && (
              <p className="text-xs text-muted-foreground font-medium">
                Last updated {format(new Date(lastCalendarSync), "PPp")}
              </p>
            )}
          </div>
          <div className="space-y-3">
            {userProfile.calendarUrls.map((url, index) => (
              <div
                key={index}
                className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.03] transition-all hover:bg-white/[0.04]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
                    <Calendar className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-bold truncate">
                    {url.startsWith("file://")
                      ? url.replace("file://", "File: ")
                      : url}
                  </span>
                </div>
                <div className="flex gap-2">
                  {!url.startsWith("file://") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-9 w-9 p-0 rounded-xl hover:bg-white/5"
                      onClick={() => handleResync(url)}
                      disabled={isLoading}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 w-9 p-0 rounded-xl hover:bg-destructive/10 text-destructive/40 hover:text-destructive"
                    onClick={() => handleRemoveCalendar(url)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
