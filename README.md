# SYSTEM SPECIFICATION & IMPLEMENTATION PROMPT: "GAME FINDER"

## 1. PROJECT OBJECTIVE & ARCHITECTURE
You are an expert full-stack engineer and architect building "Game Finder", an AI-driven, interactive video game discovery application. The workspace is bifurcated into two root folders:
- `/frontend`: An Angular application.
- `/backend`: A Node.js Express server acting as a Backend-for-Frontend (BFF).

You must generate clean, production-grade, modular code for both directories, handle all installation steps, and ensure zero TypeScript errors.

---

## 2. BACKEND LAYER SPECIFICATION (`/backend`)
Create a robust Node.js Express server with the following endpoints and design patterns:

### A. Core Configurations & Middlewares
- Enable CORS, JSON body parsers, and configure `dotenv` to pull `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, and `GEMINI_API_KEY` from the environment.
- Implement an automated memory-caching mechanism for the IGDB App Access Token (OAuth2 Client Credentials grant flow via `https://id.twitch.tv/oauth2/token`). Automatically refresh the token if it expires.

### B. Endpoint 1: `GET /api/games/search?q=...`
- **Purpose:** Acts as the typeahead autocomplete source.
- **Action:** Query the IGDB API `https://api.igdb.com/v4/games` endpoint using the Apex query language. 
- **Query Structure:** Search by the user string, limit to 8 results, and select fields: `name`, `cover.url`, `summary`, `genres.name`, `platforms.name`.
- **Response:** Return a clean JSON array mapping the raw IGDB results to a standardized array format.

### C. Endpoint 2: `POST /api/quiz/generate`
- **Payload:** `{ favoriteGames: Array<{ name: string, genres: string[] }> }` (exactly 3 games).
- **AI Action:** Send the payload to the Google Gen AI SDK (`gemini-2.5-flash`). Use Structured Outputs (`responseSchema`) to guarantee a non-breaking UI payload.
- **System Prompt Constraint:** 
  "You are an elite, veteran video game recommendation engine. Analyze the 3 provided favorite games. Generate exactly 5 unique, highly specific multiple-choice questions to drill down into the user's specific mechanics, narrative weight, atmospheric pacing, and multiplayer preferences. Avoid generic questions. Output MUST strictly match the defined JSON schema."
- **Expected Output JSON Schema:**
  ```json
  {
    "type": "OBJECT",
    "properties": {
      "themeExplanation": { "type": "STRING" },
      "questions": {
        "type": "ARRAY",
        "items": {
          "type": "OBJECT",
          "properties": {
            "id": { "type": "STRING" },
            "questionText": { "type": "STRING" },
            "options": { "type": "ARRAY", "items": { "type": "STRING" } }
          },
          "required": ["id", "questionText", "options"]
        }
      }
    },
    "required": ["themeExplanation", "questions"]
  }

D. Endpoint 3: POST /api/quiz/recommend
Payload: { favoriteGames: Array, quizAnswers: Array<{ questionId: string, answer: string }> }

AI Action: Pass everything to gemini-2.5-flash with a strict prompt forcing it to return exactly ONE highly tailored game title and a 3-sentence deep analytical reason why it fits their specific profile. Exclude the 3 games provided in their favorite list.

Expected Output JSON Schema:
{
  "type": "OBJECT",
  "properties": {
    "recommendedTitle": { "type": "STRING" },
    "reasoning": { "type": "STRING" }
  },
  "required": ["recommendedTitle", "reasoning"]
}

3. FRONTEND LAYER SPECIFICATION (/frontend)
Initialize an Angular application using modern structural paradigms (prefer Angular v17+ features like @if, @for, and signals where applicable for state tracking).

A. Layout 1: Landing & Autocomplete Selector
Header: Title text: "Find game based on my interest" accompanied by a sleek description block.

Form Component: Render exactly 3 individual text inputs.

Autocomplete Mechanism: Wire an RxJS-driven pipeline on each input using debounceTime(300), distinctUntilChanged(), and switchMap() targeting your backend search endpoint. Display matching names in an accessible overlay dropdown list.

Action: A "Surprise Me" submission button that remains disabled until exactly 3 valid games are selected. Clicking it fires the backend api/quiz/generate request.

B. Layout 2: Step-by-Step Interactive Quiz Form
Switch the view once the 5 questions are received.

Progress Bar Component: Place a prominent, stylized progress indicator at the top tracking current progress (e.g., "Step 2 of 5").

Multi-Step Form Flow: Present the 5 AI-generated multiple-choice questions sequentially (one question view at a time).

Navigation Controls: Include clear interaction elements to step forward or view previous selections. On the final question, the button changes to "Discover My Game". Clicking it submits the selections to the backend api/quiz/recommend endpoint.

C. Layout 3: The Big Reveal Screen
Show a clean loading skeleton state while fetching the response.

Once the title is returned, execute a background call to your IGDB proxy search on the backend using the precise title string to extract the real game metadata.

Render Card: Show a prominent hero layout containing:

High-resolution Box Art / Thumbnail image.

Title, Released Platforms, Genres, and Summary description text from IGDB.

A highlighted callout box containing the AI agent's custom text detailing exactly why this game fits their vibe.

A "Start Over" button to clear state and reinitialize the app workflow.

4. AGENT EXECUTION TASK LIST
Execute the implementation incrementally across these concrete phases:

Phase 1: Initialize the Node.js project inside /backend, create standard scripts, configure dependencies (express, axios, dotenv, @google/genai), and write the IGDB authentication client.

Phase 2: Build out the Express routing controllers for the 3 target endpoints using mock data arrays initially to prove endpoint connectivity.

Phase 3: Integrate the real Google Gen AI SDK configurations and schema enforcements. Validate parsing consistency.

Phase 4: Scaffold the Angular boilerplate in /frontend. Configure routing modules/components and the global HTTP Client.

Phase 5: Build out the RxJS autocomplete search hooks, standard styling frameworks, the 5-step form wizard layout, and state mapping.

Phase 6: Conduct an E2E test run to ensure full connectivity, verifying that data flows seamlessly from input selection to the final AI recommendation layout.
