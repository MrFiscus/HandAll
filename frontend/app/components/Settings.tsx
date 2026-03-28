import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Separator } from "./ui/separator";
import { Badge } from "./ui/badge";
import CalendarSync from "./CalendarSync";
import { User, Clock, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const { userProfile, setUserProfile } = useAppStore();
  const [wakeTime, setWakeTime] = useState(userProfile.wakeTime);
  const [sleepTime, setSleepTime] = useState(userProfile.sleepTime);
  const [newGoal, setNewGoal] = useState("");

  const handleSaveSchedule = () => {
    setUserProfile({
      wakeTime,
      sleepTime,
    });
    toast.success("Schedule updated!");
  };

  const handleAddGoal = () => {
    if (!newGoal.trim()) {
      toast.error("Please enter a goal");
      return;
    }
    setUserProfile({
      sideGoals: [...userProfile.sideGoals, newGoal.trim()],
    });
    setNewGoal("");
    toast.success("Goal added!");
  };

  const handleRemoveGoal = (index: number) => {
    setUserProfile({
      sideGoals: userProfile.sideGoals.filter((_, i) => i !== index),
    });
    toast.success("Goal removed");
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
          <Button onClick={handleSaveSchedule}>Save Schedule</Button>
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
