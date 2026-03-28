import { useState } from "react";
import { useNavigate } from "react-router";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { useAppStore } from "../store/useAppStore";
import { Heart, Zap, Coffee } from "lucide-react";

export default function DailyCheckIn() {
  const navigate = useNavigate();
  const { setMotivation, lastMotivation } = useAppStore();
  const [motivation, setMotivationLocal] = useState(lastMotivation);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    setMotivation(motivation);
    setSubmitted(true);

    setTimeout(() => {
      navigate("/");
    }, 2000);
  };

  const getMotivationMessage = () => {
    if (motivation <= 10) {
      return {
        title: "You're redlining.",
        message:
          "I've identified three non-essential tasks I can push to next week. Should I clear your schedule for the next 4 hours?",
        icon: <Heart className="h-12 w-12 text-red-500" />,
        color: "text-red-600",
      };
    } else if (motivation <= 40) {
      return {
        title: "Taking it easy today",
        message:
          "Let's focus on lighter tasks and free time activities. Your well-being comes first.",
        icon: <Coffee className="h-12 w-12 text-orange-500" />,
        color: "text-orange-600",
      };
    } else if (motivation <= 70) {
      return {
        title: "Feeling balanced",
        message:
          "Great! I'll suggest a good mix of work tasks and personal goals for today.",
        icon: <Zap className="h-12 w-12 text-blue-500" />,
        color: "text-blue-600",
      };
    } else {
      return {
        title: "High energy mode!",
        message:
          "Awesome! I'll prioritize your goal tasks today to help you make the most of this momentum.",
        icon: <Zap className="h-12 w-12 text-green-500" />,
        color: "text-green-600",
      };
    }
  };

  const motivationData = getMotivationMessage();

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Daily Check-in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          {!submitted ? (
            <>
              <div className="text-center space-y-4">
                <h2 className="text-2xl font-semibold">
                  How motivated are we feeling today?
                </h2>
                <div className="flex items-center justify-center py-8">
                  {motivationData.icon}
                </div>
                <p className={`text-xl font-medium ${motivationData.color}`}>
                  {motivationData.title}
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>0 - Not motivated</span>
                  <span className="text-2xl font-bold">{motivation}</span>
                  <span>100 - Very motivated</span>
                </div>
                <Slider
                  value={[motivation]}
                  onValueChange={(value) => setMotivationLocal(value[0])}
                  max={100}
                  step={1}
                  className="w-full"
                />
              </div>

              <div className="p-4 bg-secondary rounded-lg">
                <p className="text-sm">{motivationData.message}</p>
              </div>

              <Button onClick={handleSubmit} className="w-full" size="lg">
                Continue to Dashboard
              </Button>
            </>
          ) : (
            <div className="text-center py-12 space-y-4">
              <div className="flex justify-center">{motivationData.icon}</div>
              <h3 className="text-2xl font-semibold">Got it!</h3>
              <p className="text-muted-foreground">
                I've adjusted your schedule based on your motivation level.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
