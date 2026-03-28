import { useState, useRef } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Alert, AlertDescription } from "./ui/alert";
import { useAppStore } from "../store/useAppStore";
import { fetchCalendarEvents, getGoogleCalendarICalUrl, parseICalData } from "../utils/calendarSync";
import { RefreshCw, Calendar, AlertCircle, CheckCircle2, Info, Upload, Link } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export default function CalendarSync() {
  const { userProfile, setUserProfile, syncCalendarEvents, removeExternalEvents, lastCalendarSync } = useAppStore();
  const [calendarUrl, setCalendarUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSyncUrl = async () => {
    if (!calendarUrl.trim()) {
      toast.error("Please enter a calendar URL");
      return;
    }

    setIsLoading(true);
    try {
      let icalUrl = calendarUrl;
      if (calendarUrl.includes("google.com/calendar")) {
        const converted = getGoogleCalendarICalUrl(calendarUrl);
        if (converted) {
          icalUrl = converted;
        }
      }

      const events = await fetchCalendarEvents(icalUrl);
      
      if (events.length === 0) {
        toast.warning("No events found in calendar");
        setIsLoading(false);
        return;
      }

      syncCalendarEvents(events, icalUrl);

      if (!userProfile.calendarUrls.includes(icalUrl)) {
        await setUserProfile({
          calendarUrls: [...userProfile.calendarUrls, icalUrl],
        });
      }

      toast.success(`Synced ${events.length} events from calendar!`);
      setShowDialog(false);
      setCalendarUrl("");
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

          syncCalendarEvents(events, `file://${file.name}`);
          toast.success(`Successfully imported ${events.length} events from ${file.name}!`);
          setShowDialog(false);
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
      syncCalendarEvents(events, url);
      toast.success(`Resynced ${events.length} events!`);
    } catch (error) {
      console.error("Calendar resync error:", error);
      toast.error("Failed to resync calendar");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveCalendar = (url: string) => {
    setUserProfile({
      calendarUrls: userProfile.calendarUrls.filter((u) => u !== url),
    });
    // For simplicity, we just clear and let the user resync others or use local state
    // In a real app, you'd filter events by sourceUrl
    removeExternalEvents();
    toast.success("Calendar removed");
  };

  return (
    <div className="space-y-4">
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
