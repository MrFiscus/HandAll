import { useState } from "react";
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
import { toast } from "sonner";
import {
  Compass,
  Loader2,
  MapPin,
  PartyPopper,
  Target,
  ExternalLink,
  Search,
  Sparkles,
} from "lucide-react";

function EventList({
  items,
  emptyText,
}: {
  items: NearbyGoalEventResult[];
  emptyText: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={`${item.url}-${index}`} className="p-4 rounded-2xl bg-white/[0.02] border border-white/[0.03] backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium leading-snug">{item.title}</p>
                <Badge variant="secondary">
                  {item.kind === "fun" ? "Fun Event" : item.goal || "Goal Event"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {item.description || "No description was returned for this result."}
              </p>
            </div>
            {item.url ? (
              <Button asChild size="sm" variant="outline">
                <a href={item.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  Open
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      ))}
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
      });
      setFunEvents(result.funEvents || []);
      setGoalGroups(result.goalEventGroups || []);
      setLastSearchedLocation(result.location);
      if (!resolvedLocation) {
        setResolvedLocation(result.location);
      }
      toast.success("Nearby goal events loaded.");
    } catch (error) {
      console.error("Nearby goal event search failed:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to search nearby goal events.",
      );
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Goals.</h1>
        <p className="text-muted-foreground">
          Find nearby events in two lanes: fun things to do, and events that help you move your side goals forward.
        </p>
      </div>

      <div className="p-8 rounded-[2rem] bg-white/[0.01] border border-white/[0.03] space-y-4 backdrop-blur-sm">
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
                <Badge key={goal} variant="secondary">
                  {goal}
                </Badge>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                You have not added any side goals yet. Add them in Settings to get goal-specific event ideas here.
              </p>
            )}
          </div>

          {lastSearchedLocation ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Showing results for <span className="font-medium text-foreground">{resolvedLocation || lastSearchedLocation}</span>
              </p>
              <Button type="button" onClick={handleRecommendAndAdd} disabled={isRecommending || (!funEvents.length && !goalGroups.length)}>
                {isRecommending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Recommend and Add
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {(recommendations.fun || recommendations.goal) && (
        <div className="grid gap-6 md:grid-cols-2">
          {[recommendations.fun, recommendations.goal].filter(Boolean).map((item) => (
            <Card key={`${item!.kind}-${item!.title}`} className="rounded-[2rem] bg-white/[0.01] border border-white/[0.03] backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg">{item!.kind === "fun" ? "AI fun pick" : "AI goal pick"}</CardTitle>
                <CardDescription>{item!.reason}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="font-medium">{item!.title}</p>
                  <p className="text-sm text-muted-foreground">{item!.description || "No description provided."}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{item!.task_type === "freetime" ? "Fun Event" : item!.goal || "Goal Event"}</Badge>
                  <Badge variant="outline">{item!.suggested_duration_minutes} min</Badge>
                </div>
                {item!.url ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={item!.url} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-2 h-3.5 w-3.5" />
                      Open source
                    </a>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.05fr_1fr]">
        <div className="h-fit p-8 rounded-[2rem] bg-white/[0.01] border border-white/[0.03] space-y-8 backdrop-blur-sm">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <PartyPopper className="h-5 w-5 text-primary" />
              <h3 className="text-xl font-bold">Fun Events Near You</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Casual things to do nearby when you want something enjoyable on the calendar.
            </p>
          </div>
          {funEvents.length > 0 && (
            <div>
              <EventList
                items={funEvents}
                emptyText=""
              />
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="p-8 rounded-[2rem] bg-white/[0.01] border border-white/[0.03] space-y-4 backdrop-blur-sm">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                <h3 className="text-xl font-bold">Goal-Supporting Events</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Events, meetups, classes, and communities related to the goals you entered during setup.
              </p>
            </div>
          </div>

          {goalGroups.length > 0 && goalGroups.map((group) => (
              <div key={group.goal} className="p-8 rounded-[2rem] bg-white/[0.01] border border-white/[0.03] space-y-8 backdrop-blur-sm">
                <div className="space-y-1.5">
                  <h3 className="text-lg font-bold">{group.goal}</h3>
                  <p className="text-sm text-muted-foreground">{group.query}</p>
                </div>
                <div>
                  <EventList
                    items={group.results}
                    emptyText={`No goal-focused events were found for "${group.goal}" in this search.`}
                  />
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
