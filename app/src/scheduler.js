export function calculateFreeTime(existingEvents, sleepSchedule) {
    console.log("Calculating free time gaps...");
    // Mock gaps in hours
    return [2, 1, 3, 2];
}

export function applyFiftyPercentRule(freeTimeBlocks) {
    console.log("Applying 50% rule to free time blocks (leaving 50% for pure rest)...");
    // Only use half of available free time
    return freeTimeBlocks.map(block => block * 0.5);
}

export function allocateWorkingBlocks(tasks, availableSlots) {
    console.log("Allocating working blocks into available slots...");
    // Mock allocation
    return tasks.map((task, index) => ({
        ...task,
        scheduledSlot: availableSlots[index % availableSlots.length]
    }));
}

export function rebalanceSchedule(rejectedTaskId, tasks) {
    console.log(`Rebalancing schedule after rejection of task ${rejectedTaskId}...`);
    return tasks.filter(t => t.id !== rejectedTaskId);
}