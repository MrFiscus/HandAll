import { initializeUser } from './config.js';
import { weeklySync, dailyCheckIn } from './interaction.js';
import { pushToCalendar } from './calendar.js';
import { calculateXP, updateUserLevel } from './rewards.js';

async function main() {
    console.log("🚀 Starting HandAll App...\n");

    // 1. Setup Phase
    let userProfile = initializeUser(
        ['https://calendar.google.com/example'],
        ['Math 101 Mon/Wed', 'Physics 201 Tue/Thu'],
        'Learn Guitar',
        { wake: '07:00', sleep: '23:00' }
    );
    console.log("\n");

    // 2. Weekly Sync (Sunday)
    let pendingTasks = await weeklySync(userProfile);
    
    // Simulate user accepting a task
    if (pendingTasks.length > 0) {
        const taskToAccept = pendingTasks[0];
        console.log(`\n[UI] User accepted task: ${taskToAccept.title}`);
        pushToCalendar(taskToAccept);
        
        // 3. Rewards System
        const xp = calculateXP(taskToAccept.type);
        updateUserLevel(userProfile, xp);
    }
    
    // Simulate user accepting a second task to trigger level up
    if (pendingTasks.length > 1) {
        const taskToAccept2 = pendingTasks[1];
        console.log(`\n[UI] User accepted task: ${taskToAccept2.title}`);
        pushToCalendar(taskToAccept2);
        
        const xp = calculateXP(taskToAccept2.type);
        updateUserLevel(userProfile, xp);
    }

    // 4. Daily Check-In
    console.log("\n--- Simulating Daily Actions ---");
    dailyCheckIn(80, []); // High motivation example
    dailyCheckIn(5, []);  // Redline protocol example
}

main();