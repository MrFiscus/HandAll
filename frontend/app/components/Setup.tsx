import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./ui/card";
import { Alert, AlertDescription } from "./ui/alert";
import { useAppStore } from "../store/useAppStore";
import { fetchCalendarEvents, resolveCalendarImportUrl } from "../utils/calendarSync";
import { Calendar, Clock, Target, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
const AGENT_API_BASE_URL =
  import.meta.env.VITE_AGENT_API_URL?.replace(/\/$/, "") ?? "/agent-api";
const AGENT_USER_ID_KEY = "handall-agent-user-id";

export default function Setup() {
  const navigate = useNavigate();
  const { setUserProfile, completeSetup, syncCalendarEvents } = useAppStore();
  const [step, setStep] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    wakeTime: "07:00",
    sleepTime: "23:00",
    sideGoals: "",
    calendarUrl: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const resolvedCalendarUrl = resolveCalendarImportUrl(formData.calendarUrl);

  const handleNext = async () => {
    if (step < 3) {
      setStep(step + 1);
    } else {
      setIsSubmitting(true);
      try {
        const sideGoals = formData.sideGoals.split("\n").filter((goal) => goal.trim());
        const calendarUrls = resolvedCalendarUrl ? [resolvedCalendarUrl] : [];
        const userId = localStorage.getItem(AGENT_USER_ID_KEY) ?? crypto.randomUUID();

        localStorage.setItem(AGENT_USER_ID_KEY, userId);

        await setUserProfile({
          name: formData.name.trim() || "Student",
          wakeTime: formData.wakeTime,
          sleepTime: formData.sleepTime,
          sideGoals,
          calendarUrls,
        });

        const profileSyncResponse = await fetch(`${AGENT_API_BASE_URL}/profile/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: userId,
            name: formData.name.trim() || "Student",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            prefs: {
              wakeTime: formData.wakeTime,
              sleepTime: formData.sleepTime,
              sideGoals,
              calendarUrls,
            },
          }),
        });

        if (!profileSyncResponse.ok) {
          throw new Error(`AI backend returned ${profileSyncResponse.status}`);
        }

        if (resolvedCalendarUrl) {
          try {
            const events = await fetchCalendarEvents(resolvedCalendarUrl);
            await syncCalendarEvents(events, resolvedCalendarUrl);
            toast.success(`Synced ${events.length} events from your calendar!`);
          } catch (error) {
            console.error("Failed to sync calendar during setup:", error);
            toast.error("Calendar sync failed. You can try again from the dashboard.");
          }
        }
        completeSetup();
        toast.success("Setup synced with your AI agent");
        navigate("/");
      } catch (error) {
        console.error("Failed to complete setup:", error);
        toast.error("Failed to save profile or sync the AI backend.");
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleCalendarUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const url = e.target.value;
    setFormData({ ...formData, calendarUrl: url });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Welcome to HandAll</CardTitle>
          <CardDescription>
            Let's set up your personalized time management system (Step {step} of 3)
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-4">
                <Calendar className="h-8 w-8 text-blue-500" />
                <div>
                  <h3 className="font-semibold">Calendar Setup</h3>
                  <p className="text-sm text-muted-foreground">
                    Connect your calendar or add events manually
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Your Name</Label>
                <Input
                  id="name"
                  placeholder="Student"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="calendarUrl">Calendar URL (Optional)</Label>
                <Input
                  id="calendarUrl"
                  placeholder="https://calendar.google.com/calendar/ical/..."
                  value={formData.calendarUrl}
                  onChange={handleCalendarUrlChange}
                />
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    <strong>To get your Google Calendar URL:</strong> Open Google Calendar → Settings → Your calendar → Integrate calendar → Copy "Secret address in iCal format"
                  </AlertDescription>
                </Alert>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-4">
                <Clock className="h-8 w-8 text-purple-500" />
                <div>
                  <h3 className="font-semibold">Daily Schedule</h3>
                  <p className="text-sm text-muted-foreground">
                    When do you typically wake up and go to sleep?
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="wakeTime">Wake Time</Label>
                  <Input
                    id="wakeTime"
                    type="time"
                    value={formData.wakeTime}
                    onChange={(e) => setFormData({ ...formData, wakeTime: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sleepTime">Sleep Time</Label>
                  <Input
                    id="sleepTime"
                    type="time"
                    value={formData.sleepTime}
                    onChange={(e) => setFormData({ ...formData, sleepTime: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-4">
                <Target className="h-8 w-8 text-green-500" />
                <div>
                  <h3 className="font-semibold">Side Goals</h3>
                  <p className="text-sm text-muted-foreground">
                    What personal goals would you like to work on?
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sideGoals">Your Goals (one per line)</Label>
                <Textarea
                  id="sideGoals"
                  placeholder="Learn guitar&#10;Exercise 3x per week&#10;Read more books"
                  rows={5}
                  value={formData.sideGoals}
                  onChange={(e) => setFormData({ ...formData, sideGoals: e.target.value })}
                />
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex justify-between">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep(step - 1)} disabled={isSubmitting}>
              Back
            </Button>
          )}
          <Button className="ml-auto" onClick={handleNext} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {step === 3 ? "Complete Setup" : "Next"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
