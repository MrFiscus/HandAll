import { createBrowserRouter } from "react-router";
import Root from "./components/Root";
import Dashboard from "./components/Dashboard";
import Setup from "./components/Setup";
import WeeklySync from "./components/WeeklySync";
import DailyCheckIn from "./components/DailyCheckIn";
import Settings from "./components/Settings";
import NotFound from "./components/NotFound";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: Dashboard },
      { path: "setup", Component: Setup },
      { path: "weekly-sync", Component: WeeklySync },
      { path: "daily-check-in", Component: DailyCheckIn },
      { path: "settings", Component: Settings },
      { path: "*", Component: NotFound },
    ],
  },
]);