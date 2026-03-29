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

Existing entries can also be updated in place, which makes it easy to adjust start times, mark work done, or clean up the plan without leaving the weekly view.

![Edit event modal](images/calendar-edit-event.png)

The motivation slider also lives directly inside the planner. It gives the AI a fast signal about how intense or protected the day should feel, which lets HandAll reshape the daily schedule around a more relaxed mode or a stronger lock-in mode.

![Motivation slider and AI schedule mode](images/motivation-slider-lock-in.png)

The built-in assistant is available inside the planner so users can ask for help without leaving the scheduling context.

It is intended for natural-language schedule support, task guidance, and general planning help based on the rest of the app state.

![Assistant chat](images/assistant-chat.png)

### Goals and Event Discovery

One of HandAll's distinctive features is the Goals area, which looks beyond school deadlines and helps users build momentum on side ambitions.

The "Fun Events" view surfaces nearby experiences that can support balance and recovery.

![Goals fun events](images/goals-fun-events.png)

The "Goal Events" view narrows results around a specific side goal, like learning guitar or learning Spanish, so the app can suggest more targeted opportunities.

![Goals goal events](images/goals-goal-events.png)

The settings page also lets users maintain side goals over time, which feeds back into event discovery and future planning recommendations.

![Goals settings](images/settings-goals.png)

### Settings and Personalization

The general settings page gives users a place to manage profile presence, XP, current level, and routine preferences in one place.

![General settings](images/settings-general.png)

The advanced settings view also shows active sync sources so users can see what is currently connected.

![Advanced settings and integrations](images/settings-advanced.png)

The broader settings flow supports the planner's routine-first behavior, while the motivation slider itself lives inside the calendar so users can adjust schedule intensity in context.

## Core Features

### AI-supported scheduling

- Breaks large work into smaller planning blocks.
- Supports assistant-driven planning inside the app.
- Balances structure with lower-pressure recovery activities.
- Modifies the daily plan using AI based on the current motivation slider state.
- Uses the motivation slider to shift between gentler recovery-oriented planning and stronger lock-in scheduling.
- Includes burnout-aware scheduling logic so tasks are distributed in a way that helps prevent students from overloading themselves.

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

### Progress and rewards

- Includes an XP system that rewards completed tasks.
- Uses task completion as a way to make progress visible and reinforce consistency.
- Tracks user progress directly inside the product through the profile and planner experience.

When a task is completed, HandAll gives immediate XP feedback so users can see progress as part of the scheduling loop rather than as a separate dashboard-only system.

![Task complete XP reward](images/xp-task-complete.png)

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

### Environment setup

HandAll uses variables across the root, backend, and frontend. A practical local setup looks like this.

Root or backend `.env`:

```env
# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key

# OpenAI
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini

# Planner / AI service
HANDALL_PLANNER_URL=http://127.0.0.1:8011

# Event discovery
FIRECRAWL_API_KEY=your_firecrawl_api_key

# Google Calendar / OAuth
GOOGLE_API_KEY=your_google_api_key
GOOGLE_CALENDAR_ID=primary
GOOGLE_SERVICE_ACCOUNT_FILE=service_account.json
# or use GOOGLE_SERVICE_ACCOUNT_JSON instead of a file
GOOGLE_SERVICE_ACCOUNT_JSON=
GOOGLE_OAUTH_CLIENT_ID=your_google_oauth_client_id
GOOGLE_OAUTH_CLIENT_SECRET=your_google_oauth_client_secret

# Optional debug flags
HANDALL_EXPOSE_ERRORS=1
HANDALL_CHAT_TEST_OPENAI=1
LOG_LEVEL=INFO

# Optional Postgres override
DATABASE_URL=
```

Frontend `frontend/.env`:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_AGENT_API_URL=http://127.0.0.1:8011
```

Notes:

- If `DATABASE_URL` is not set, the app falls back to the local SQLite database.
- `GOOGLE_SERVICE_ACCOUNT_FILE` is useful locally, while `GOOGLE_SERVICE_ACCOUNT_JSON` is better for hosted environments.
- `SUPABASE_ANON_KEY` can still be used as a fallback in some Python paths, but `SUPABASE_KEY` is the cleaner primary name in this repo.

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
- Sandesh Dhakal - Frontend and presentation
- Tenzing Gurung - AI planner and motivation sync logic

## Project Context

HandAll was built for the Nepal-US Hackathon 2026.

The full idea, product direction, implementation, and coding were completed within a 36-hour hackathon sprint.
