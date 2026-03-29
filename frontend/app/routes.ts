import { createBrowserRouter } from "react-router";
import Root from "./components/Root";
import Dashboard from "./components/Dashboard";
import Setup from "./components/Setup";
import Goals from "./components/Goals";
import Settings from "./components/Settings";
import NotFound from "./components/NotFound";
import SignInForm from "./components/SignInForm";
import CalendarImportPreview from "./components/CalendarImportPreview";

export const router = createBrowserRouter([
  {
    path: "/login",
    Component: SignInForm,
  },
  {
    path: "/signin",
    Component: SignInForm,
  },
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: Dashboard },
      { path: "setup", Component: Setup },
      { path: "calendar-import-preview", Component: CalendarImportPreview },
      { path: "goals", Component: Goals },
      { path: "settings", Component: Settings },
      { path: "*", Component: NotFound },
    ],
  },
]);
