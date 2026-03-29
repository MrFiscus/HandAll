import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { api, NearbyGoalEventGroup, NearbyGoalEventResult } from "../utils/api";
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
        <div key={`${item.url}-${index}`} className="rounded-xl border bg-card p-4">
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
  const { userProfile } = useAppStore();
  const [location, setLocation] = useState("");
  const [resolvedLocation, setResolvedLocation] = useState("");
  const [isResolvingLocation, setIsResolvingLocation] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [funEvents, setFunEvents] = useState<NearbyGoalEventResult[]>([]);
  const [goalGroups, setGoalGroups] = useState<NearbyGoalEventGroup[]>([]);
  const [lastSearchedLocation, setLastSearchedLocation] = useState("");

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
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Goals</h1>
        <p className="text-muted-foreground max-w-3xl">
          Find nearby events in two lanes: fun things to do, and events that help you move your side goals forward.
          HandAll uses Firecrawl search results plus the goals from your setup.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Compass className="h-5 w-5" />
            <CardTitle>Search Near You</CardTitle>
          </div>
          <CardDescription>
            Use your current location or type a city/state manually.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
            <p className="text-sm text-muted-foreground">
              Showing results for <span className="font-medium text-foreground">{resolvedLocation || lastSearchedLocation}</span>
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <div className="flex items-center gap-2">
              <PartyPopper className="h-5 w-5 text-orange-500" />
              <CardTitle>Fun Events Near You</CardTitle>
            </div>
            <CardDescription>
              Casual things to do nearby when you want something enjoyable on the calendar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EventList
              items={funEvents}
              emptyText="Search a location to load nearby fun events."
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-blue-500" />
                <CardTitle>Goal-Supporting Events</CardTitle>
              </div>
              <CardDescription>
                Events, meetups, classes, and communities related to the goals you entered during setup.
              </CardDescription>
            </CardHeader>
          </Card>

          {goalGroups.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">
                  Search a location to load nearby events that support your goals.
                </p>
              </CardContent>
            </Card>
          ) : (
            goalGroups.map((group) => (
              <Card key={group.goal}>
                <CardHeader>
                  <CardTitle className="text-lg">{group.goal}</CardTitle>
                  <CardDescription>{group.query}</CardDescription>
                </CardHeader>
                <CardContent>
                  <EventList
                    items={group.results}
                    emptyText={`No goal-focused events were found for "${group.goal}" in this search.`}
                  />
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
