export async function estimateEffort(task) {
    console.log(`AI: Estimating effort for ${task.title}...`);
    // Mock AI estimation
    return 4; // hours
}

export async function decomposeBigTask(task, estimatedHours) {
    console.log(`AI: Decomposing ${task.title} into chunks of ${estimatedHours} hours total...`);
    const chunks = [];
    for(let i=0; i < estimatedHours; i++) {
        chunks.push({ 
            ...task, 
            id: `${task.id}-${i}`, 
            title: `${task.title} - Part ${i+1}`, 
            duration: 1, 
            type: "Working Time Task" 
        });
    }
    return chunks;
}

export async function generateGoalSuggestions(sideGoal, freeTime) {
    console.log(`AI: Generating goal suggestions for side goal: ${sideGoal}`);
    return { title: `Practice ${sideGoal}`, duration: 1, type: "Goal Task" };
}

export async function generateFreeTimeSuggestions(history, freeTime) {
    console.log("AI: Generating free time suggestions based on history...");
    return { title: "Watch a movie or play games", duration: 1, type: "Free Time Task" };
}