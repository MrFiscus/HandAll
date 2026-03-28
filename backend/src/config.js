export function initializeUser(calendarLinks, classSchedule, sideGoal, sleepWakeTimes) {
    console.log("Initializing user profile...");
    return {
        calendarLinks,
        classSchedule,
        sideGoal,
        sleepWakeTimes,
        level: 0,
        xp: 0
    };
}

export function syncClassSchedule(userProfile, scheduleData) {
    console.log("Syncing class schedule...");
    userProfile.classSchedule = scheduleData;
    return userProfile;
}

export function updatePreferences(userProfile, newPreferences) {
    console.log("Updating preferences...");
    Object.assign(userProfile, newPreferences);
    return userProfile;
}