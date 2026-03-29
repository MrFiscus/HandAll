# HandAll - AI-Driven Student Time Manager

HandAll is a sophisticated time management application specifically designed for students. It goes beyond simple scheduling by using Artificial Intelligence to break down large assignments into manageable working blocks, syncing with multiple calendar sources, and dynamically rebalancing your schedule based on your current motivation levels.

## 🚀 Key Features

### 📅 Advanced Calendar Interface
- **Dynamic Collision Detection:** Overlapping events are automatically detected and displayed side-by-side for maximum clarity.
- **Smart Drag-and-Drop:** Reposition events with a professional "ghost" preview that shows the new time in real-time before you drop.
- **Multi-Day Handling:** Overnight events (e.g., 10 PM - 8 AM) are gracefully clipped and split across day columns.
- **Dual View Modes:** Seamlessly toggle between a comprehensive **Week View** and a focused **Day View**.
- **Interactive Completion:** Quickly cross out and mark tasks as finished using **Shift + Click**.

### 🤖 AI-Powered Scheduling
- **Task Decomposition:** Large projects and assignments are automatically broken down into smaller, actionable "Working Blocks" by the AI planner.
- **The Motivation Engine:** Schedules are rebalanced using a "50% rule" logic—the app adjusts task density based on your current motivation level (0-100).
- **AI Chat Assistant:** A built-in assistant powered by **LangGraph** and **Gemini** helps you manage tasks and check your schedule through natural conversation.

### 🔄 Seamless Synchronization
- **Google Calendar Integration:** Direct sync with your Google account.
- **Private iCal Support:** Import private calendar URLs via a secure backend proxy to bypass CORS restrictions.
- **File Uploads:** Support for importing `.ics` files directly into your dashboard.

### 🎮 Gamified Productivity
- **XP & Leveling System:** Earn XP by completing tasks. "Working" blocks provide the highest rewards, followed by "Goal" and "Free Time" tasks.
- **Progress Tracking:** Monitor your level and XP progress directly from the sidebar.

---

## 🛠️ Tech Stack

### Frontend
- **Framework:** React 18 (Vite)
- **Language:** TypeScript
- **State Management:** Zustand
- **Styling:** Tailwind CSS, shadcn/ui, Radix UI
- **Date Handling:** date-fns

### Backend (Orchestrator)
- **Runtime:** Node.js (Express)
- **Database:** SQLite (with `sqlite3` and `sqlite` wrapper)
- **Authentication:** Supabase Auth
- **APIs:** Google Calendar API, iCal Parsing

### AI Backend (Planner & Agent)
- **Framework:** Python (FastAPI)
- **AI Orchestration:** LangGraph
- **LLM:** Google Gemini (via `langchain-google-genai`)
- **Environment:** Uvicorn

---

## 📥 Getting Started

### Prerequisites
- Node.js (v18 or higher recommended)
- Python 3.9+
- A Google Cloud Project (for Calendar API)
- A Gemini API Key
- A Supabase Project (for Auth)

### 1. Repository Setup
```bash
git clone https://github.com/evanbh256/HandAll.git
cd HandAll
npm install
```

### 2. Backend Setup (Node.js)
1. Navigate to the backend folder:
   ```bash
   cd backend
   npm install
   ```
2. Create a `.env` file in the `backend/` directory:
   ```env
   SUPABASE_URL=your_supabase_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   HANDALL_PLANNER_URL=http://127.0.0.1:8011
   ```
3. Initialize/Reset the database:
   ```bash
   npm run reset-db
   ```
4. Start the server:
   ```bash
   npm start
   ```

### 3. AI Backend Setup (Python)
1. Navigate to the backend folder (in a new terminal):
   ```bash
   cd backend
   # Recommended: Create a virtual environment
   python -m venv .venv
   source .venv/bin/activate # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```
2. Create a `.env` file in the root or `backend/` directory:
   ```env
   GOOGLE_API_KEY=your_gemini_api_key
   ```
3. Start the FastAPI server:
   ```bash
   uvicorn main:app --port 8011
   ```

### 4. Frontend Setup (React)
1. Navigate to the frontend folder:
   ```bash
   cd frontend
   npm install
   ```
2. Create a `.env` file in the `frontend/` directory:
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   VITE_AGENT_API_URL=http://localhost:8011
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

---

## 📁 Project Structure

- `frontend/`: React application, UI components, and state logic.
- `backend/`: Node.js Express server handling user data and calendar proxying.
- `backend/main.py`: FastAPI entry point for AI planning and chat.
- `backend/planner.py`: Core logic for task decomposition and schedule rebalancing.
- `backend/agent.py`: LangGraph-based AI agent for conversational interactions.
- `functions/`: Design documents and pseudocode for core business logic.

---

## 👥 Development Team
- **Evan Bhandari** - Advanced Calendar UI & Sync Optimization
- **Smaran Pokharel** - Google Calendar Connect Flow
- **Tenzing Gurung** - AI Planner & Motivation Sync Logic

---

## ⚖️ License
This project is for educational use as part of the DSU Student curriculum.
