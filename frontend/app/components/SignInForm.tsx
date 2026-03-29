import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { toast } from "sonner";
import { useLocation, useNavigate } from "react-router";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";

function GoogleLogo() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M21.805 12.23c0-.79-.07-1.55-.2-2.28H12v4.32h5.49a4.7 4.7 0 0 1-2.04 3.08v2.56h3.3c1.93-1.78 3.055-4.4 3.055-7.68Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.76 0 5.07-.91 6.76-2.47l-3.3-2.56c-.91.61-2.08.98-3.46.98-2.66 0-4.92-1.8-5.73-4.22H2.86v2.64A10 10 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.27 13.73A5.96 5.96 0 0 1 5.95 12c0-.6.11-1.18.32-1.73V7.63H2.86A10 10 0 0 0 2 12c0 1.61.38 3.14 1.06 4.37l3.21-2.64Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.98c1.5 0 2.84.52 3.9 1.54l2.92-2.92C17.07 2.98 14.76 2 12 2A10 10 0 0 0 2.86 7.63l3.41 2.64C7.08 7.78 9.34 5.98 12 5.98Z"
        fill="#EA4335"
      />
    </svg>
  );
}

export default function SignInForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const isSignInRoute = location.pathname === "/signin";
  const [isSignUp, setIsSignUp] = useState(!isSignInRoute);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate("/");
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        navigate("/");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    setIsSignUp(!isSignInRoute);
  }, [isSignInRoute]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;

    if (isSignUp && !acceptedTerms) {
      toast.error("Please accept the terms to create your account.");
      return;
    }

    setLoading(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: `${firstName} ${lastName}`.trim(),
            },
          },
        });
        if (error) throw error;
        toast.success("Check your email for the confirmation link!");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        toast.success("Welcome back!");
        navigate("/");
      }
    } catch (error: any) {
      toast.error(error.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (!supabase) return;
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/`,
        },
      });
      if (error) throw error;
    } catch (error: any) {
      toast.error(error.message || "Google login failed");
    }
  };

  if (!supabase) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
        <Card className="w-full max-w-xl border-2 shadow-2xl">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <CardTitle className="text-3xl font-bold">Supabase Missing</CardTitle>
            <CardDescription className="text-base">
              Please check your environment configuration.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <pre className="overflow-x-auto rounded-xl border bg-black p-4 text-left font-mono text-xs text-green-400">
              VITE_SUPABASE_URL=...{"\n"}
              VITE_SUPABASE_ANON_KEY=...
            </pre>
            <Button
              onClick={() => window.location.reload()}
              className="w-full font-bold"
            >
              Retry Connection
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-4 font-plus sm:py-6">
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-20">
        <div className="absolute -left-20 top-10 h-96 w-96 rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute right-0 top-0 h-[500px] w-[500px] rounded-full bg-primary/10 blur-[150px]" />
        <div className="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-primary/15 blur-[100px]" />
      </div>

      <div className="relative w-full max-w-6xl">
        <Card className="w-full overflow-hidden border-2 bg-card/50 backdrop-blur-xl shadow-2xl">
          <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
            <div className="relative overflow-hidden bg-muted p-8 text-foreground sm:p-12 flex flex-col justify-between gap-10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,var(--color-primary),transparent_40%)] opacity-5" />
              
              <div className="relative space-y-6">
                <div className="inline-flex items-center gap-2 rounded-full border bg-background px-4 py-1.5 text-sm font-bold tracking-tight">
                  <Sparkles className="h-4 w-4 text-primary" />
                  HandAll AI
                </div>

                <div className="space-y-4">
                  <h1 className="text-4xl font-bold leading-[1.02] sm:text-5xl lg:text-6xl tracking-tight">
                    Your week,
                    <br />
                    <span
                      className="text-primary text-[1.2em] tracking-normal"
                      style={{
                        fontFamily: '"Dancing Script", "Segoe Script", "Snell Roundhand", "Brush Script MT", cursive',
                        fontWeight: 700,
                      }}
                    >
                      Simplified.
                    </span>
                  </h1>
                  <p className="max-w-lg text-base leading-relaxed text-muted-foreground font-medium">
                    HandAll keeps your classes, tasks, and motivation in one flow so you can focus on doing, not planning.
                  </p>
                </div>
              </div>

              <div className="grid gap-4">
                {[
                  "Visual planning with AI guidance",
                  "Side goals & community events",
                  "Integrated productivity assistant",
                ].map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-4 rounded-2xl border bg-background/40 p-4 backdrop-blur-sm transition-all hover:bg-background/60"
                  >
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                    <p className="text-sm font-bold uppercase tracking-tight">{item}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-4 rounded-2xl border bg-primary p-5 text-primary-foreground shadow-lg">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-foreground/10">
                  <CalendarDays className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-black uppercase tracking-widest text-slate-950">Built for routines</p>
                  <p className="text-sm font-semibold text-slate-900/85">
                    Smart scheduling that respects your energy levels.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-card p-8 pt-12 sm:p-12 sm:pt-16 flex flex-col justify-center">
              <div className="mx-auto w-full max-w-md space-y-8">
                <div className="space-y-2">
                  <h2 className="text-3xl font-black tracking-tight text-foreground sm:text-4xl padding-top-10">
                    {isSignUp ? "Get Organized" : "Sign In"}
                  </h2>
                  <p className="text-sm font-medium leading-6 text-foreground/72">
                    {isSignUp
                      ? "Create your account and start building a schedule that feels manageable."
                      : "Sign in to get back to your planner, goals, and calendar sync."}
                  </p>
                </div>

                <form onSubmit={handleAuth} className="space-y-4">
                  {isSignUp && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="firstName" className="text-xs font-black uppercase tracking-[0.22em] text-foreground/80">
                          First name
                        </Label>
                        <Input
                          id="firstName"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          required
                          className="h-12 border-2 border-foreground/10 bg-black/10 text-foreground placeholder:text-foreground/45 focus-visible:border-primary/60 focus-visible:ring-primary/20"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastName" className="text-xs font-black uppercase tracking-[0.22em] text-foreground/80">
                          Last name
                        </Label>
                        <Input
                          id="lastName"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          required
                          className="h-12 border-2 border-foreground/10 bg-black/10 text-foreground placeholder:text-foreground/45 focus-visible:border-primary/60 focus-visible:ring-primary/20"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-xs font-black uppercase tracking-[0.22em] text-foreground/80">
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="name@university.edu"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="h-12 border-2 border-foreground/10 bg-black/10 text-foreground placeholder:text-foreground/45 focus-visible:border-primary/60 focus-visible:ring-primary/20"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="password"
                      title="At least 6 characters"
                      className="text-xs font-black uppercase tracking-[0.22em] text-foreground/80"
                    >
                      Password
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="h-12 border-2 border-foreground/10 bg-black/10 text-foreground placeholder:text-foreground/45 focus-visible:border-primary/60 focus-visible:ring-primary/20"
                    />
                  </div>

                  {isSignUp && (
                    <div className="flex items-center gap-3 rounded-2xl border border-foreground/10 bg-black/10 p-4">
                      <Checkbox
                        id="terms"
                        checked={acceptedTerms}
                        onCheckedChange={(checked) => setAcceptedTerms(checked === true)}
                        className="border-foreground/25 bg-black/20 data-[state=checked]:border-primary data-[state=checked]:bg-primary"
                      />
                      <Label htmlFor="terms" className="cursor-pointer text-xs font-semibold leading-relaxed tracking-[0.08em] text-foreground/72">
                        I agree to the terms and let HandAll personalize my schedule suggestions.
                      </Label>
                    </div>
                  )}

                  <Button type="submit" size="lg" className="h-12 w-full font-black uppercase tracking-widest text-xs shadow-xl hover:scale-[1.01] active:scale-[0.99] transition-all">
                    {loading ? "Processing..." : isSignUp ? "Create Account" : "Sign In"}
                    {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
                  </Button>
                </form>

                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="h-12 w-full border-2 border-foreground/10 bg-black/10 font-bold text-foreground hover:bg-black/15"
                  onClick={handleGoogleLogin}
                >
                  <GoogleLogo />
                  <span className="ml-2">Continue with Google</span>
                </Button>

                <div className="text-center pt-1">
                  <p className="text-sm font-semibold text-foreground/82">
                    {isSignUp ? "Already a member?" : "New to HandAll?"}{" "}
                    <button
                      className="font-extrabold text-primary hover:underline underline-offset-4"
                      onClick={() => setIsSignUp(!isSignUp)}
                      type="button"
                    >
                      {isSignUp ? "Sign in instead" : "Create an account"}
                    </button>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
