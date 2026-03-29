import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { useAppStore } from "../store/useAppStore";
import { Calendar, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Loader2, Sparkles, Target } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import CalendarSync from "./CalendarSync";

const AGENT_USER_ID_KEY = "handall-agent-user-id";

const STEPS = [
  {
    id: 1,
    eyebrow: "Step 1",
    title: "Make HandAll feel like yours",
    description: "Start with your name and the study goals you actually care about this term.",
    icon: Sparkles,
  },
  {
    id: 2,
    eyebrow: "Step 2",
    title: "Shape your daily rhythm",
    description: "Tell us when your day usually starts and ends so planning suggestions fit real life.",
    icon: Clock3,
  },
  {
    id: 3,
    eyebrow: "Step 3",
    title: "Bring your calendar in",
    description: "Connect Google Calendar, upload an .ical file, or paste an iCal link to pull in your schedule.",
    icon: Calendar,
  },
];

export default function Setup() {
  const navigate = useNavigate();
  const { setUserProfile, completeSetup, lastMotivation, userProfile } = useAppStore();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: userProfile.name === "Student" ? "" : userProfile.name,
    wakeTime: userProfile.wakeTime || "07:00",
    sleepTime: userProfile.sleepTime || "23:00",
    sideGoals: userProfile.sideGoals.join("\n"),
  });

  const activeStep = STEPS[step - 1];
  const completion = useMemo(() => Math.round((step / STEPS.length) * 100), [step]);
  const sideGoalCount = formData.sideGoals
    .split("\n")
    .map((goal) => goal.trim())
    .filter(Boolean).length;

  const handleNext = async () => {
    if (step < STEPS.length) {
      setStep((current) => current + 1);
      return;
    }

    setIsSubmitting(true);
    try {
      const sideGoals = formData.sideGoals
        .split("\n")
        .map((goal) => goal.trim())
        .filter(Boolean);

      await setUserProfile({
        name: formData.name.trim() || "Student",
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
      toast.success("Setup complete");
      navigate("/");
    } catch (error) {
      console.error("Failed to complete setup:", error);
      toast.error(error instanceof Error ? error.message : "Failed to complete setup.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.18),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.16),_transparent_30%),linear-gradient(180deg,_#f8fbff_0%,_#eef5ff_100%)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl gap-6 lg:grid-cols-[1.02fr_1.18fr]">
        <Card className="relative overflow-hidden border-white/70 bg-slate-950 text-white shadow-[0_28px_80px_rgba(15,23,42,0.28)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.22),transparent_36%)]" />
          <CardContent className="relative flex h-full flex-col justify-between gap-8 p-6 sm:p-8">
            <div className="space-y-8">
              <div className="space-y-4">
                <Badge className="w-fit border-white/10 bg-white/10 text-blue-50 hover:bg-white/10">
                  HandAll onboarding
                </Badge>
                <div className="space-y-3">
                  <h1 className="max-w-md text-3xl font-semibold leading-tight sm:text-4xl">
                    Set up a planner that actually respects your real schedule.
                  </h1>
                  <p className="max-w-lg text-sm leading-6 text-blue-100/85 sm:text-base">
                    We’ll save your routine, your goals, and your calendar sources so HandAll can build useful study blocks instead of generic reminders.
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
                          ? "border-cyan-300/40 bg-white/12 shadow-[0_0_0_1px_rgba(125,211,252,0.18)]"
                          : "border-white/10 bg-white/5"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl ${
                          isDone
                            ? "bg-emerald-400/20 text-emerald-200"
                            : isCurrent
                              ? "bg-cyan-300/18 text-cyan-100"
                              : "bg-white/10 text-blue-100"
                        }`}>
                          {isDone ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs uppercase tracking-[0.18em] text-blue-100/60">{item.eyebrow}</p>
                          <p className="font-medium text-white">{item.title}</p>
                          <p className="text-sm leading-5 text-blue-100/72">{item.description}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-blue-100/65">
                  <span>Progress</span>
                  <span>{completion}%</span>
                </div>
                <Progress value={completion} className="h-2 bg-white/10" />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-blue-100/60">Profile</p>
                  <p className="mt-2 text-lg font-semibold">{formData.name.trim() || "Student"}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-blue-100/60">Routine</p>
                  <p className="mt-2 text-lg font-semibold">{formData.wakeTime} - {formData.sleepTime}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-blue-100/60">Goals</p>
                  <p className="mt-2 text-lg font-semibold">{sideGoalCount}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/70 bg-white/88 shadow-[0_28px_70px_rgba(148,163,184,0.18)] backdrop-blur">
          <CardContent className="flex h-full flex-col p-6 sm:p-8">
            <div className="mb-6 space-y-3">
              <Badge variant="secondary" className="w-fit">
                {activeStep.eyebrow}
              </Badge>
              <div className="space-y-2">
                <h2 className="text-3xl font-semibold tracking-tight text-slate-950">{activeStep.title}</h2>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">{activeStep.description}</p>
              </div>
            </div>

            <div className="flex-1 space-y-6">
              {step === 1 && (
                <div className="space-y-6">
                  <div className="grid gap-5 md:grid-cols-[1.05fr_0.95fr]">
                    <div className="space-y-4 rounded-3xl border bg-slate-50/90 p-5">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-slate-900">Display name</p>
                        <p className="text-sm text-slate-500">This is what HandAll will show across your dashboard and profile area.</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="name">Name</Label>
                        <Input
                          id="name"
                          placeholder="Student"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          className="h-11"
                        />
                      </div>
                    </div>

                    <div className="rounded-3xl border bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-5">
                      <div className="mb-4 flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white">
                          <Sparkles className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">What to expect</p>
                          <p className="text-sm text-slate-600">A quick setup that shapes every suggestion later.</p>
                        </div>
                      </div>
                      <div className="space-y-3 text-sm text-slate-600">
                        <p>HandAll uses your routine, your side goals, and your calendar to create more realistic study blocks.</p>
                        <p>You can change everything later from Settings, so this first pass just needs to be directionally right.</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-3xl border bg-white p-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                        <Target className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">Side goals</p>
                        <p className="text-sm text-slate-500">One per line. These help HandAll suggest goal tasks and events that matter to you.</p>
                      </div>
                    </div>
                    <Textarea
                      id="sideGoals"
                      placeholder={"Bench press 135 pounds\nRead more consistently\nBuild a stronger coding portfolio"}
                      rows={6}
                      value={formData.sideGoals}
                      onChange={(e) => setFormData({ ...formData, sideGoals: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6">
                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="rounded-3xl border bg-slate-50/90 p-5 space-y-4">
                      <div className="space-y-1">
                        <p className="font-medium text-slate-900">Wake time</p>
                        <p className="text-sm text-slate-500">When should HandAll assume your day can start?</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="wakeTime">Wake Time</Label>
                        <Input
                          id="wakeTime"
                          type="time"
                          value={formData.wakeTime}
                          onChange={(e) => setFormData({ ...formData, wakeTime: e.target.value })}
                          className="h-11"
                        />
                      </div>
                    </div>

                    <div className="rounded-3xl border bg-slate-50/90 p-5 space-y-4">
                      <div className="space-y-1">
                        <p className="font-medium text-slate-900">Sleep time</p>
                        <p className="text-sm text-slate-500">When should the planner stop suggesting work for the night?</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="sleepTime">Sleep Time</Label>
                        <Input
                          id="sleepTime"
                          type="time"
                          value={formData.sleepTime}
                          onChange={(e) => setFormData({ ...formData, sleepTime: e.target.value })}
                          className="h-11"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-5 text-white">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10">
                        <Clock3 className="h-5 w-5 text-cyan-200" />
                      </div>
                      <div className="space-y-2">
                        <p className="font-medium">Why this matters</p>
                        <p className="text-sm leading-6 text-blue-100/80">
                          HandAll uses this window to avoid placing focus blocks at unrealistic times and to protect free time outside your normal day.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-6">
                  <div className="rounded-3xl border bg-slate-50/80 p-5">
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white">
                        <Calendar className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">Calendar import options</p>
                        <p className="text-sm text-slate-500">Use whichever setup path is easiest right now. You can add or remove sources later.</p>
                      </div>
                    </div>
                    <CalendarSync redirectPath="/setup" />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-8 flex items-center justify-between gap-3 border-t pt-6">
              <Button
                variant="outline"
                onClick={() => setStep((current) => Math.max(1, current - 1))}
                disabled={step === 1 || isSubmitting}
              >
                <ChevronLeft className="mr-2 h-4 w-4" />
                Back
              </Button>

              <Button className="min-w-[180px]" onClick={handleNext} disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {step === STEPS.length ? "Finish setup" : "Continue"}
                {step !== STEPS.length ? <ChevronRight className="ml-2 h-4 w-4" /> : null}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
