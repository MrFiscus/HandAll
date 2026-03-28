import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Alert, AlertDescription } from "./ui/alert";
import { useAppStore } from "../store/useAppStore";
import { fetchCalendarEvents, getGoogleCalendarICalUrl } from "../utils/calendarSync";
import { RefreshCw, Calendar, AlertCircle, CheckCircle2, Info } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function CalendarSync() {
  const { userProfile, setUserProfile, syncCalendarEvents, removeExternalEvents, lastCalendarSync } = useAppStore();
  const [calendarUrl, setCalendarUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  const handleSync = async () => {
    if (!calendarUrl.trim()) {
      toast.error("Please enter a calendar URL");
      return;
    }

    setIsLoading(true);
    try {
      // Try to convert Google Calendar URL to iCal format
      let icalUrl = calendarUrl;
      if (calendarUrl.includes("google.com/calendar")) {
        const converted = getGoogleCalendarICalUrl(calendarUrl);
        if (converted) {
          icalUrl = converted;
          toast.info("Converted to iCal format");
        } else {
          toast.error("Could not convert Google Calendar URL. Please use the public iCal URL instead.");
          setIsLoading(false);
          return;
        }
      }

      // Remove old external events before syncing new ones
      removeExternalEvents();

      // Fetch and parse events
      const events = await fetchCalendarEvents(icalUrl);
      
      if (events.length === 0) {
        toast.warning("No events found in calendar");
        setIsLoading(false);
        return;
      }

      // Add to store and persist to Supabase
      syncCalendarEvents(events, icalUrl);

      // Save URL to profile if not already there
      if (!userProfile.calendarUrls.includes(icalUrl)) {
        setUserProfile({
          calendarUrls: [...userProfile.calendarUrls, icalUrl],
        });
      }

      toast.success(`Synced ${events.length} events from calendar!`);
      setShowDialog(false);
      setCalendarUrl("");
    } catch (error) {
      console.error("Calendar sync error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to sync calendar. Please check the URL and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResync = async (url: string) => {
    setIsLoading(true);
    try {
      removeExternalEvents();
      const events = await fetchCalendarEvents(url);
      syncCalendarEvents(events);
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
    removeExternalEvents();
    toast.success("Calendar removed");
  };

  return (
    <div className="space-y-4">
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full">
            <Calendar className="h-4 w-4 mr-2" />
            Sync Google Calendar
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Sync Google Calendar</DialogTitle>
            <DialogDescription>
              Import events from your Google Calendar to see them in HandAll
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>How to get your Google Calendar link:</strong>
                <ol className="list-decimal ml-4 mt-2 space-y-1">
                  <li>Open Google Calendar on a computer</li>
                  <li>Click Settings (gear icon) → Settings</li>
                  <li>Select the calendar you want to sync from the left sidebar</li>
                  <li>Scroll to "Integrate calendar" section</li>
                  <li>Find "Secret address in iCal format" and click the iCal button</li>
                  <li>Copy the URL that appears</li>
                  <li>Paste it below and click Sync</li>
                </ol>
                <p className="mt-2 text-xs text-muted-foreground">
                  ⚠️ Note: This URL gives access to your calendar. Only share it with trusted apps. For a public calendar, you can also use the "Public URL to this calendar" link.
                </p>
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="calendarUrl">Calendar URL (iCal format)</Label>
              <Input
                id="calendarUrl"
                placeholder="https://calendar.google.com/calendar/ical/..."
                value={calendarUrl}
                onChange={(e) => setCalendarUrl(e.target.value)}
              />
            </div>

            <Button 
              onClick={handleSync} 
              disabled={isLoading} 
              className="w-full"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Sync Calendar
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Display synced calendars */}
      {userProfile.calendarUrls.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Synced Calendars</CardTitle>
            <CardDescription className="text-xs">
              {lastCalendarSync && `Last synced: ${format(new Date(lastCalendarSync), "PPp")}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {userProfile.calendarUrls.map((url, index) => (
              <div key={index} className="flex items-center justify-between gap-2 p-2 border rounded-lg">
                <div className="flex items-center gap-2 min-w-0">
                  <Calendar className="h-4 w-4 flex-shrink-0" />
                  <span className="text-sm truncate">{url.split("/").pop()}</span>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleResync(url)}
                    disabled={isLoading}
                  >
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveCalendar(url)}
                    disabled={isLoading}
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