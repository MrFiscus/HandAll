import { useState } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { X, ArrowRight, Calendar, Brain, Target, MessageSquare } from "lucide-react";

interface WelcomeGuideProps {
  onClose: () => void;
}

export default function WelcomeGuide({ onClose }: WelcomeGuideProps) {
  const [step, setStep] = useState(0);

  const steps = [
    {
      icon: <Calendar className="h-12 w-12 text-blue-500" />,
      title: "Welcome to HandAll!",
      description:
        "Your AI-powered time management assistant that helps students break down big tasks into manageable chunks and balance work with life.",
    },
    {
      icon: <Brain className="h-12 w-12 text-purple-500" />,
      title: "Weekly Sync",
      description:
        "Every Sunday, AI analyzes your calendar, breaks down assignments into working blocks, and suggests tasks for only 50% of your free time - the rest is pure rest time.",
    },
    {
      icon: <Target className="h-12 w-12 text-green-500" />,
      title: "Daily Check-in",
      description:
        "Start each day by rating your motivation (0-100). High motivation? You'll get more goal tasks. Low motivation? We'll suggest lighter activities. Redlining (0-10)? We'll clear your schedule.",
    },
    {
      icon: <MessageSquare className="h-12 w-12 text-orange-500" />,
      title: "AI Chat Assistant",
      description:
        "Use the floating chat button to talk with your AI assistant anytime. Add tasks, check your schedule, or get suggestions on the fly.",
    },
  ];

  const currentStep = steps[step];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="pt-6">
          <div className="flex justify-end mb-4">
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="text-center space-y-6 mb-6">
            <div className="flex justify-center">{currentStep.icon}</div>
            <div>
              <h2 className="text-2xl font-bold mb-2">{currentStep.title}</h2>
              <p className="text-muted-foreground">{currentStep.description}</p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {steps.map((_, index) => (
                <div
                  key={index}
                  className={`h-2 w-2 rounded-full ${
                    index === step ? "bg-blue-500" : "bg-gray-300"
                  }`}
                />
              ))}
            </div>

            <div className="flex gap-2">
              {step < steps.length - 1 ? (
                <Button onClick={() => setStep(step + 1)}>
                  Next
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={onClose}>Get Started</Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
