import { motion } from "framer-motion";
import { ArrowRight, CalendarDays, Sparkles, Zap, Brain, CheckCircle2, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router";

const features = [
  {
    icon: CalendarDays,
    title: "Visual Weekly Planner",
    description: "Drag-and-drop your week with an intuitive calendar that adapts to your rhythm.",
  },
  {
    icon: Brain,
    title: "AI-Powered Guidance",
    description: "Smart suggestions that learn your patterns and optimize your schedule automatically.",
  },
  {
    icon: Zap,
    title: "Energy Tracking",
    description: "Monitor your energy levels throughout the day to schedule tasks when you're at your peak.",
  },
  {
    icon: BarChart3,
    title: "Progress Insights",
    description: "Beautiful analytics that show your productivity trends and help you improve.",
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

export default function Index() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Ambient glow effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-accent/5 blur-[120px]" />
      </div>

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 md:px-12 py-6">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <span className="text-lg font-bold tracking-tight text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            HandAll AI
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => navigate("/signin")}>
            Sign In
          </Button>
          <Button size="sm" className="gap-1.5">
            Get Started <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 md:px-12 pt-16 md:pt-28 pb-20">
        <motion.div
          initial="hidden"
          animate="visible"
          className="text-center"
        >
          <motion.div
            variants={fadeUp}
            custom={0}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-primary text-sm mb-8"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Built for routines
          </motion.div>

          <motion.h1
            variants={fadeUp}
            custom={1}
            className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight text-foreground leading-[1.1] mb-6"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Your week,{" "}
            <span className="text-primary">simplified.</span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            custom={2}
            className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            HandAll keeps your classes, tasks, and motivation in one flow —
            so you can focus on doing, not planning.
          </motion.p>

          <motion.div variants={fadeUp} custom={3} className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" className="h-13 px-8 text-base gap-2 shadow-lg shadow-primary/20">
              Start Free <ArrowRight className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="lg" className="h-13 px-8 text-base">
              See How It Works
            </Button>
          </motion.div>
        </motion.div>
      </section>

      {/* Benefits strip */}
      <section className="relative z-10 border-y border-border/50 bg-secondary/30">
        <div className="max-w-5xl mx-auto px-6 md:px-12 py-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {benefits.map((item, i) => (
            <motion.div
              key={item}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              transition={{ delay: i * 0.1 }}
              viewport={{ once: true }}
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
              {item}
            </motion.div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 md:px-12 py-20 md:py-28">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2
            className="text-3xl md:text-4xl font-bold text-foreground mb-4"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Everything you need to stay on track
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Smart tools designed around how students actually work.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-5">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              custom={i}
              variants={fadeUp}
              className="group rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm p-7 hover:border-primary/30 hover:bg-card transition-all duration-300"
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                <f.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                {f.title}
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {f.description}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 max-w-3xl mx-auto px-6 md:px-12 pb-28">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-accent/5 p-10 md:p-14 text-center"
        >
          <h2
            className="text-2xl md:text-3xl font-bold text-foreground mb-4"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Ready to take control of your week?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
            Join students who plan smarter, not harder. Free to start, powerful when you need it.
          </p>
          <Button size="lg" className="h-13 px-10 text-base gap-2 shadow-lg shadow-primary/25">
            Get Started Free <ArrowRight className="w-4 h-4" />
          </Button>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/50 py-8 px-6 md:px-12">
        <div className="max-w-5xl mx-auto flex items-center justify-between text-sm text-muted-foreground">
          <span>© 2026 HandAll AI</span>
          <div className="flex gap-6">
            <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
            <a href="#" className="hover:text-foreground transition-colors">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
