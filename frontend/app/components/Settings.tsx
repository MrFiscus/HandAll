import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Separator } from "./ui/separator";
import { Badge } from "./ui/badge";
import CalendarSync from "./CalendarSync";
import { Camera, Loader2, Upload, User, Clock, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";

export default function Settings() {
  const { userProfile, setUserProfile, lastMotivation } = useAppStore();
  const [name, setName] = useState(userProfile.name);
  const [wakeTime, setWakeTime] = useState(userProfile.wakeTime);
  const [sleepTime, setSleepTime] = useState(userProfile.sleepTime);
  const [newGoal, setNewGoal] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [profileName, setProfileName] = useState(userProfile.name || "Student");

  useEffect(() => {
    if (!supabase) return;

    let isMounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!isMounted) return;
      const metadata = data.user?.user_metadata;
      setProfileName(userProfile.name || metadata?.full_name || metadata?.name || "Student");
      setAvatarUrl(metadata?.custom_avatar || metadata?.avatar_url || metadata?.picture || null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const metadata = session?.user?.user_metadata;
      setProfileName(userProfile.name || metadata?.full_name || metadata?.name || "Student");
      setAvatarUrl(metadata?.custom_avatar || metadata?.avatar_url || metadata?.picture || null);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [userProfile.name]);

  useEffect(() => {
    setName(userProfile.name);
    setProfileName(userProfile.name || "Student");
  }, [userProfile.name]);

  const handleSaveProfile = async () => {
    const trimmedName = name.trim() || "Student";

    try {
      if (supabase) {
        const { error } = await supabase.auth.updateUser({
          data: {
            full_name: trimmedName,
          },
        });

        if (error) throw error;
      }

      await setUserProfile({
        name: trimmedName,
        wakeTime,
        sleepTime,
        motivation: lastMotivation,
      });

      setProfileName(trimmedName);
      toast.success("Profile updated!");
    } catch (error: any) {
      toast.error(error.message || "Failed to update profile.");
    }
  };

  const handleAddGoal = async () => {
    if (!newGoal.trim()) {
      toast.error("Please enter a goal");
      return;
    }
    await setUserProfile({
      sideGoals: [...userProfile.sideGoals, newGoal.trim()],
    });
    setNewGoal("");
    toast.success("Goal added!");
  };

  const handleRemoveGoal = async (index: number) => {
    await setUserProfile({
      sideGoals: userProfile.sideGoals.filter((_, i) => i !== index),
    });
    toast.success("Goal removed");
  };

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!supabase) {
      toast.error("Supabase is not available.");
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }

    if (file.size > 1024 * 1024) {
      toast.error("Please choose an image smaller than 1 MB.");
      return;
    }

    setIsUploadingAvatar(true);

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Failed to read image file."));
        reader.readAsDataURL(file);
      });

      const { data, error } = await supabase.auth.updateUser({
        data: {
          custom_avatar: dataUrl,
        },
      });

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

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your HandAll preferences</p>
      </div>

      {/* User Profile */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5" />
            <CardTitle>User Profile</CardTitle>
          </div>
          <CardDescription>Your level and progress</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 rounded-xl border bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={`${profileName} profile`}
                  className="h-16 w-16 rounded-full object-cover ring-2 ring-border"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-500 text-white shadow-sm">
                  <Camera className="h-6 w-6" />
                </div>
              )}
              <div>
                <p className="font-medium">{profileName}</p>
                <p className="text-sm text-muted-foreground">
                  Upload a photo to personalize your profile.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarFile}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingAvatar}
              >
                {isUploadingAvatar ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Change Photo
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Student"
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium">Level {userProfile.level}</span>
                <span className="text-sm text-muted-foreground">
                  {userProfile.xp % 100}/100 XP
                </span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
                  style={{ width: `${(userProfile.xp % 100)}%` }}
                />
              </div>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="flex-1 p-3 rounded-lg bg-blue-50 border border-blue-200">
              <div className="text-sm text-muted-foreground">Total XP</div>
              <div className="text-2xl font-bold text-blue-600">{userProfile.xp}</div>
            </div>
            <div className="flex-1 p-3 rounded-lg bg-purple-50 border border-purple-200">
              <div className="text-sm text-muted-foreground">Level</div>
              <div className="text-2xl font-bold text-purple-600">{userProfile.level}</div>
            </div>
          </div>
          <Button onClick={handleSaveProfile}>Save Profile</Button>
        </CardContent>
      </Card>

      {/* Daily Schedule */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            <CardTitle>Daily Schedule</CardTitle>
          </div>
          <CardDescription>Set your typical wake and sleep times</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="wakeTime">Wake Time</Label>
              <Input
                id="wakeTime"
                type="time"
                value={wakeTime}
                onChange={(e) => setWakeTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sleepTime">Sleep Time</Label>
              <Input
                id="sleepTime"
                type="time"
                value={sleepTime}
                onChange={(e) => setSleepTime(e.target.value)}
              />
            </div>
          </div>
          <Button onClick={handleSaveProfile}>Save Schedule</Button>
        </CardContent>
      </Card>

      {/* Side Goals */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            <CardTitle>Side Goals</CardTitle>
          </div>
          <CardDescription>Manage your personal goals</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Add a new goal..."
              value={newGoal}
              onChange={(e) => setNewGoal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddGoal()}
            />
            <Button onClick={handleAddGoal}>Add</Button>
          </div>

          {userProfile.sideGoals.length > 0 ? (
            <div className="space-y-2">
              {userProfile.sideGoals.map((goal, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 rounded-lg border hover:border-gray-300 transition-colors"
                >
                  <span>{goal}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveGoal(index)}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No goals added yet. Add your first goal above!
            </p>
          )}
        </CardContent>
      </Card>

      {/* Calendar Integration */}
      <Card>
        <CardHeader>
          <CardTitle>Calendar Integration</CardTitle>
          <CardDescription>Connect your Google Calendar to sync events</CardDescription>
        </CardHeader>
        <CardContent>
          <CalendarSync />
        </CardContent>
      </Card>
    </div>
  );
}
