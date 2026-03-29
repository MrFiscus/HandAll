# HandAll

HandAll is an AI-supported student planner built to keep classes, assignments, recovery time, side goals, and calendar imports in one flow. Instead of acting like a plain calendar, it helps students set up routines, import school schedules, discover goal-supporting events, and talk to an assistant that understands the planner context.

## What HandAll Does

- Centralizes classes, tasks, imported calendar events, and personal goals in one interface.
- Uses AI-assisted planning to break work into manageable blocks and support schedule decisions.
- Lets students connect calendars, import `.ics` feeds, and preview converted events before syncing.
- Adds a visual layer for motivation, energy windows, side goals, and assistant-guided planning.

## Visual Product Tour

### Landing and Authentication

The app starts with a simple landing page that frames HandAll as a guided planning tool rather than just another calendar.

![Landing page](images/landing-page.png)

Users can create an account directly or continue with Google for a faster setup flow.

![Sign up](images/sign-up.png)

Returning users land on a focused sign-in screen that takes them straight back into their planner.

![Sign in](images/sign-in.png)

### Onboarding Flow

New users are guided through a three-step onboarding flow so the planner can personalize recommendations before the main dashboard opens.

Step 1 collects profile information and side goals. Those goals later feed into event discovery and long-term planning.

![Onboarding profile](images/onboarding-profile.png)

Step 2 captures routine preferences such as wake-up and sleep windows so the planner can respect energy boundaries. The time picker is built as a dedicated modal to keep routine setup simple and touch-friendly.

![Onboarding routine and sleep time modal](images/onboarding-routine.png)

Step 3 connects the calendar layer, either through Google or `.ics` import, before finishing setup.

![Onboarding calendar](images/onboarding-calendar.png)

### Calendar Sync and Import

HandAll supports calendar sync through Google Calendar and also supports private iCal links or file uploads.

The import dialog supports both URL sync and direct file upload, which helps students bring in university calendars or exported schedules without dealing with CORS issues in the browser.

![Calendar import modal](images/calendar-import-modal.png)

Before events are committed, HandAll shows an import preview with converted tasks, category counts, and priority labeling so users can verify what is coming into the planner.

![Calendar import preview](images/calendar-import-preview.png)

The advanced settings view also shows active sync sources so users can see what is currently connected.

![Advanced settings and integrations](images/settings-advanced.png)

### Planner and Calendar Experience

The main planner supports both day and week views, allowing users to zoom in on a single day or look at a fuller weekly plan.

Day view is useful for focused execution and quick task edits.

![Calendar day view](images/calendar-day-view.png)

Week view gives a broader planning perspective and helps users see class load, study blocks, and recovery windows together.

![Calendar week view](images/calendar-week-view.png)

The more populated weekly schedule shows how HandAll combines classes, study blocks, and lower-pressure recovery activities into the same planning surface.

![Calendar populated week](images/calendar-populated-week.png)

Users can manually add new entries through a dedicated modal without leaving the calendar.

![Add event modal](images/calendar-add-event.png)

### Goals and Event Discovery

One of HandAll's distinctive features is the Goals area, which looks beyond school deadlines and helps users build momentum on side ambitions.

The "Fun Events" view surfaces nearby experiences that can support balance and recovery.

![Goals fun events](images/goals-fun-events.png)

The "Goal Events" view narrows results around a specific side goal, like learning guitar or learning Spanish, so the app can suggest more targeted opportunities.

![Goals goal events](images/goals-goal-events.png)

The settings page also lets users maintain side goals over time, which feeds back into event discovery and future planning recommendations.

![Goals settings](images/settings-goals.png)

### AI Assistant and Guided Planning

The built-in assistant is available inside the planner so users can ask for help without leaving the scheduling context.

It is intended for natural-language schedule support, task guidance, and general planning help based on the rest of the app state.

![Assistant chat](images/assistant-chat.png)

### Settings and Personalization

The general settings page gives users a place to manage profile presence, XP, current level, and routine preferences in one place.

![General settings](images/settings-general.png)

The app also includes a motivation or energy slider directly in the dashboard so users can quickly signal how intense or gentle their schedule should feel.

This is visible in the planner screenshots and ties into the app's routine-first scheduling philosophy.

## Core Features

### AI-supported scheduling

- Breaks large work into smaller planning blocks.
- Supports assistant-driven planning inside the app.
- Balances structure with lower-pressure recovery activities.

### Routine-aware planning

- Captures wake-up and sleep windows during onboarding.
- Keeps schedule decisions grounded in how the user actually works.
- Surfaces motivation and energy controls directly in the planner UI.

### Calendar integration

- Google Calendar connection.
- Private iCal URL support.
- Direct `.ics` upload.
- Preview-before-import workflow for safer syncing.

### Side goals and growth

- Stores long-term goals like fitness, music, or language learning.
- Discovers fun and goal-supporting opportunities nearby.
- Connects planning with life outside class deadlines.

## Tech Stack

### Frontend

- React 18
- TypeScript
- Vite
- Tailwind CSS
- Zustand
- Radix UI and shadcn-style component patterns

### Backend

- Node.js
- Express
- SQLite
- Supabase Auth

### AI backend

- Python
- FastAPI
- LangGraph
- OpenAI via `langchain-openai`

## Local Development

### Prerequisites

- Node.js 18 or newer
- Python 3.9 or newer
- A Supabase project for authentication
- An OpenAI API key
- Optional Google Calendar credentials for calendar integration

### Install

```bash
git clone https://github.com/MrFiscus/HandAll.git
cd HandAll
npm run setup
```

### Run the app

```bash
npm run dev
```

This starts:

- the Node backend
- the Vite frontend
- the Python AI service

### Key environment values

Root or backend environment:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
```

Frontend environment:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Project Structure

- `frontend/` - React application and UI components
- `backend/` - Node backend, calendar sync, and persistence
- `backend/main.py` - FastAPI entry point for AI routes
- `backend/planner.py` - planning and decomposition logic
- `backend/agent.py` - conversational assistant logic
- `images/` - screenshots used in the README

## Team

- Evan Bhandari - Calendar UI and sync optimization
- Smaran Pokharel - Google Calendar connect flow and product integration
- Tenzing Gurung - AI planner and motivation sync logic

## License

This project was created for educational and portfolio use.
