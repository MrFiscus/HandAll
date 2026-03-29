import { useState, useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import {
  api,
  GoalEventRecommendation,
  NearbyGoalEventGroup,
  NearbyGoalEventResult,
} from "../utils/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Label } from "./ui/label";
import { cn } from "./ui/utils";
import { toast } from "sonner";
import {
  Compass,
  Loader2,
  MapPin,
  PartyPopper,
  Target,
  ExternalLink,
  Search,
  X,
  Plus,
  Sparkles,
} from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";

function EventList({
  items,
  emptyText,
}: {
  items: NearbyGoalEventResult[];
  emptyText: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  const displayedItems = showAll ? items : items.slice(0, 3);

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {displayedItems.map((item, index) => {
          const itemId = `${item.url}-${index}`;
          const isExpanded = expandedItems.includes(itemId);
          
          return (
            <div 
              key={itemId} 
              className="p-4 rounded-lg bg-white/[0.02] border border-white/[0.03] backdrop-blur-sm transition-all duration-500 hover:bg-white/[0.04] hover:border-primary/20 hover:-translate-y-1 hover:shadow-[0_10px_30px_rgba(0,0,0,0.2)] group animate-in fade-in slide-in-from-bottom-2"
              style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-2 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold leading-snug group-hover:text-primary transition-colors">{item.title}</p>
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5 border border-white/5">
                      <div className={cn("h-1 w-1 rounded-full", item.kind === "fun" ? "bg-blue-400" : "bg-primary")} />
                      <span className="text-[8px] font-black uppercase tracking-widest opacity-60">
                        {item.kind === "fun" ? "Fun" : item.goal || "Goal"}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className={cn(
                      "text-sm text-muted-foreground transition-all duration-500",
                      !isExpanded && "line-clamp-1"
                    )}>
                      {item.description || "No description available."}
                    </p>
                    {item.description && item.description.length > 80 && (
                      <button 
                        onClick={() => toggleExpand(itemId)}
                        className="text-[10px] font-black uppercase tracking-widest text-primary/60 hover:text-primary transition-colors"
                      >
                        {isExpanded ? "Show Less" : "Read More"}
                      </button>
                    )}
                  </div>
                </div>
                {item.url ? (
                  <Button asChild size="sm" variant="outline" className="rounded-xl border-white/5 hover:bg-primary hover:text-primary-foreground hover:border-none transition-all h-9 w-9 p-0 sm:w-auto sm:px-4">
                    <a href={item.url} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3.5 w-3.5 sm:mr-2" />
                      <span className="hidden sm:inline">Open</span>
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {items.length > 3 && (
        <div className="flex justify-center pt-2">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setShowAll(!showAll)}
            className="rounded-full px-6 bg-white/2 border border-white/5 hover:bg-white/5 text-[10px] font-black uppercase tracking-widest"
          >
            {showAll ? "Show Top Picks" : `View ${items.length - 3} More Results`}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function Goals() {
  const { userProfile, events, addEvent } = useAppStore();
  const [location, setLocation] = useState("");
  const [resolvedLocation, setResolvedLocation] = useState("");
  const [isResolvingLocation, setIsResolvingLocation] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isRecommending, setIsRecommending] = useState(false);
  const [funEvents, setFunEvents] = useState<NearbyGoalEventResult[]>([]);
  const [goalGroups, setGoalGroups] = useState<NearbyGoalEventGroup[]>([]);
  const [lastSearchedLocation, setLastSearchedLocation] = useState("");
  const [recommendations, setRecommendations] = useState<{
    fun: GoalEventRecommendation | null;
    goal: GoalEventRecommendation | null;
  }>({ fun: null, goal: null });

  const findNextOpenSlot = (durationMinutes: number) => {
    const wakeHour = Number(userProfile.wakeTime?.split(":")[0] || 7);
    const wakeMinute = Number(userProfile.wakeTime?.split(":")[1] || 0);
    const sleepHour = Number(userProfile.sleepTime?.split(":")[0] || 23);
    const sleepMinute = Number(userProfile.sleepTime?.split(":")[1] || 0);
    const now = new Date();
    const sortedEvents = [...events]
      .map((event) => ({
        start: new Date(event.start),
        end: new Date(event.end),
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
      const day = new Date(now);
      day.setDate(now.getDate() + dayOffset);
      day.setHours(0, 0, 0, 0);

      let cursor = new Date(day);
      cursor.setHours(wakeHour, wakeMinute, 0, 0);
      const dayEnd = new Date(day);
      dayEnd.setHours(sleepHour, sleepMinute, 0, 0);

      if (dayOffset === 0 && cursor < now) {
        const roundedNow = new Date(now);
        roundedNow.setMinutes(Math.ceil(roundedNow.getMinutes() / 15) * 15, 0, 0);
        cursor = roundedNow;
      }

      const sameDayEvents = sortedEvents.filter(
        (event) =>
          event.end > cursor &&
          event.start < dayEnd &&
          event.start.toDateString() === day.toDateString(),
      );

      for (const event of sameDayEvents) {
        const proposedEnd = new Date(cursor.getTime() + durationMinutes * 60000);
        if (proposedEnd <= event.start) {
          return { start: cursor, end: proposedEnd };
        }
        if (cursor < event.end) {
          cursor = new Date(event.end);
        }
      }

      const finalEnd = new Date(cursor.getTime() + durationMinutes * 60000);
      if (finalEnd <= dayEnd) {
        return { start: cursor, end: finalEnd };
      }
    }

    const fallbackStart = new Date(now);
    fallbackStart.setHours(wakeHour, wakeMinute, 0, 0);
    const fallbackEnd = new Date(fallbackStart.getTime() + durationMinutes * 60000);
    return { start: fallbackStart, end: fallbackEnd };
  };

  const addRecommendationToCalendar = async (
    recommendation: GoalEventRecommendation,
  ) => {
    const slot = findNextOpenSlot(recommendation.suggested_duration_minutes || 60);
    await addEvent({
      title: recommendation.task_title,
      description: recommendation.task_description,
      start: slot.start,
      end: slot.end,
      type: recommendation.task_type,
    });
  };

  const handleRecommendAndAdd = async () => {
    if (!lastSearchedLocation || (funEvents.length === 0 && goalGroups.length === 0)) {
      toast.error("Search for nearby events first.");
      return;
    }

    setIsRecommending(true);
    try {
      const result = await api.recommendGoalEvents({
        location: lastSearchedLocation || location.trim(),
        sideGoals: userProfile.sideGoals,
        motivation: userProfile.motivation ?? 50,
        funEvents,
        goalEventGroups: goalGroups,
      });
      setRecommendations({
        fun: result.fun_event,
        goal: result.goal_event,
      });

      const toAdd = [result.fun_event, result.goal_event].filter(Boolean) as GoalEventRecommendation[];
      for (const item of toAdd) {
        await addRecommendationToCalendar(item);
      }

      toast.success("Added one fun event and one goal-supporting event to your calendar.");
    } catch (error) {
      console.error("Goal event recommendation failed:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to recommend goal events.",
      );
    } finally {
      setIsRecommending(false);
    }
  };

  const [isEditingLocation, setIsEditingLocation] = useState(true);
  const [selectedGoals, setSelectedGoals] = useState<string[]>(userProfile.sideGoals);
  const [activeTab, setActiveTab] = useState<"fun" | "goals">("fun");
  const [activeGoalTab, setActiveGoalTab] = useState<string>("");

  // Sync activeGoalTab when results come in
  useEffect(() => {
    if (goalGroups.length > 0 && !activeGoalTab) {
      setActiveGoalTab(goalGroups[0].goal);
    }
  }, [goalGroups]);

  const toggleGoal = (goal: string) => {
    setSelectedGoals(prev => 
      prev.includes(goal) ? prev.filter(g => g !== goal) : [...prev, goal]
    );
  };

  const handleUseMyLocation = async () => {
    if (!navigator.geolocation) {
      toast.error("Your browser does not support location lookup.");
      return;
    }

    setIsResolvingLocation(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 300000,
        });
      });

      const result = await api.reverseGeocode(
        position.coords.latitude,
        position.coords.longitude,
      );
      const nextLocation = result.location || result.displayName || "";
      if (!nextLocation) {
        throw new Error("I couldn't turn your coordinates into a city/location.");
      }
      setLocation(nextLocation);
      setResolvedLocation(result.displayName || nextLocation);
      toast.success("Location filled in from your current position.");
    } catch (error) {
      console.error("Location resolution failed:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to use your current location.",
      );
    } finally {
      setIsResolvingLocation(false);
    }
  };

  const handleSearch = async () => {
    if (!location.trim()) {
      toast.error("Enter a city/location first, or use your current location.");
      return;
    }

    setIsSearching(true);
    try {
      const result = await api.fetchNearbyGoalEvents({
        location: location.trim(),
        country: "US",
        // Pass the selected goals to the API if needed, 
        // or filter the results locally if the API returns all.
        // Assuming we want to tell the API which goals to focus on:
        sideGoals: selectedGoals,
      });
      setFunEvents(result.funEvents || []);
      setGoalGroups(result.goalEventGroups || []);
      setLastSearchedLocation(result.location);
      if (!resolvedLocation) {
        setResolvedLocation(result.location);
      }
      toast.success("Nearby goal events loaded.");
      setIsEditingLocation(false);
    } catch (error) {
      console.error("Nearby goal event search failed:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to search nearby goal events.",
      );
    } finally {
      setIsSearching(false);
    }
  };

  const hasResults = funEvents.length > 0 || goalGroups.length > 0;

  return (
    <ScrollArea className="h-full w-full" type="always">
      <div className="p-6 pt-20 space-y-10 max-w-4xl mx-auto pb-20">
        <div className="flex flex-col items-center text-center space-y-4">
          <h1 className="text-5xl font-black tracking-tighter mb-0">Goals.</h1>
          <p className="text-muted-foreground font-medium">Discover local opportunities to move your side ambitions forward.</p>
        </div>

        <div className={cn(
          "rounded-[2rem] bg-white/[0.01] border border-white/[0.03] backdrop-blur-md transition-all duration-500 overflow-hidden sticky top-4 z-20 shadow-xl",
          isEditingLocation ? "p-8 space-y-4" : "p-4 px-8 flex items-center justify-between"
        )}>
        {isEditingLocation ? (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Compass className="h-5 w-5" />
                <h3 className="text-xl font-bold">Search Near You</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Use your current location or type a city/state manually.
              </p>
            </div>
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-[1fr_auto_auto]">
                <div className="space-y-2">
                  <Label htmlFor="goals-location">Location</Label>
                  <Input
                    id="goals-location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Madison, Wisconsin, United States"
                  />
                </div>
                <div className="self-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleUseMyLocation}
                    disabled={isResolvingLocation}
                  >
                    {isResolvingLocation ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <MapPin className="mr-2 h-4 w-4" />
                    )}
                    Use My Location
                  </Button>
                </div>
                <div className="self-end">
                  <Button type="button" onClick={handleSearch} disabled={isSearching}>
                    {isSearching ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="mr-2 h-4 w-4" />
                    )}
                    Search Events
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {userProfile.sideGoals.length > 0 ? (
                  userProfile.sideGoals.map((goal) => (
                    <Badge
                      key={goal}
                      variant={selectedGoals.includes(goal) ? "default" : "secondary"}
                      className={cn(
                        "cursor-pointer transition-all hover:scale-105 active:scale-95 flex items-center gap-1.5 py-1 px-3",
                        selectedGoals.includes(goal)
                          ? "bg-primary text-primary-foreground"
                          : "bg-white/[0.03] text-muted-foreground/60 border-white/5"
                      )}
                      onClick={() => toggleGoal(goal)}
                    >
                      {goal}
                      {selectedGoals.includes(goal) ? (
                        <X className="h-3 w-3 opacity-60" />
                      ) : (
                        <Plus className="h-3 w-3 opacity-40" />
                      )}
                    </Badge>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    You have not added any side goals yet. Add them in Settings to get goal-specific event ideas here.
                  </p>
                )}
              </div>

              {lastSearchedLocation ? (
                <p className="text-sm text-muted-foreground">
                  Showing results for <span className="font-medium text-foreground">{resolvedLocation || lastSearchedLocation}</span>
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <MapPin className="h-5 w-5 text-primary" />
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">Current Location</p>
                <p className="font-bold text-foreground">{resolvedLocation || lastSearchedLocation}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setIsEditingLocation(true)} className="rounded-xl hover:bg-white/5 text-primary text-[10px] font-black uppercase tracking-widest">
              Change Location
            </Button>
          </>
        )}
      </div>

      {hasResults && (
        <div className="flex flex-col items-center gap-8">
          <div className="flex items-center gap-4 p-2 rounded-[2.5rem] bg-white/[0.01] border border-white/[0.03] backdrop-blur-sm shadow-2xl">
            <button 
              onClick={() => setActiveTab("fun")}
              className={cn(
                "flex items-center gap-3 px-8 py-4 rounded-full font-black uppercase tracking-widest text-[10px] transition-all duration-500",
                activeTab === "fun" 
                  ? "bg-primary text-primary-foreground shadow-[0_15px_30px_rgba(221,251,92,0.2)] scale-105" 
                  : "text-muted-foreground/40 hover:text-foreground"
              )}
            >
              <PartyPopper className={cn("h-4 w-4", activeTab === "fun" ? "text-primary-foreground" : "text-primary/40")} />
              Fun Events
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
              <Target className={cn("h-4 w-4", activeTab === "goals" ? "text-primary-foreground" : "text-primary/40")} />
              Goal Events
            </button>
          </div>

          <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
            {activeTab === "fun" ? (
              <div className="p-8 rounded-[1.5rem] bg-white/[0.01] border border-white/[0.03] space-y-8 backdrop-blur-sm">
                <div className="space-y-1.5">
                  <h3 className="text-xl font-bold">Fun Near You</h3>
                  <p className="text-sm text-muted-foreground">Casual things to do nearby for a balanced week.</p>
                </div>
                <EventList items={funEvents} emptyText="No fun events found in this area." />
              </div>
            ) : (
              <div className="space-y-8 flex flex-col items-center">
                {goalGroups.length > 0 ? (
                  <>
                    <div className="flex flex-wrap justify-center gap-3 p-2 rounded-[2rem] bg-white/[0.01] border border-white/[0.03] backdrop-blur-sm">
                      {goalGroups.map((group) => (
                        <button
                          key={group.goal}
                          onClick={() => setActiveGoalTab(group.goal)}
                          className={cn(
                            "px-6 py-3 rounded-full font-black uppercase tracking-widest text-[9px] transition-all duration-500",
                            activeGoalTab === group.goal
                              ? "bg-primary text-primary-foreground shadow-lg scale-105"
                              : "text-muted-foreground/40 hover:text-foreground"
                          )}
                        >
                          {group.goal}
                        </button>
                      ))}
                    </div>

                    <div className="w-full animate-in fade-in zoom-in-95 duration-500">
                      {goalGroups.filter(g => g.goal === activeGoalTab).map((group) => (
                        <div key={group.goal} className="p-8 rounded-[1.5rem] bg-white/[0.01] border border-white/[0.03] space-y-8 backdrop-blur-sm">
                          <div className="space-y-1.5">
                            <h3 className="text-xl font-bold">{group.goal}</h3>
                            <p className="text-sm text-muted-foreground">{group.query}</p>
                          </div>
                          <EventList items={group.results} emptyText={`No events found for ${group.goal}.`} />
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="p-8 rounded-[2.5rem] bg-white/[0.01] border border-white/[0.03] text-center backdrop-blur-sm w-full">
                    <p className="text-muted-foreground">No goal events found. Try selecting different goals or a new location.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </ScrollArea>
  );
}
