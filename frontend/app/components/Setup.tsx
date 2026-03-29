import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { TimePickerField } from "./ui/time-picker";
import { useAppStore } from "../store/useAppStore";
import {
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import CalendarSync from "./CalendarSync";
import {
  clearSetupDraft,
  readSetupDraft,
  saveSetupDraft,
} from "../utils/setupDraft";

const AGENT_USER_ID_KEY = "handall-agent-user-id";
const DEFAULT_WAKE_TIME = "07:00";
const DEFAULT_SLEEP_TIME = "23:00";

const STEPS = [
  {
    id: 1,
    eyebrow: "Step 1",
    title: "Your profile",
    description: "Add your name and a few side goals.",
    icon: Sparkles,
  },
  {
    id: 2,
    eyebrow: "Step 2",
    title: "Your routine",
    description: "Choose when your day starts and ends.",
    icon: Clock3,
  },
  {
    id: 3,
    eyebrow: "Step 3",
    title: "Your calendar",
    description: "Connect or import your calendar.",
    icon: Calendar,
  },
];

export default function Setup() {
  const navigate = useNavigate();
  const { setUserProfile, completeSetup, lastMotivation, userProfile } =
    useAppStore();
  const initialDraft = readSetupDraft();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: initialDraft?.name ?? (userProfile.name === "Student" ? "" : userProfile.name),
    wakeTime: initialDraft?.wakeTime ?? (userProfile.wakeTime || DEFAULT_WAKE_TIME),
    sleepTime: initialDraft?.sleepTime ?? (userProfile.sleepTime || DEFAULT_SLEEP_TIME),
    sideGoals: initialDraft?.sideGoals ?? userProfile.sideGoals.join("\n"),
  });

  const activeStep = STEPS[step - 1];
  const completion = useMemo(
    () => Math.round((step / STEPS.length) * 100),
    [step],
  );
  const stepLabel = `Step ${step}/${STEPS.length}`;
  const handleNext = async () => {
    const trimmedName = formData.name.trim();
    const sideGoals = formData.sideGoals
      .split("\n")
      .map((goal) => goal.trim())
      .filter(Boolean);

    if (step === 1) {
      if (!trimmedName) {
        toast.error("Add your name before continuing.");
        return;
      }
      if (sideGoals.length === 0) {
        toast.error("Add at least one side goal before continuing.");
        return;
      }
    }

    if (step < STEPS.length) {
      saveSetupDraft({
        name: trimmedName,
        wakeTime: formData.wakeTime,
        sleepTime: formData.sleepTime,
        sideGoals: formData.sideGoals,
        motivation: lastMotivation,
      });
      setStep((current) => current + 1);
      return;
    }

    setIsSubmitting(true);
    try {
      await setUserProfile({
        name: trimmedName || "Student",
        wakeTime: formData.wakeTime,
        sleepTime: formData.sleepTime,
        sideGoals,
        motivation: lastMotivation,
      });

      const authId = (await supabase?.auth.getSession())?.data?.session?.user?.id;
      if (authId) {
        localStorage.setItem(AGENT_USER_ID_KEY, authId);
      }

      completeSetup();
      clearSetupDraft();
      toast.success("Setup complete");
      navigate("/");
    } catch (error) {
      console.error("Failed to complete setup:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to complete setup.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-background px-4 py-6 sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,var(--color-primary),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.06),transparent_28%)] opacity-20" />
      <div className="absolute inset-0 bg-black/30 backdrop-blur-md" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-20">
        <div className="absolute -left-20 top-10 h-96 w-96 rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute right-0 top-0 h-[500px] w-[500px] rounded-full bg-primary/10 blur-[150px]" />
        <div className="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-primary/15 blur-[100px]" />
      </div>

      <div className="relative z-10 mx-auto grid h-[calc(100vh-3rem)] max-w-6xl gap-6 lg:grid-cols-[1.02fr_1.18fr]">
        <Card className="relative overflow-hidden rounded-[2rem] border border-border/60 bg-muted text-foreground shadow-[0_28px_80px_rgba(15,23,42,0.22)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,var(--color-primary),transparent_38%)] opacity-10" />
          <CardContent className="relative flex h-full flex-col justify-between gap-8 p-6 sm:p-8">
            <div className="space-y-8">
              <div className="space-y-4">
                <Badge className="w-fit border-border/60 bg-background/75 text-foreground hover:bg-background/75">
                  HandAll onboarding
                </Badge>
                <div className="space-y-3">
                  <h1
                    className="max-w-md text-3xl font-semibold leading-tight sm:text-4xl"
                    style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                  >
                    Finish setup in three quick steps.
                  </h1>
                  <p className="max-w-lg text-sm leading-6 text-muted-foreground sm:text-base">
                    Keep it simple now. You can change everything later in
                    Settings.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {STEPS.map((item) => {
                  const Icon = item.icon;
                  const isCurrent = item.id === step;
                  const isDone = item.id < step;

                  return (
                    <div
                      key={item.id}
                      className={`rounded-2xl border px-4 py-4 transition-all ${
                        isCurrent
                          ? "border-primary/30 bg-background/70 shadow-[0_0_0_1px_rgba(221,251,92,0.12)]"
                          : "border-border/50 bg-background/40"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl ${
                            isDone
                              ? "bg-primary/18 text-primary"
                              : isCurrent
                                ? "bg-primary/16 text-primary"
                                : "bg-background/80 text-foreground/70"
                          }`}
                        >
                          {isDone ? (
                            <CheckCircle2 className="h-5 w-5" />
                          ) : (
                            <Icon className="h-5 w-5" />
                          )}
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            {item.eyebrow}
                          </p>
                          <p className="font-medium text-foreground">
                            {item.title}
                          </p>
                          <p className="text-sm leading-5 text-muted-foreground">
                            {item.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  <span>Progress</span>
                  <span>{stepLabel}</span>
                </div>
                <Progress value={completion} className="h-2 bg-background/70" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[2rem] border border-border/60 bg-card/72 shadow-[0_28px_70px_rgba(15,23,42,0.14)] backdrop-blur">
          <CardContent className="flex h-full min-h-0 flex-col p-6 sm:p-8">
            <div className="mb-6 space-y-3">
              <Badge
                variant="secondary"
                className="w-fit border-primary/10 bg-primary/10 text-primary"
              >
                {activeStep.eyebrow}
              </Badge>
              <div className="space-y-2">
                <h2
                  className="text-3xl font-black tracking-tight text-foreground sm:text-4xl"
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                >
                  {activeStep.title}
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  {activeStep.description}
                </p>
              </div>
            </div>

            <div className="flex-1 min-h-0 space-y-6 overflow-hidden">
              {step === 1 && (
                <div className="space-y-6">
                  <div className="space-y-7 rounded-[2rem] border border-border/60 bg-card/80 p-7 shadow-[0_18px_40px_rgba(15,23,42,0.12)] sm:p-8">
                    <div className="space-y-2">
                      <p
                        className="text-lg font-semibold tracking-tight text-foreground"
                        style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                      >
                        Your profile
                      </p>
                      <p className="text-sm leading-6 text-muted-foreground">
                        Add the basics so HandAll can personalize your planner.
                      </p>
                    </div>
                    <div className="space-y-3">
                      <Label
                        htmlFor="name"
                        className="text-xs font-black uppercase tracking-[0.22em] text-foreground/80"
                      >
                        Display name
                      </Label>
                      <Input
                        id="name"
                        placeholder="Student"
                        value={formData.name}
                        onChange={(e) =>
                          setFormData({ ...formData, name: e.target.value })
                        }
                        className="h-12 rounded-xl border-2 border-foreground/10 bg-black/10 text-foreground placeholder:text-foreground/45 focus-visible:border-primary/60 focus-visible:ring-primary/20"
                      />
                    </div>

                    <div className="space-y-3">
                      <Label
                        htmlFor="sideGoals"
                        className="text-xs font-black uppercase tracking-[0.22em] text-foreground/80"
                      >
                        Side goals
                      </Label>
                      <Textarea
                        id="sideGoals"
                        placeholder={
                          "Bench press 135 pounds\nRead more consistently\nBuild a stronger coding portfolio"
                        }
                        rows={6}
                        value={formData.sideGoals}
                        onChange={(e) =>
                          setFormData({ ...formData, sideGoals: e.target.value })
                        }
                        className="min-h-[152px] rounded-[1.75rem] border-2 border-foreground/10 bg-black/10 px-4 py-3 text-foreground placeholder:text-foreground/45 focus-visible:border-primary/60 focus-visible:ring-primary/20"
                      />
                      <p className="text-sm text-muted-foreground">
                        One goal per line.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6">
                  <div className="space-y-5">
                    <div className="space-y-4 rounded-3xl border border-border/60 bg-background/55 p-5 sm:p-6">
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">
                          Wake time
                        </p>
                        <p className="text-sm text-muted-foreground">
                          When should HandAll assume your day can start?
                        </p>
                      </div>
                      <TimePickerField
                          id="wakeTime"
                          label="Wake time"
                          value={formData.wakeTime}
                          onChange={(next) =>
                            setFormData({
                              ...formData,
                              wakeTime: next,
                            })
                          }
                        />
                    </div>

                    <div className="space-y-4 rounded-3xl border border-border/60 bg-background/55 p-5 sm:p-6">
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">
                          Sleep time
                        </p>
                        <p className="text-sm text-muted-foreground">
                          When should the planner stop suggesting work for the
                          night?
                        </p>
                      </div>
                      <TimePickerField
                          id="sleepTime"
                          label="Sleep time"
                          value={formData.sleepTime}
                          onChange={(next) =>
                            setFormData({
                              ...formData,
                              sleepTime: next,
                            })
                          }
                        />
                    </div>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="h-full min-h-0">
                  <div className="h-full overflow-y-auto rounded-[2rem] border border-white/5 bg-white/[0.01] backdrop-blur-sm p-6 sm:p-7 custom-scrollbar">
                    <CalendarSync redirectPath="/setup" compact />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-8 flex items-center justify-between gap-3 border-t border-border/60 pt-6">
              <Button
                variant="outline"
                onClick={() => setStep((current) => Math.max(1, current - 1))}
                disabled={step === 1 || isSubmitting}
                className="rounded-xl"
              >
                <ChevronLeft className="mr-2 h-4 w-4" />
                Back
              </Button>

              <Button
                className="min-w-[180px] rounded-xl"
                onClick={handleNext}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {step === STEPS.length ? "Finish setup" : "Continue"}
                {step !== STEPS.length ? (
                  <ChevronRight className="ml-2 h-4 w-4" />
                ) : null}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
