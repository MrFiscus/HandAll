import { useMemo } from "react";
import { isSameDay } from "date-fns";
import { BatteryLow } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

export default function BurnoutDialog() {
  const {
    burnoutPromptPending,
    events,
    dailyXp,
    dismissBurnoutPrompt,
    snoozeBurnoutPrompt,
    rescheduleTodayTasks,
  } = useAppStore();

  const today = new Date();

  const { reschedulable, locked } = useMemo(() => {
    const todayIncomplete = events.filter(
      (e) => !e.completed && isSameDay(e.start, today),
    );
    // Only treat as deadline-locked if externally imported (has sourceUrl).
    // Manually created tasks are always reschedulable even if type is "assignment".
    const locked = todayIncomplete.filter(
      (e) => e.type === "assignment" && !!e.sourceUrl && isSameDay(e.end, today),
    );
    const reschedulable = todayIncomplete.filter(
      (e) => !(e.type === "assignment" && !!e.sourceUrl && isSameDay(e.end, today)),
    );
    return { reschedulable, locked };
  }, [events]);

  const handleReschedule = async () => {
    await rescheduleTodayTasks(reschedulable.map((e) => e.id));
    dismissBurnoutPrompt();
  };

  if (!burnoutPromptPending) return null;

  // No remaining tasks to reschedule — show a simpler "all done, rest up" message
  if (reschedulable.length === 0) {
    return (
      <Dialog open onOpenChange={dismissBurnoutPrompt}>
        <DialogContent className="sm:max-w-[500px] border-none rounded-[3rem] bg-card/98 backdrop-blur-3xl shadow-4xl p-12">
          <DialogHeader>
            <div className="flex items-center gap-4 mb-2">
              <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                <BatteryLow className="h-6 w-6 text-primary" />
              </div>
              <DialogTitle className="text-3xl font-black tracking-tighter">
                You've crushed it.
              </DialogTitle>
            </div>
          </DialogHeader>
          <div className="space-y-6">
            <p className="text-muted-foreground font-medium leading-relaxed">
              You've earned{" "}
              <span className="text-foreground font-black">{dailyXp} XP</span> today.
              That's a solid day's work — you're all caught up. Consider taking a real break.
            </p>
            <Button
              onClick={dismissBurnoutPrompt}
              className="w-full h-14 rounded-3xl font-black uppercase tracking-widest shadow-2xl"
            >
              Got it, thanks
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={dismissBurnoutPrompt}>
      <DialogContent className="sm:max-w-[500px] border-none rounded-[3rem] bg-card/98 backdrop-blur-3xl shadow-4xl p-12">
        <DialogHeader>
          <div className="flex items-center gap-4 mb-2">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <BatteryLow className="h-6 w-6 text-primary" />
            </div>
            <DialogTitle className="text-3xl font-black tracking-tighter">
              You've crushed it.
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          <p className="text-muted-foreground font-medium leading-relaxed">
            You've earned{" "}
            <span className="text-foreground font-black">{dailyXp} XP</span> today.
            That's a solid day's work. Want me to move your remaining flexible tasks to
            tomorrow so you can rest?
          </p>

          {locked.length > 0 && (
            <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/5">
              <p className="text-xs uppercase tracking-widest text-muted-foreground/60 font-black mb-3">
                Staying today — due today
              </p>
              <ul className="space-y-1">
                {locked.map((e) => (
                  <li key={e.id} className="text-sm font-medium text-foreground/70">
                    • {e.title}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/5">
            <p className="text-xs uppercase tracking-widest text-muted-foreground/60 font-black mb-3">
              Moving to tomorrow
            </p>
            <ul className="space-y-1">
              {reschedulable.map((e) => (
                <li key={e.id} className="text-sm font-medium text-foreground/70">
                  • {e.title}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3 pt-2">
            <Button
              onClick={handleReschedule}
              className="w-full h-14 rounded-3xl font-black uppercase tracking-widest shadow-2xl"
            >
              Yes, move them to tomorrow
            </Button>
            <Button
              onClick={snoozeBurnoutPrompt}
              variant="outline"
              className="w-full h-12 rounded-3xl font-bold border-white/10"
            >
              Remind me in an hour
            </Button>
            <Button
              onClick={dismissBurnoutPrompt}
              variant="ghost"
              className="w-full h-12 rounded-3xl font-bold text-muted-foreground/60"
            >
              No, I'll keep going
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
