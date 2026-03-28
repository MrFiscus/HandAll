export function fetchExternalEvents(calendarLinks) {
    console.log("Fetching external events from calendars...");
    // Mocked events
    return [
        { id: 1, title: "Math Assignment", type: "Assignment", dueDate: "2026-03-30" },
        { id: 2, title: "Physics Lab", type: "Project", dueDate: "2026-04-02" }
    ];
}

export function parseAssignments(events) {
    console.log("Parsing assignments from events...");
    return events.filter(e => e.type === "Assignment" || e.type === "Project");
}

export function pushToCalendar(task) {
    console.log(`Pushing task to calendar: ${task.title} (${task.type})`);
    return true;
}