import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { AlertTriangle } from "lucide-react";
import { Button } from "./ui/button";

export default function Auth() {
  const navigate = useNavigate();
  const [isSignUp, setIsSignUp] = useState(true);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: `${firstName} ${lastName}`,
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
      <div className="h-screen w-screen flex items-center justify-center bg-slate-950 p-4 font-sans">
        <div className="max-w-md w-full p-8 border border-white/10 rounded-2xl shadow-2xl bg-slate-900 text-center space-y-6">
          <AlertTriangle className="h-16 w-16 text-yellow-500 mx-auto" />
          <h1 className="text-2xl font-bold text-white">Supabase Not Configured</h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            Authentication requires Supabase credentials. Please create a <code className="bg-slate-800 text-slate-200 px-1 rounded font-mono">.env</code> file in the <code className="bg-slate-800 text-slate-200 px-1 rounded font-mono">frontend/</code> directory with:
          </p>
          <pre className="bg-black text-green-400 p-4 rounded-lg text-xs text-left overflow-x-auto border border-white/5 font-mono">
            VITE_SUPABASE_URL=your_url_here{"\n"}
            VITE_SUPABASE_ANON_KEY=your_anon_key_here
          </pre>
          <Button onClick={() => window.location.reload()} className="w-full bg-slate-100 text-slate-900 hover:bg-white">
            Retry Connection
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-body-wrapper min-h-screen">
      <style dangerouslySetInnerHTML={{ __html: `
        .auth-body-wrapper {
          background:
            radial-gradient(circle at 15% 15%, rgba(69, 107, 162, 0.42), rgba(12, 24, 42, 0.08) 38%),
            radial-gradient(circle at 95% 10%, rgba(5, 42, 84, 0.5), transparent 45%),
            linear-gradient(165deg, #0f2545 0%, #08172f 50%, #071224 100%);
          display: grid;
          place-items: center;
          padding: 20px;
          color: #e0e0e0;
          font-family: 'Segoe UI', sans-serif;
        }
        .auth-card {
          width: 100%;
          max-width: 640px;
          background: linear-gradient(180deg, rgba(19, 36, 64, 0.96), rgba(9, 25, 47, 0.95));
          border-radius: 22px;
          border: 1px solid rgba(117, 157, 206, 0.28);
          padding: 32px;
          box-shadow: 0 24px 70px rgba(1, 9, 22, 0.5), inset 0 1px 0 rgba(192, 219, 255, 0.08);
        }
        .auth-card h1 {
          margin: 0 0 10px;
          color: #ecf2fb;
          font-size: clamp(34px, 4.5vw, 58px);
          line-height: 1;
          letter-spacing: -0.02em;
          font-weight: 700;
        }
        .auth-switch { margin: 0 0 22px; color: #b7c6db; font-size: 1rem; }
        .auth-link {
          border: 0;
          background: transparent;
          color: #c8d7eb;
          text-decoration: underline;
          text-underline-offset: 3px;
          cursor: pointer;
          font-size: inherit;
          padding: 0;
          margin-left: 5px;
        }
        .auth-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .auth-card input {
          width: 100%;
          background: #0b1d38;
          border: 1px solid #2a466a;
          color: #f0f5fd;
          padding: 14px 16px;
          border-radius: 12px;
          margin: 0 0 12px;
          font-size: 1rem;
          outline: none;
        }
        .auth-card input::placeholder { color: #7f95b5; }
        .auth-card input:focus {
          border-color: #6e95c4;
          box-shadow: 0 0 0 3px rgba(86, 133, 193, 0.2);
        }
        .auth-terms {
          display: flex;
          align-items: center;
          gap: 10px;
          color: #b7c6db;
          font-size: 1rem;
          margin: 2px 0 18px;
        }
        .auth-terms input { width: 18px; height: 18px; accent-color: #5f85b7; margin: 0; }
        .auth-submit {
          width: 100%;
          border: 1px solid #5576a0;
          background: linear-gradient(180deg, #5f7ea5, #4d6f96);
          color: #f0f5fd;
          font-size: 1.12rem;
          font-weight: 600;
          border-radius: 12px;
          padding: 14px;
          cursor: pointer;
          transition: filter 0.2s;
        }
        .auth-submit:hover { filter: brightness(1.1); }
        .auth-submit:disabled { opacity: 0.7; cursor: not-allowed; }
        .auth-divider {
          margin: 20px 0 14px;
          display: flex;
          align-items: center;
          gap: 10px;
          color: #9fb4d2;
        }
        .auth-divider::before,
        .auth-divider::after {
          content: '';
          height: 1px;
          flex: 1;
          background: rgba(124, 161, 204, 0.4);
        }
        .auth-social-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .auth-social {
          background: linear-gradient(180deg, #506e95, #4a6386);
          border: 1px solid #5f7ea5;
          border-radius: 12px;
          color: #e8eef8;
          padding: 12px;
          font-size: 1.02rem;
          display: flex;
          gap: 10px;
          justify-content: center;
          align-items: center;
          cursor: pointer;
          transition: opacity 0.2s;
        }
        .auth-social:hover { opacity: 1; }
        .auth-social:disabled { opacity: 0.5; cursor: not-allowed; }
        .brand-dot {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 0.95rem;
        }
        .brand-dot.google { background: #f4f4f4; color: #ef6d35; }
        .brand-dot.facebook { background: #26a8ef; color: #ffffff; }
      ` }} />

      <div className="auth-card">
        <h1>{isSignUp ? "Create an account" : "Welcome back"}</h1>
        <p className="auth-switch">
          <span>{isSignUp ? "Already have an account?" : "Don't have an account?"}</span>
          <button 
            className="auth-link" 
            onClick={() => setIsSignUp(!isSignUp)}
            type="button"
          >
            {isSignUp ? "Log in" : "Sign up"}
          </button>
        </p>

        <form onSubmit={handleAuth}>
          {isSignUp && (
            <div className="auth-row">
              <input 
                type="text" 
                placeholder="First name" 
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
              <input 
                type="text" 
                placeholder="Last name" 
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          )}

          <input 
            type="email" 
            placeholder="Email" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input 
            type="password" 
            placeholder="Enter your password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {isSignUp && (
            <label className="auth-terms">
              <input type="checkbox" required />
              <span>I agree to the <a href="#" className="auth-link">Terms &amp; Conditions</a></span>
            </label>
          )}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? "Processing..." : (isSignUp ? "Create account" : "Log in")}
          </button>
        </form>

        <div className="auth-divider"><span>Or {isSignUp ? "register" : "login"} with</span></div>

        <div className="auth-social-row">
          <button className="auth-social" type="button" onClick={handleGoogleLogin}>
            <span className="brand-dot google">G</span>
            <span>Google</span>
          </button>
          <button className="auth-social" type="button" disabled title="Coming soon">
            <span className="brand-dot facebook">f</span>
            <span>Facebook</span>
          </button>
        </div>
      </div>
    </div>
  );
}
