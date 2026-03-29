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
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

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
    <div className="space-y-4">
      <Card className="rounded-[1.45rem] border border-border/70 bg-card/75 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
        <CardHeader className="px-5 pb-2 pt-5">
          <CardTitle
            className="text-base font-semibold tracking-tight text-foreground"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Add your calendar
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Connect Google or import an `.ical` file or link.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-5 pb-5">
          <div className="rounded-[1.2rem] border border-border/70 bg-background/45 p-3.5">
            <div className="mb-2.5 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  Google Calendar
                </p>
                <p className="text-xs text-muted-foreground">
                  Connect once and sync later.
                </p>
              </div>
              <div
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  isGoogleCalendarConnected
                    ? "bg-green-100 text-green-700"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {isGoogleCalendarConnected ? "Connected" : "Not connected"}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-black/10 p-3">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-foreground/70">
                Connection status
              </p>
              <p className="text-sm leading-5 text-muted-foreground">
                {isGoogleCalendarConnected
                  ? "Connected and ready to sync."
                  : "Not connected yet."}
              </p>
            </div>

            <div className="mt-3 flex gap-2">
              {!isGoogleCalendarConnected ? (
                <Button
                  onClick={handleConnectGoogleCalendar}
                  className="h-11 flex-1 rounded-xl"
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  Connect Google Calendar
                </Button>
              ) : (
                <>
                  <Button
                    onClick={handleSyncConnectedGoogleCalendar}
                    disabled={isLoading}
                    className="h-11 flex-1 rounded-xl"
                  >
                    {isLoading ? (
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Sync Connected Calendar
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDisconnectGoogleCalendar}
                    disabled={isLoading}
                    className="h-11 rounded-xl"
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
            className="group flex w-full items-center justify-between rounded-[1.2rem] border border-border/70 bg-background/45 p-3.5 text-left transition-colors hover:bg-background/60"
          >
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/14 text-primary">
                <Upload className="h-4.5 w-4.5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  Import `.ical` file or link
                </p>
                <p className="text-xs text-muted-foreground">
                  Upload a file or paste a private iCal URL.
                </p>
              </div>
            </div>
            <div className="rounded-full border border-border/70 bg-background/75 px-3 py-1 text-xs font-semibold text-foreground transition-colors group-hover:border-primary/30 group-hover:text-primary">
              Import
            </div>
          </button>
        </CardContent>
      </Card>

      {showDialog ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-[#163f28] p-4">
          <div className="w-full max-w-2xl rounded-[1.75rem] border border-white/10 bg-[#1f5a36] p-6 shadow-[0_28px_80px_rgba(15,23,42,0.35)]">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-xl font-semibold text-foreground">
                  Import Calendar Events
                </h3>
                <p className="text-sm text-muted-foreground">
                  Choose how you'd like to import your external events.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDialog(false)}
                className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <span className="sr-only">Close</span>
                <X className="h-4 w-4" />
              </button>
            </div>

            <Tabs defaultValue="url" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="url">
                  <Link className="mr-2 h-4 w-4" />
                  URL Sync
                </TabsTrigger>
                <TabsTrigger value="file">
                  <Upload className="mr-2 h-4 w-4" />
                  File Upload
                </TabsTrigger>
              </TabsList>

              <TabsContent value="url" className="space-y-4 pt-4">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    <strong>Google Calendar:</strong> Settings → Your calendar
                    → Integrate calendar → Copy "Secret address in iCal format"
                  </AlertDescription>
                </Alert>
                <div className="space-y-2">
                  <Label htmlFor="calendarUrl">iCal URL</Label>
                  <Input
                    id="calendarUrl"
                    placeholder="https://calendar.google.com/calendar/ical/..."
                    value={calendarUrl}
                    onChange={(e) => setCalendarUrl(e.target.value)}
                  />
                </div>
                <Button
                  onClick={handleSyncUrl}
                  disabled={isLoading}
                  className="w-full"
                >
                  {isLoading ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  {isLoading ? "Syncing..." : "Sync from URL"}
                </Button>
              </TabsContent>

              <TabsContent value="file" className="space-y-4 pt-4">
                <div
                  className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors hover:bg-muted/50"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mb-4 h-12 w-12 text-muted-foreground" />
                  <p className="text-sm font-medium">
                    Click to upload or drag and drop
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Supports .ics, .ical files
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
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Parsing file...
                  </div>
                )}
              </TabsContent>
            </Tabs>

          </div>
        </div>
      ) : null}

      {!compact && userProfile.calendarUrls.length > 0 && (
        <Card className="rounded-[1.6rem] border border-border/70 bg-card/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Active Imports</CardTitle>
            <CardDescription className="text-xs">
              {lastCalendarSync &&
                `Last sync: ${format(new Date(lastCalendarSync), "PPp")}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {userProfile.calendarUrls.map((url, index) => (
              <div
                key={index}
                className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 p-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Calendar className="h-4 w-4 flex-shrink-0 text-blue-500" />
                  <span className="text-xs truncate">
                    {url.startsWith("file://")
                      ? url.replace("file://", "Uploaded: ")
                      : url}
                  </span>
                </div>
                <div className="flex gap-1">
                  {!url.startsWith("file://") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => handleResync(url)}
                      disabled={isLoading}
                    >
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                    onClick={() => handleRemoveCalendar(url)}
                  >
                    <AlertCircle className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
