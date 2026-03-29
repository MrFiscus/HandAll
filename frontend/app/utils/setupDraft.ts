const SETUP_DRAFT_KEY = "handall-setup-draft";

export interface SetupDraftState {
  name: string;
  wakeTime: string;
  sleepTime: string;
  sideGoals: string;
  motivation: number;
}

export function saveSetupDraft(state: SetupDraftState) {
  sessionStorage.setItem(SETUP_DRAFT_KEY, JSON.stringify(state));
}

export function readSetupDraft(): SetupDraftState | null {
  const raw = sessionStorage.getItem(SETUP_DRAFT_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as SetupDraftState;
  } catch (error) {
    console.error("Failed to parse setup draft:", error);
    sessionStorage.removeItem(SETUP_DRAFT_KEY);
    return null;
  }
}

export function clearSetupDraft() {
  sessionStorage.removeItem(SETUP_DRAFT_KEY);
}
