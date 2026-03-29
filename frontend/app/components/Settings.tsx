import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import { Badge } from "./ui/badge";
import { cn } from "./ui/utils";
import CalendarSync from "./CalendarSync";
import { Camera, Loader2, Upload, User, Clock, Target, Trash2, Settings as SettingsIcon, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { api } from "../utils/api";
import { ScrollArea } from "./ui/scroll-area";
import { TimePickerField } from "./ui/time-picker";

export default function Settings() {
  const { userProfile, setUserProfile, lastMotivation, loadAppData, clearPendingSuggestions } = useAppStore();
  const [name, setName] = useState(userProfile.name);
  const [wakeTime, setWakeTime] = useState(userProfile.wakeTime);
  const [sleepTime, setSleepTime] = useState(userProfile.sleepTime);
  const [newGoal, setNewGoal] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isClearingEvents, setIsClearingEvents] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [profileName, setProfileName] = useState(userProfile.name || "Student");
  const [activeTab, setActiveTab] = useState<"general" | "goals" | "advanced">("general");

  useEffect(() => {
    if (!supabase) return;
    let isMounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!isMounted) return;
      const metadata = data.user?.user_metadata;
      setProfileName(userProfile.name || metadata?.full_name || metadata?.name || "Student");
      setAvatarUrl(metadata?.custom_avatar || metadata?.avatar_url || metadata?.picture || null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const metadata = session?.user?.user_metadata;
      setProfileName(userProfile.name || metadata?.full_name || metadata?.name || "Student");
      setAvatarUrl(metadata?.custom_avatar || metadata?.avatar_url || metadata?.picture || null);
    });
    return () => { isMounted = false; subscription.unsubscribe(); };
  }, [userProfile.name]);

  useEffect(() => {
    setName(userProfile.name);
    setProfileName(userProfile.name || "Student");
  }, [userProfile.name]);

  const handleSaveProfile = async () => {
    const trimmedName = name.trim() || "Student";
    try {
      if (supabase) {
        const { error } = await supabase.auth.updateUser({ data: { full_name: trimmedName } });
        if (error) throw error;
      }
      await setUserProfile({ name: trimmedName, wakeTime, sleepTime, motivation: lastMotivation });
      setProfileName(trimmedName);
      toast.success("Profile updated!");
    } catch (error: any) {
      toast.error(error.message || "Failed to update profile.");
    }
  };

  const handleAddGoal = async () => {
    if (!newGoal.trim()) { toast.error("Please enter a goal"); return; }
    await setUserProfile({ sideGoals: [...userProfile.sideGoals, newGoal.trim()] });
    setNewGoal("");
    toast.success("Goal added!");
  };

  const handleRemoveGoal = async (index: number) => {
    await setUserProfile({ sideGoals: userProfile.sideGoals.filter((_, i) => i !== index) });
    toast.success("Goal removed");
  };

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!supabase) { toast.error("Supabase is not available."); return; }
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file."); return; }
    if (file.size > 1024 * 1024) { toast.error("Please choose an image smaller than 1 MB."); return; }
    setIsUploadingAvatar(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Failed to read image file."));
        reader.readAsDataURL(file);
      });
      const { data, error } = await supabase.auth.updateUser({ data: { custom_avatar: dataUrl } });
      if (error) throw error;
      const metadata = data.user?.user_metadata;
      setAvatarUrl(metadata?.custom_avatar || metadata?.avatar_url || metadata?.picture || null);
      toast.success("Profile photo updated!");
    } catch (error: any) {
      toast.error(error.message || "Failed to update profile photo.");
    } finally {
      setIsUploadingAvatar(false);
      e.target.value = "";
    }
  };

  const handleRemoveAllEvents = async () => {
    setIsClearingEvents(true);
    try {
      const result = await api.deleteAllEvents();
      clearPendingSuggestions();
      await loadAppData();
      toast.success(`Removed ${result.deletedTasks} event${result.deletedTasks === 1 ? "" : "s"} from your calendar.`);
    } catch (error: any) {
      toast.error(error.message || "Failed to remove all events.");
    } finally {
      setIsClearingEvents(false);
    }
  };

  return (
    <ScrollArea className="h-full w-full" type="always">
      <div className="p-6 pt-20 space-y-10 max-w-4xl mx-auto pb-20">
        <div className="flex flex-col items-center text-center space-y-4">
          <h1 className="text-5xl font-black tracking-tighter mb-0">Settings.</h1>
          <p className="text-muted-foreground font-medium">Fine-tune your personal productivity engine.</p>
        </div>

        <div className="flex justify-center">
          <div className="flex items-center gap-2 p-2 rounded-[2.5rem] bg-white/[0.01] border border-white/[0.03] backdrop-blur-sm shadow-2xl">
            <button 
              onClick={() => setActiveTab("general")}
              className={cn(
                "flex items-center gap-3 px-8 py-4 rounded-full font-black uppercase tracking-widest text-[10px] transition-all duration-500",
                activeTab === "general" 
                  ? "bg-primary text-primary-foreground shadow-[0_15px_30px_rgba(221,251,92,0.2)] scale-105" 
                  : "text-muted-foreground/40 hover:text-foreground"
              )}
            >
              <User className="h-4 w-4" />
              General
            </button>
            <button 
              onClick={() => setActiveTab("goals")}
              className={cn(
                "flex items-center gap-3 px-8 py-4 rounded-full font-black uppercase tracking-widest text-[10px] transition-all duration-500",
                activeTab === "goals" 
                  ? "bg-primary text-primary-foreground shadow-[0_15px_30px_rgba(221,251,92,0.2)] scale-105" 
                  : "text-muted-foreground/40 hover:text-foreground"
              )}
            >
              <Target className="h-4 w-4" />
              Goals
            </button>
            <button 
              onClick={() => setActiveTab("advanced")}
              className={cn(
                "flex items-center gap-3 px-8 py-4 rounded-full font-black uppercase tracking-widest text-[10px] transition-all duration-500",
                activeTab === "advanced" 
                  ? "bg-primary text-primary-foreground shadow-[0_15px_30px_rgba(221,251,92,0.2)] scale-105" 
                  : "text-muted-foreground/40 hover:text-foreground"
              )}
            >
              <SettingsIcon className="h-4 w-4" />
              Advanced
            </button>
          </div>
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
          {activeTab === "general" && (
            <div className="space-y-8">
              <div className="p-8 rounded-[2.5rem] bg-white/[0.01] border border-white/[0.03] backdrop-blur-sm space-y-8">
                <div className="space-y-1.5">
                  <label>Profile Presence</label>
                  <div className="flex flex-col gap-8 sm:flex-row sm:items-center">
                    <div className="relative group">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="profile" className="h-24 w-24 rounded-[2rem] object-cover ring-4 ring-white/5 transition-all group-hover:ring-primary/20" />
                      ) : (
                        <div className="flex h-24 w-24 items-center justify-center rounded-[2rem] bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-2xl">
                          <Camera className="h-8 w-8" />
                        </div>
                      )}
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute -bottom-2 -right-2 h-10 w-10 rounded-full bg-white text-black flex items-center justify-center shadow-2xl scale-0 group-hover:scale-100 transition-all duration-500 hover:bg-primary"
                      >
                        <Upload className="h-4 w-4" />
                      </button>
                      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
                    </div>
                    <div className="flex-1 space-y-4">
                      <div className="space-y-2">
                        <Label className="text-[9px] opacity-40">Display Name</Label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-14 rounded-2xl bg-white/[0.02] border-white/5 px-6 text-lg font-bold focus:border-primary/20 transition-all" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4">
                  <div className="p-6 rounded-[1.5rem] bg-white/[0.02] border border-white/[0.03] space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">Total XP</p>
                    <p className="text-3xl font-black text-primary">{userProfile.xp}</p>
                  </div>
                  <div className="p-6 rounded-[1.5rem] bg-white/[0.02] border border-white/[0.03] space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">Current Level</p>
                    <p className="text-3xl font-black text-primary">{userProfile.level}</p>
                  </div>
                </div>
                
                <div className="pt-4">
                  <Button onClick={handleSaveProfile} className="w-full h-16 rounded-[1.5rem] font-black uppercase tracking-widest bg-primary text-primary-foreground shadow-2xl hover:scale-[1.02] transition-all">
                    Update Presence
                  </Button>
                </div>
              </div>

              <div className="p-8 rounded-[2.5rem] bg-white/[0.01] border border-white/[0.03] backdrop-blur-sm space-y-8">
                <div className="space-y-1.5">
                  <label>Energy Windows</label>
                  <p className="text-sm text-muted-foreground font-medium">When will you be working?</p>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <TimePickerField
                    id="wakeTime"
                    label="Wake Up"
                    value={wakeTime}
                    onChange={setWakeTime}
                  />
                  <TimePickerField
                    id="sleepTime"
                    label="Wind Down"
                    value={sleepTime}
                    onChange={setSleepTime}
                  />
                </div>
                <Button onClick={handleSaveProfile} variant="outline" className="w-full h-14 rounded-2xl font-black uppercase tracking-widest border-white/5 hover:bg-white/5 transition-all">
                  Save Schedule
                </Button>
              </div>
            </div>
          )}

          {activeTab === "goals" && (
            <div className="p-8 rounded-[2.5rem] bg-white/[0.01] border border-white/[0.03] backdrop-blur-sm space-y-8">
              <div className="space-y-1.5">
                <label>Side Ambitions</label>
                <p className="text-sm text-muted-foreground font-medium">Add goals like "Learning Piano" or "Fitness" so we can find events for you.</p>
              </div>
              
              <div className="flex gap-3">
                <Input 
                  placeholder="Type a new goal..." 
                  value={newGoal} 
                  onChange={(e) => setNewGoal(e.target.value)} 
                  onKeyDown={(e) => e.key === "Enter" && handleAddGoal()} 
                  className="h-14 rounded-2xl bg-white/[0.02] border-white/5 px-6 text-lg font-medium"
                />
                <Button onClick={handleAddGoal} className="h-14 w-14 rounded-2xl bg-primary text-primary-foreground shadow-2xl">
                  <Plus className="h-6 w-6" />
                </Button>
              </div>

              <div className="flex flex-wrap gap-3">
                {userProfile.sideGoals.map((goal, index) => (
                  <div 
                    key={index}
                    className="group flex items-center gap-3 px-6 py-3 rounded-full bg-white/[0.03] border border-white/[0.05] transition-all hover:border-primary/40 hover:bg-white/[0.05]"
                  >
                    <span className="font-bold text-sm">{goal}</span>
                    <button onClick={() => handleRemoveGoal(index)} className="text-muted-foreground/40 hover:text-destructive transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {userProfile.sideGoals.length === 0 && (
                  <div className="w-full py-12 text-center border-2 border-dashed border-white/5 rounded-[2rem]">
                    <p className="text-muted-foreground/40 font-medium">No goals added yet.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "advanced" && (
            <div className="space-y-8">
              <div className="p-8 rounded-[2.5rem] bg-white/[0.01] border border-white/[0.03] backdrop-blur-sm space-y-8">
                <div className="space-y-1.5">
                  <label>Integrations</label>
                  <p className="text-sm text-muted-foreground font-medium">Connect your external calendars to sync your schedule.</p>
                </div>
                <CalendarSync />
              </div>

              <div className="p-8 rounded-[2.5rem] bg-destructive/[0.02] border border-destructive/10 backdrop-blur-sm space-y-8">
                <div className="space-y-1.5">
                  <label className="text-destructive opacity-100">Danger Zone</label>
                  <p className="text-sm text-muted-foreground font-medium">Reset your local HandAll data. This is permanent.</p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" disabled={isClearingEvents} className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-destructive hover:bg-destructive/10 border border-destructive/5 transition-all">
                      {isClearingEvents ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                      Purge All Events
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-[#1a3a2a] border-white/10 rounded-[2rem] p-10">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-3xl font-black tracking-tighter">Are you sure?</AlertDialogTitle>
                      <AlertDialogDescription className="text-muted-foreground font-medium">
                        This will delete all currently stored events and generated planning blocks. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="pt-6">
                      <AlertDialogCancel className="rounded-xl border-white/10 font-bold">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleRemoveAllEvents}
                        className="bg-destructive hover:bg-destructive/90 text-destructive-foreground font-black uppercase tracking-widest rounded-xl px-8"
                      >
                        Yes, purge everything
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
