import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./ui/card";
import { useAppStore } from "../store/useAppStore";
import { Calendar, Clock, Target } from "lucide-react";

export default function Setup() {
  const navigate = useNavigate();
  const { setUserProfile, completeSetup } = useAppStore();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    wakeTime: "07:00",
    sleepTime: "23:00",
    sideGoals: "",
    calendarUrl: "",
  });

  const handleNext = () => {
    if (step < 3) {
      setStep(step + 1);
    } else {
      // Complete setup
      setUserProfile({
        wakeTime: formData.wakeTime,
        sleepTime: formData.sleepTime,
        sideGoals: formData.sideGoals.split("\n").filter(g => g.trim()),
        calendarUrls: formData.calendarUrl ? [formData.calendarUrl] : [],
      });
      completeSetup();
      navigate("/");
    }
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
                <Label htmlFor="calendarUrl">Calendar URL (Optional)</Label>
                <Input
                  id="calendarUrl"
                  placeholder="https://calendar.google.com/calendar/ical/..."
                  value={formData.calendarUrl}
                  onChange={(e) => setFormData({ ...formData, calendarUrl: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  You can add .ical, .cal files or calendar URLs. You can also add events manually later.
                </p>
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
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <Button className="ml-auto" onClick={handleNext}>
            {step === 3 ? "Complete Setup" : "Next"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
