A time manager app for students that breaks down upcoming big tasks (assignments, labs, projects, etc) into smaller time blocks by pulling info from user calendar and adds the "Working Time Tasks" time blocks into the calendar. The app also looks for free time and also suggests "Free Time Tasks" activities and if user likes it, adds it to the calendar to do. The app also asks for the user's side goal, and suggests "Goal Tasks". The app will use deepseek API to pull info from calendar, add all tasks to calendar, learn from user and suggest "Free Time Tasks", work through a chat interface to talk to user.

1st Setup:
Ask user for calendar input, (.ical, .cal, calendar url) or add events yourself to in-app calendar
	- Also with Class Schedule
Ask user for side goals
Time you wake up, time you sleep.

Weekly (Every Sunday Night):
User gets a notification / pop-up
[AI will do this]
Check the calendar for tasks and free time:
	- Firstly, ask user how long each assignment will take (user can let AI decide as well) break down assignments into "Working Time Tasks"
	- Second, find free time and suggest "Goal Tasks" and "Free Time Tasks".
	The AI will only suggest tasks in 50% of the free time, if 2 hrs is empty 1 hr will only be scheduled the rest of the free time is 	purely rest time
		- The user gets to interact with a UI to reject (cross mark) and accept (check mark), each task also gets a cross 			  button to completely free up that time space. (crossing out "Working Time Task" will notify user with "This is an important 			  task" or something similar
			- if task is rejected (cross mark), suggest alternative task similar to the rejected task.
			- if task is accepted (check mark), the task is added to the app's and user's calendar.

Daily:
First login to the app on a day prompts the user with a question:
How motivated are we feeling today? (user answers with a meter 0-100)
	- If motivation is higher the more the AI is likely to suggest Goal Task, else suggest Free Time Task
		- The user can always chat with the AI to add/subtract any sort of task.

Extra:
Instead of "Let's try something fun!" when motivation is 0-10, the AI should say:
"You're redlining. I’ve identified three non-essential tasks I can push to next week. Should I clear your schedule for the next 4 hours?"


Reward System:
	- Level up System: Level starts at 0 at first. Working Assignment greatly increases Level, Goal Task increases level, and free time task slightly increases task. Levels always stays and doesn't drain.












# Function Interaction & Data Flow Map

This document outlines how the functions within HandAll communicate and depend on one another throughout the application lifecycle.

## 1. The Setup Pipeline (One-time/Update)
- `initializeUser()` -> Provides the configuration (Sleep/Wake, Side Goal, URLs) used by all other modules.
- `syncClassSchedule()` -> Populates the base calendar with fixed recurring blocks, which `calculateFreeTime()` must respect.
- `updatePreferences()` -> Modifies the state used by `generateGoalSuggestions()`.

## 2. The Weekly Orchestration (Sunday Night Sync)
The `weeklySync()` function acts as the primary controller:
1. `fetchExternalEvents()`: Pulls raw data from external providers.
2. `parseAssignments()`: Scans the raw data for specific academic deadlines.
3. `decomposeBigTask()` / `estimateEffort()`: For each assignment found, these break them into "Working Time Tasks".
4. `calculateFreeTime()`: Takes the class schedule and external events to find gaps.
5. `applyFiftyPercentRule()`: Prunes those gaps to ensure the user isn't overscheduled.
6. `allocateWorkingBlocks()`: Fits the decomposed assignment chunks into the best available slots.
7. `generateGoalSuggestions()` / `generateFreeTimeSuggestions()`: Fills the remaining 50% of free slots with suggested activities.

## 3. The Daily Execution & Motivation Loop
- `dailyCheckIn()`: Captures user motivation level.
    - If motivation is High: Signals `allocateWorkingBlocks()` to prioritize "Goal Tasks".
    - If motivation is Low: Signals `allocateWorkingBlocks()` to prioritize "Free Time Tasks".
    - If motivation is Critical (0-10): Triggers `redlineProtocol()`.
- `redlineProtocol()`: Communicates with the calendar to identify and postpone non-essential tasks, effectively clearing the schedule.

## 4. User Interaction & Feedback
- `pushToCalendar()`: Finalizes an "Accepted" task by writing it to the internal and external calendar.
- `rebalanceSchedule()`: Triggered when a task is "Rejected"; it calls `generateFreeTimeSuggestions()` or `generateGoalSuggestions()` to find a suitable alternative for that specific time slot.
- `processChat()`: A global listener that can manually trigger `allocateWorkingBlocks()` (to add a task) or `pushToCalendar()` (to remove/modify).

## 5. Progression & Rewards
- `calculateXP()`: Listens for "Accepted" or "Completed" status from `pushToCalendar()`.
- `updateUserLevel()`: Updates the persistent user profile based on the output of `calculateXP()`.

## Data Dependencies Summary
- **Input Data**: `initializeUser`, `fetchExternalEvents`.
- **Processing**: `parseAssignments`, `decomposeBigTask`, `calculateFreeTime`.
- **Decision Making**: `dailyCheckIn`, `applyFiftyPercentRule`.
- **Output/State Change**: `pushToCalendar`, `updateUserLevel`, `rebalanceSchedule`.
