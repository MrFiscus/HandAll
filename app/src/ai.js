// AI Logic Service - Simulating DeepSeek API
export const decomposeTask = (title, totalHours) => {
  const chunks = [];
  for (let i = 0; i < totalHours; i++) {
    chunks.push({
      title: `${title} - Part ${i + 1}`,
      type: 'Working',
      duration: 1 // hour
    });
  }
  return chunks;
};

export const suggestGoalTask = (sideGoal) => {
  const activities = [
    `Progress ${sideGoal}: Skill Drill`,
    `Focus on ${sideGoal} basics`,
    `Advanced practice: ${sideGoal}`
  ];
  return {
    title: activities[Math.floor(Math.random() * activities.length)],
    type: 'Goal',
    duration: 1
  };
};

export const suggestFreeTimeTask = () => {
  const activities = [
    "Quick nap",
    "Short walk in nature",
    "Casual gaming",
    "Read 5 pages",
    "Stretching"
  ];
  return {
    title: activities[Math.floor(Math.random() * activities.length)],
    type: 'Free',
    duration: 0.5
  };
};

export const redlineIdentifyNonEssential = (tasks) => {
  // Logic to identify tasks that can be pushed back (Goal or Free)
  return tasks.filter(t => t.type === 'Goal' || t.type === 'Free').slice(0, 3);
};