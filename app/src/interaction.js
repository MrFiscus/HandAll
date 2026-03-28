import { fetchExternalEvents, parseAssignments } from './calendar.js';
import { estimateEffort, decomposeBigTask, generateGoalSuggestions, generateFreeTimeSuggestions } from './ai.js';
import { calculateFreeTime, applyFiftyPercentRule } from './scheduler.js';

export async function weeklySync(userProfile) {
    console.log("--- Starting Weekly Sync (Sunday Night) ---");
    const events = fetchExternalEvents(userProfile.calendarLinks);
    const assignments = parseAssignments(events);
    
    let pendingTasks = [];
    for (const task of assignments) {
        let duration = await estimateEffort(task);
        let workBlocks = await decomposeBigTask(task, duration);
        pendingTasks.push(...workBlocks);
    }

    const freeSlots = calculateFreeTime(events, userProfile.sleepWakeTimes);
    const suggestionSlots = applyFiftyPercentRule(freeSlots);
    
    // Suggest one goal and one free time task as an example
    if (suggestionSlots.length > 0) {
        const goalTask = await generateGoalSuggestions(userProfile.sideGoal, suggestionSlots[0]);
        const freeTask = await generateFreeTimeSuggestions([], suggestionSlots[0]);
        pendingTasks.push(goalTask, freeTask);
    }

    console.log("Weekly Sync Pending Tasks generated.");
    return pendingTasks;
}

export function redlineProtocol() {
    console.log("!!! REDLINE PROTOCOL INITIATED !!!");
    console.log("You're redlining. I’ve identified 3 non-essential tasks I can push to next week.");
    console.log("Should I clear your schedule for the next 4 hours?");
}

export function dailyCheckIn(motivationScore, todaySchedule) {
    console.log(`\n--- Daily Check-In ---`);
    console.log(`Motivation Score: ${motivationScore}/100`);
    
    if (motivationScore <= 10) {
        redlineProtocol();
    } else if (motivationScore > 75) {
        console.log("High motivation! Weighting suggestions towards Goal Tasks.");
    } else {
        console.log("Moderate/Low motivation. Weighting suggestions towards Free Time Tasks.");
    }
}

export function processChat(message) {
    console.log(`Processing user chat: "${message}"`);
}