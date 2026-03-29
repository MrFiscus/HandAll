import { useState } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { X, ArrowRight, Calendar, Brain, Zap, Sparkles, Clock, Target } from "lucide-react";
import { cn } from "./ui/utils";

interface WelcomeGuideProps {
  onClose: () => void;
}

export default function WelcomeGuide({ onClose }: WelcomeGuideProps) {
  const [step, setStep] = useState(0);

  const steps = [
    {
      icon: <Sparkles className="h-16 w-16 text-primary" />,
      title: "Welcome to HandAll",
      description:
        "Your AI-powered time management sanctuary. We help you navigate student life with focus, balance, and intentional rest.",
    },
    {
      icon: <Calendar className="h-16 w-16 text-primary" />,
      title: "Visual Planning",
      description:
        "Switch between Daily and Weekly views. Use the 'Add Event' button with our custom date and time pickers to keep your path organized.",
    },
    {
      icon: <Zap className="h-16 w-16 text-primary" />,
      title: "Energy & Motivation",
      description:
        "Adjust your daily motivation slider. High energy? We'll push you toward your goals. Low energy? We'll prioritize rest and light tasks.",
    },
    {
      icon: <Brain className="h-16 w-16 text-primary" />,
      title: "AI Assistant",
      description:
        "Chat with your assistant to refine your schedule, break down big assignments into manageable blocks, and get smart suggestions.",
    },
    {
      icon: <Target className="h-16 w-16 text-primary" />,
      title: "The 50% Rule",
      description:
        "We only suggest tasks for 50% of your free time, ensuring you always have space for pure, uninterrupted rest.",
    },
  ];

  const currentStep = steps[step];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-500">
      <Card className="w-full max-w-[500px] border-none rounded-[3rem] bg-[#1a3a2a]/90 backdrop-blur-3xl shadow-4xl overflow-hidden animate-in zoom-in-95 duration-500">
        <CardContent className="p-12 relative">
          <button 
            onClick={onClose}
            className="absolute top-8 right-8 text-muted-foreground/40 hover:text-foreground transition-colors"
          >
            <X className="h-6 w-6" />
          </button>

          <div className="text-center space-y-8 mb-12">
            <div className="flex justify-center transition-transform duration-500 scale-110">
              {currentStep.icon}
            </div>
            <div className="space-y-4">
              <h2 className="text-4xl font-black tracking-tighter text-foreground">
                {currentStep.title}.
              </h2>
              <p className="text-lg font-medium text-muted-foreground leading-relaxed">
                {currentStep.description}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex gap-3">
              {steps.map((_, index) => (
                <div
                  key={index}
                  className={cn(
                    "h-1.5 transition-all duration-500 rounded-full",
                    index === step ? "w-8 bg-primary" : "w-1.5 bg-white/10"
                  )}
                />
              ))}
            </div>

            <div className="flex gap-4">
              {step < steps.length - 1 ? (
                <Button 
                  onClick={() => setStep(step + 1)}
                  className="h-14 px-8 rounded-2xl font-black uppercase tracking-widest shadow-2xl"
                >
                  Next
                  <ArrowRight className="ml-3 h-5 w-5" />
                </Button>
              ) : (
                <Button 
                  onClick={onClose}
                  className="h-14 px-8 rounded-2xl font-black uppercase tracking-widest shadow-2xl"
                >
                  Get Started
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
