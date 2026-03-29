import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarDays,
  Sparkles,
  Zap,
  Brain,
  CheckCircle2,
  BarChart3,
} from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "./ui/button";

const features = [
  {
    icon: CalendarDays,
    title: "Visual Weekly Planner",
    description:
      "Drag-and-drop your week with an intuitive calendar that adapts to your rhythm.",
  },
  {
    icon: Brain,
    title: "AI-Powered Guidance",
    description:
      "Smart suggestions that learn your patterns and optimize your schedule automatically.",
  },
  {
    icon: Zap,
    title: "Energy Tracking",
    description:
      "Monitor your energy levels throughout the day to schedule tasks when you're at your peak.",
  },
  {
    icon: BarChart3,
    title: "Progress Insights",
    description:
      "Beautiful analytics that show your productivity trends and help you improve.",
  },
];

const benefits = [
  "Visual planning with AI guidance",
  "Side goals & community events",
  "Integrated productivity assistant",
  "Smart scheduling that respects your energy",
];

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease: "easeOut" },
  }),
};

export default function Auth() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen overflow-hidden bg-background">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] h-[60%] w-[60%] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute right-[-10%] bottom-[-20%] h-[50%] w-[50%] rounded-full bg-accent/5 blur-[120px]" />
      </div>

      <nav className="relative z-10 flex items-center justify-between px-6 py-6 md:px-12">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <span
            className="text-lg font-bold tracking-tight text-foreground"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            HandAll AI
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/signin")}
          >
            Sign In
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => navigate("/login")}>
            Get Started <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </nav>

      <section className="relative z-10 mx-auto max-w-5xl px-6 pt-16 pb-20 md:px-12 md:pt-28">
        <motion.div initial="hidden" animate="visible" className="text-center">
          <motion.div
            variants={fadeUp}
            custom={0}
            className="mb-8 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm text-primary"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Built for routines
          </motion.div>

          <motion.h1
            variants={fadeUp}
            custom={1}
            className="mb-6 text-4xl font-bold leading-[1.1] tracking-tight text-foreground md:text-6xl lg:text-7xl"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Your week,{" "}
            <span
              className="text-[1.2em] tracking-normal text-primary"
              style={{
                fontFamily:
                  '"Dancing Script", "Segoe Script", "Snell Roundhand", "Brush Script MT", cursive',
                fontWeight: 700,
              }}
            >
              Simplified.
            </span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            custom={2}
            className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl"
          >
            HandAll keeps your classes, tasks, and motivation in one flow so
            you can focus on doing, not planning.
          </motion.p>

          <motion.div
            variants={fadeUp}
            custom={3}
            className="flex flex-col items-center justify-center gap-4 sm:flex-row"
          >
            <Button
              size="lg"
              className="h-13 gap-2 px-8 text-base shadow-lg shadow-primary/20"
              onClick={() => navigate("/login")}
            >
              Get Started <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-13 px-8 text-base"
              onClick={() => navigate("/signin")}
            >
              Sign In
            </Button>
          </motion.div>
        </motion.div>
      </section>

      <section className="relative z-10 border-y border-border/50 bg-secondary/30">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-6 py-8 md:px-12">
          {benefits.map((item, i) => (
            <motion.div
              key={item}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              transition={{ delay: i * 0.1 }}
              viewport={{ once: true }}
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
              {item}
            </motion.div>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-5xl px-6 py-20 md:px-12 md:py-28">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-16 text-center"
        >
          <h2
            className="mb-4 text-3xl font-bold text-foreground md:text-4xl"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Everything you need to stay on track
          </h2>
          <p className="mx-auto max-w-xl text-lg text-muted-foreground">
            Smart tools designed around how students actually work.
          </p>
        </motion.div>

        <div className="grid gap-5 md:grid-cols-2">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              custom={i}
              variants={fadeUp}
              className="group rounded-2xl border border-border/60 bg-card/60 p-7 backdrop-blur-sm transition-all duration-300 hover:border-primary/30 hover:bg-card"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary/20">
                <feature.icon className="h-5 w-5 text-primary" />
              </div>
              <h3
                className="mb-2 text-lg font-semibold text-foreground"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                {feature.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-3xl px-6 pb-28 md:px-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-accent/5 p-10 text-center md:p-14"
        >
          <h2
            className="mb-4 text-2xl font-bold text-foreground md:text-3xl"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Ready to take control of your week?
          </h2>
          <p className="mx-auto mb-8 max-w-lg text-muted-foreground">
            Join students who plan smarter, not harder. Free to start, powerful
            when you need it.
          </p>
          <Button
            size="lg"
            className="h-13 gap-2 px-10 text-base shadow-lg shadow-primary/25"
            onClick={() => navigate("/login")}
          >
            Get Started Free <ArrowRight className="h-4 w-4" />
          </Button>
        </motion.div>
      </section>

      <footer className="relative z-10 border-t border-border/50 px-6 py-8 md:px-12">
        <div className="mx-auto flex max-w-5xl items-center justify-between text-sm text-muted-foreground">
          <span>© 2026 HandAll AI</span>
          <div className="flex gap-6">
            <a href="#" className="transition-colors hover:text-foreground">
              Privacy
            </a>
            <a href="#" className="transition-colors hover:text-foreground">
              Terms
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
