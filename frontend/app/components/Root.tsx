import React, { useState, useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router";
import {
  CalendarDays,
  Settings as SettingsIcon,
  LogOut,
  Target,
  HelpCircle,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import WelcomeGuide from "./WelcomeGuide";
import BurnoutDialog from "./BurnoutDialog";
import { supabase } from "../lib/supabase";
import { cn } from "./ui/utils";
import Auth from "./Auth";

export default function Root() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loadAppData, resetAppState } = useAppStore();
  const [showHelp, setShowHelp] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      if (!session && location.pathname !== "/" && location.pathname !== "/login" && location.pathname !== "/signin") {
        resetAppState();
        navigate("/login");
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session && location.pathname !== "/" && location.pathname !== "/login" && location.pathname !== "/signin") {
        resetAppState();
        navigate("/login");
      }
    });
    return () => subscription.unsubscribe();
  }, [location.pathname, navigate, resetAppState]);

  useEffect(() => {
    if (session?.user?.id) {
      resetAppState();
      void loadAppData();
    }
  }, [session?.user?.id, loadAppData, resetAppState]);

  useEffect(() => {
    if (session && (location.pathname === "/login" || location.pathname === "/signin")) {
      navigate("/");
    }
  }, [session, location.pathname, navigate]);

  if (loading) return (
    <div className="h-screen w-screen flex items-center justify-center bg-background">
      <div className="text-2xl font-black tracking-tighter opacity-20 animate-pulse">HandAll.</div>
    </div>
  );

  if (!session && location.pathname === "/") {
    return <Auth />;
  }

  if (!session && location.pathname !== "/login" && location.pathname !== "/signin") return null;

  return (
    <div className="flex h-screen bg-transparent text-foreground font-sans selection:bg-primary selection:text-primary-foreground">
      {/* Step 1: Minimalist Navigation Edge - Fully Transparent */}
      <aside className="w-20 lg:w-24 flex flex-col items-center py-12 border-r border-white/5 bg-transparent relative z-50">
        <div className="mb-12">
          <div className="h-10 w-10 rounded-2xl bg-primary flex items-center justify-center shadow-[0_0_30px_rgba(221,251,92,0.2)]">
            <span className="font-black text-primary-foreground text-xl">H</span>
          </div>
        </div>

        <nav className="flex-1 flex flex-col gap-8">
          <NavButton 
            icon={<CalendarDays />} 
            active={location.pathname === "/"} 
            onClick={() => navigate("/")} 
          />
          <NavButton 
            icon={<Target />} 
            active={location.pathname === "/goals"} 
            onClick={() => navigate("/goals")} 
          />
          <NavButton 
            icon={<SettingsIcon />} 
            active={location.pathname === "/settings"} 
            onClick={() => navigate("/settings")} 
          />
        </nav>

        <div className="mt-auto flex flex-col gap-8">
          <NavButton 
            icon={<HelpCircle />} 
            onClick={() => setShowHelp(true)} 
          />
          <button 
            onClick={async () => {
              resetAppState();
              await supabase?.auth.signOut();
              navigate("/login");
            }}
            className="p-3 rounded-2xl text-muted-foreground/40 hover:text-destructive transition-all hover:bg-destructive/10"
          >
            <LogOut className="h-6 w-6" />
          </button>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="flex-1 overflow-hidden relative">
        <div className="h-full w-full overflow-auto">
          <Outlet />
        </div>
      </main>

      {showHelp && <WelcomeGuide onClose={() => setShowHelp(false)} />}
      <BurnoutDialog />
    </div>
  );
}

function NavButton({ icon, active, onClick }: { icon: React.ReactNode, active?: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "p-4 rounded-[2rem] transition-all duration-500 relative group",
        active 
          ? "text-primary bg-white/[0.03] shadow-2xl scale-110" 
          : "text-muted-foreground/40 hover:text-foreground hover:scale-105"
      )}
    >
      {React.cloneElement(icon as React.ReactElement, { className: "h-6 w-6" })}
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-full -ml-1 shadow-[0_0_15px_var(--color-primary)]" />
      )}
    </button>
  );
}
