export function calculateXP(taskType) {
    switch (taskType) {
        case "Working Time Task":
        case "Assignment":
            return 50;
        case "Goal Task":
            return 30;
        case "Free Time Task":
            return 10;
        default:
            return 0;
    }
}

export function updateUserLevel(userProfile, xpGained) {
    userProfile.xp += xpGained;
    const levelThreshold = 100; // 100 XP per level
    const oldLevel = userProfile.level;
    userProfile.level = Math.floor(userProfile.xp / levelThreshold);
    
    if (userProfile.level > oldLevel) {
        console.log(`🎉 Level Up! You are now level ${userProfile.level}!`);
    } else {
        console.log(`Gained ${xpGained} XP. Total XP: ${userProfile.xp}`);
    }
    return userProfile;
}