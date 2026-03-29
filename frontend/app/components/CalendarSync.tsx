import { useEffect, useState, useRef } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Alert, AlertDescription } from "./ui/alert";
import { useAppStore } from "../store/useAppStore";
import { convertCalendarEventsToTaskPreview, fetchCalendarEvents, formatCalendarDateTime, parseICalData, resolveCalendarImportUrl } from "../utils/calendarSync";
import { RefreshCw, Calendar, AlertCircle, CheckCircle2, Info, Upload, Link } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { CalendarEvent } from "../store/useAppStore";
import { api } from "../utils/api";
import { supabase } from "../lib/supabase";

const GOOGLE_CALENDAR_CONNECT_QUERY = "google_calendar_connect";

interface CalendarSyncProps {
  redirectPath?: string;
}

export default function CalendarSync({ redirectPath = "/settings" }: CalendarSyncProps) {
  const { userProfile, setUserProfile, syncCalendarEvents, removeExternalEvents, lastCalendarSync } = useAppStore();
  const [calendarUrl, setCalendarUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [previewEvents, setPreviewEvents] = useState<CalendarEvent[]>([]);
  const [previewSource, setPreviewSource] = useState<string | null>(null);
  const [isGoogleCalendarConnected, setIsGoogleCalendarConnected] = useState(userProfile.googleCalendarConnected);
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

  const clearPreview = () => {
    setPreviewEvents([]);
    setPreviewSource(null);
  };

  const handleImportPreview = async () => {
    if (!previewSource || previewEvents.length === 0) {
      toast.error("Nothing to import yet.");
      return;
    }

    setIsLoading(true);
    try {
      const previewTasks = convertCalendarEventsToTaskPreview(previewEvents);

      await syncCalendarEvents(previewEvents, previewSource);
      const persistenceResult = await api.saveCalendarImportBreakdown({
        sourceUrl: previewSource,
        importType: previewSource.startsWith("file://") ? "file-upload" : "url-sync",
        events: previewEvents.map((event) => ({
          id: event.id,
          title: event.title,
          description: event.description,
          start: formatCalendarDateTime(event.start),
          end: formatCalendarDateTime(event.end),
          type: event.type,
          sourceUrl: event.sourceUrl ?? previewSource,
        })),
        tasks: previewTasks,
      });

      if (!userProfile.calendarUrls.includes(previewSource)) {
        await setUserProfile({
          calendarUrls: [...userProfile.calendarUrls, previewSource],
        });
      }

      toast.success(`Imported ${previewEvents.length} events into HandAll and saved the breakdown to ${persistenceResult.filePath}.`);
      clearPreview();
      setShowDialog(false);
      setCalendarUrl("");
    } catch (error) {
      console.error("Calendar import error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to import calendar");
    } finally {
      setIsLoading(false);
    }
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

      setPreviewEvents(events);
      setPreviewSource(icalUrl);
      toast.success(`Loaded ${events.length} events. Review the breakdown before importing.`);
    } catch (error) {
      console.error("Calendar sync error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to sync calendar");
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
          setPreviewEvents(events);
          setPreviewSource(fileSource);
          toast.success(`Loaded ${events.length} events from ${file.name}. Review the breakdown before importing.`);
        } catch (err) {
          toast.error("Failed to parse .ical file. Please ensure it's a valid iCal format.");
        } finally {
          setIsLoading(false);
        }
      };
      reader.readAsText(file);
    } catch (error) {
      toast.error("Failed to read file");
      setIsLoading(false);
    }
  };

  const handleResync = async (url: string) => {
    if (url.startsWith('file://')) {
        toast.info("Local files cannot be resynced automatically. Please upload the file again if it changed.");
        return;
    }
    setIsLoading(true);
    try {
      const events = await fetchCalendarEvents(url);
      await syncCalendarEvents(events, url);
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
      const importedEvents = api.mapGoogleEventsToCalendarEvents(result.events, result.sourceUrl);
      await syncCalendarEvents(importedEvents, result.sourceUrl);
      toast.success(`Synced ${importedEvents.length} events from your connected Google Calendar.`);
    } catch (error) {
      console.error("Connected Google Calendar sync error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to sync connected Google Calendar");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnectGoogleCalendar = async () => {
    setIsLoading(true);
    try {
      const result = await api.disconnectGoogleCalendar();
      await setUserProfile({
        calendarUrls: userProfile.calendarUrls.filter((url) => url !== result.sourceUrl),
        googleCalendarConnected: false,
      });
      await removeExternalEvents(result.sourceUrl);
      setIsGoogleCalendarConnected(false);
      toast.success("Disconnected Google Calendar.");
    } catch (error) {
      console.error("Failed to disconnect Google Calendar:", error);
      toast.error(error instanceof Error ? error.message : "Failed to disconnect Google Calendar");
    } finally {
      setIsLoading(false);
    }
  };

  const previewTasks = convertCalendarEventsToTaskPreview(previewEvents);
  const summary = {
    total: previewEvents.length,
    classes: previewEvents.filter((event) => event.type === "class").length,
    assignments: previewEvents.filter((event) => event.type === "assignment").length,
    external: previewEvents.filter((event) => event.type === "external").length,
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Google Calendar</CardTitle>
          <CardDescription className="text-xs">
            Connect a real Google Calendar account once, then sync it later without relying on a temporary login token.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
            <div>
              <p className="text-sm font-medium">Connection status</p>
              <p className="text-xs text-muted-foreground">
                {isGoogleCalendarConnected ? "Connected and ready to sync." : "Not connected yet."}
              </p>
            </div>
            <div className={`rounded-full px-2 py-1 text-xs font-medium ${isGoogleCalendarConnected ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-700"}`}>
              {isGoogleCalendarConnected ? "Connected" : "Not connected"}
            </div>
          </div>

          <div className="flex gap-2">
            {!isGoogleCalendarConnected ? (
              <Button onClick={handleConnectGoogleCalendar} className="flex-1">
                <Calendar className="h-4 w-4 mr-2" />
                Connect Google Calendar
              </Button>
            ) : (
              <>
                <Button onClick={handleSyncConnectedGoogleCalendar} disabled={isLoading} className="flex-1">
                  {isLoading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Sync Connected Calendar
                </Button>
                <Button variant="outline" onClick={handleDisconnectGoogleCalendar} disabled={isLoading}>
                  Disconnect
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full">
            <Calendar className="h-4 w-4 mr-2" />
            Import Calendar (.ical / URL)
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Calendar Events</DialogTitle>
            <DialogDescription>
              Choose how you'd like to import your external events.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="url" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="url">
                <Link className="h-4 w-4 mr-2" />
                URL Sync
              </TabsTrigger>
              <TabsTrigger value="file">
                <Upload className="h-4 w-4 mr-2" />
                File Upload
              </TabsTrigger>
            </TabsList>

            <TabsContent value="url" className="space-y-4 pt-4">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <strong>Google Calendar:</strong> Settings → Your calendar → Integrate calendar → Copy "Secret address in iCal format"
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
              <Button onClick={handleSyncUrl} disabled={isLoading} className="w-full">
                {isLoading ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                {isLoading ? "Syncing..." : "Sync from URL"}
              </Button>
            </TabsContent>

            <TabsContent value="file" className="space-y-4 pt-4">
              <div className="flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-12 hover:bg-muted/50 transition-colors cursor-pointer" 
                   onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-sm font-medium">Click to upload or drag and drop</p>
                <p className="text-xs text-muted-foreground mt-1">Supports .ics, .ical files</p>
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

          {previewEvents.length > 0 && previewSource && (
            <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
              <div className="space-y-1">
                <h4 className="font-medium">Import Preview</h4>
                <p className="text-sm text-muted-foreground">
                  {previewSource.startsWith("file://")
                    ? `Ready to import from ${previewSource.replace("file://", "")}`
                    : `Ready to import from ${previewSource}`}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Classes</p>
                  <p className="text-xl font-semibold">{summary.classes}</p>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Assignments</p>
                  <p className="text-xl font-semibold">{summary.assignments}</p>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Other Events</p>
                  <p className="text-xl font-semibold">{summary.external}</p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Converted task preview</p>
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border bg-background p-3">
                  {previewTasks.slice(0, 8).map((task) => (
                    <div key={task.source_event_id} className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{task.task_name}</p>
                        <span className="text-xs uppercase text-muted-foreground">{task.priority}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{task.category}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {task.details || "No details provided."}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {format(new Date(task.due_start), "PPp")} - {format(new Date(task.due_end), "PPp")}
                      </p>
                    </div>
                  ))}
                  {previewTasks.length > 8 && (
                    <p className="text-xs text-muted-foreground">
                      Showing 8 of {previewTasks.length} converted items.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={clearPreview} disabled={isLoading}>
                  Clear Preview
                </Button>
                <Button onClick={handleImportPreview} disabled={isLoading}>
                  {isLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Import {summary.total} Events
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {userProfile.calendarUrls.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Active Imports</CardTitle>
            <CardDescription className="text-xs">
              {lastCalendarSync && `Last sync: ${format(new Date(lastCalendarSync), "PPp")}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {userProfile.calendarUrls.map((url, index) => (
              <div key={index} className="flex items-center justify-between gap-2 p-2 border rounded-lg bg-muted/20">
                <div className="flex items-center gap-2 min-w-0">
                  <Calendar className="h-4 w-4 flex-shrink-0 text-blue-500" />
                  <span className="text-xs truncate">{url.startsWith('file://') ? url.replace('file://', 'Uploaded: ') : url}</span>
                </div>
                <div className="flex gap-1">
                  {!url.startsWith('file://') && (
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleResync(url)} disabled={isLoading}>
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleRemoveCalendar(url)}>
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
