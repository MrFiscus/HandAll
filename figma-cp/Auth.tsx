import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { toast } from "sonner";
import { useNavigate } from "react-router";
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

export default function Auth() {
  const navigate = useNavigate();
  const [isSignUp, setIsSignUp] = useState(true);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

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
      });
      if (error) throw error;
    } catch (error: any) {
      toast.error(error.message || "Google login failed");
    }
  };

  if (!supabase) {
    return (
      <div className="min-h-screen bg-background px-4 py-10">
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
          <Card className="w-full max-w-xl border-yellow-200 bg-card/95 shadow-2xl">
            <CardHeader className="text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-yellow-100 text-yellow-600">
                <AlertTriangle className="h-8 w-8" />
              </div>
              <CardTitle className="text-3xl font-semibold">Supabase Not Configured</CardTitle>
              <CardDescription className="text-base leading-7">
                Authentication needs your Supabase credentials. Add a{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">.env</code>{" "}
                file inside{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">frontend/</code>{" "}
                with:
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <pre className="overflow-x-auto rounded-xl border bg-slate-950 p-4 text-left text-xs text-green-400">
                VITE_SUPABASE_URL=your_url_here{"\n"}
                VITE_SUPABASE_ANON_KEY=your_anon_key_here
              </pre>
              <Button onClick={() => window.location.reload()} className="w-full">
                Retry Connection
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 px-4 py-4 sm:py-6">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 top-10 h-72 w-72 rounded-full bg-blue-200/40 blur-3xl" />
        <div className="absolute right-0 top-0 h-80 w-80 rounded-full bg-violet-200/50 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-cyan-100/60 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-2rem)] max-w-6xl items-center justify-center sm:min-h-[calc(100vh-3rem)]">
        <Card className="w-full overflow-hidden border-white/70 bg-white/85 shadow-[0_24px_80px_rgba(15,23,42,0.14)] backdrop-blur lg:max-h-[calc(100vh-2rem)]">
          <div className="grid lg:grid-cols-[1.05fr_0.95fr]">
            <div className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-blue-900 to-indigo-900 p-6 text-white sm:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(96,165,250,0.3),transparent_40%)]" />
              <div className="relative flex h-full flex-col justify-between gap-6">
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-sm text-blue-50 backdrop-blur">
                    <Sparkles className="h-4 w-4" />
                    HandAll
                  </div>

                  <div className="space-y-3">
                    <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
                      Plan your week with more clarity and less friction.
                    </h1>
                    <p className="max-w-lg text-sm leading-6 text-blue-100/85 sm:text-base">
                      HandAll keeps your classes, tasks, calendar, and daily energy in one place
                      so your schedule feels manageable again.
                    </p>
                  </div>
                </div>

                <div className="grid gap-2.5">
                  {[
                    "Sync coursework and calendar events in one flow",
                    "Track side goals alongside your daily schedule",
                    "Use the AI assistant when your week gets messy",
                  ].map((item) => (
                    <div
                      key={item}
                      className="flex items-start gap-3 rounded-2xl border border-white/12 bg-white/8 px-4 py-2.5 backdrop-blur-sm"
                    >
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
                      <p className="text-sm leading-5 text-blue-50/90">{item}</p>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3 rounded-2xl border border-white/12 bg-white/8 px-4 py-3 backdrop-blur-sm">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/12">
                    <CalendarDays className="h-5 w-5 text-cyan-200" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Built for student routines</p>
                    <p className="text-sm leading-5 text-blue-100/80">
                      Keep assignments, motivation, and planning moving together.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white/90 p-6 sm:p-8">
              <div className="mx-auto max-w-md space-y-6">
                <div className="space-y-2.5">
                  <div className="inline-flex rounded-full border bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
                    {isSignUp ? "Create your account" : "Welcome back"}
                  </div>
                  <div className="space-y-1.5">
                    <h2 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                      {isSignUp ? "Start organizing with HandAll" : "Sign in to continue"}
                    </h2>
                    <p className="text-sm leading-5 text-slate-600">
                      {isSignUp
                        ? "Set up your schedule, connect your calendar, and let HandAll shape a plan around your real week."
                        : "Pick up where you left off and get back to your dashboard, weekly sync, and AI assistant."}
                    </p>
                  </div>
                </div>

                <form onSubmit={handleAuth} className="space-y-4">
                  {isSignUp && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="firstName">First name</Label>
                        <Input
                          id="firstName"
                          type="text"
                          placeholder="Jordan"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          required
                          className="h-10"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastName">Last name</Label>
                        <Input
                          id="lastName"
                          type="text"
                          placeholder="Lee"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          required
                          className="h-10"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@school.edu"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder={isSignUp ? "Create a password" : "Enter your password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="h-10"
                    />
                  </div>

                  {isSignUp && (
                    <div className="flex items-start gap-3 rounded-xl border bg-slate-50 px-4 py-2.5">
                      <Checkbox
                        id="terms"
                        checked={acceptedTerms}
                        onCheckedChange={(checked) => setAcceptedTerms(checked === true)}
                        className="mt-0.5"
                      />
                      <Label htmlFor="terms" className="cursor-pointer text-sm leading-5 text-slate-600">
                        I agree to the terms and understand HandAll will use my schedule data to
                        personalize planning suggestions.
                      </Label>
                    </div>
                  )}

                  <Button type="submit" size="lg" className="h-10 w-full">
                    {loading ? "Processing..." : isSignUp ? "Create Account" : "Sign In"}
                    {!loading && <ArrowRight className="h-4 w-4" />}
                  </Button>
                </form>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase tracking-[0.2em] text-slate-400">
                    <span className="bg-white px-3">or continue with</span>
                  </div>
                </div>

                <div className="grid gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="h-10"
                    onClick={handleGoogleLogin}
                  >
                    <GoogleLogo />
                    Google
                  </Button>
                </div>

                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-center">
                  <p className="text-sm text-slate-600">
                    {isSignUp ? "Already have an account?" : "Need an account first?"}{" "}
                    <button
                      className="font-medium text-blue-700 transition-colors hover:text-blue-800"
                      onClick={() => setIsSignUp(!isSignUp)}
                      type="button"
                    >
                      {isSignUp ? "Sign in" : "Create one"}
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
