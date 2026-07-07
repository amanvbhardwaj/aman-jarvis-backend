# Jarvis Backend — Setup on Render

## Required environment variable
| Name | Value |
|---|---|
| `PERPLEXITY_API_KEY` | your `pplx-...` key (the brain) |

## Optional environment variables
| Name | Value | Purpose |
|---|---|---|
| `JARVIS_MODEL` | `sonar` \| `sonar-pro` \| `sonar-reasoning` | which Sonar model (default `sonar-pro`) |
| `ALLOWED_ORIGIN` | `https://amanvbhardwaj.github.io` | frontend origin for CORS |
| `FIREBASE_SERVICE_ACCOUNT` | full JSON of a Firebase service account | enables server-side memory + module data |

## IMPORTANT — why "PERPLEXITY_API_KEY is not set" happens
The backend reads `process.env.PERPLEXITY_API_KEY`. If Render shows that error:
1. The variable name must be EXACTLY `PERPLEXITY_API_KEY` (all caps, underscores).
2. It must be added to the **aman-jarvis-backend** web service (not another service).
3. It must be an **Environment Variable** (not a Secret File).
4. Paste the value with **no quotes and no spaces**.
5. Click **Save Changes**, then wait for a new deploy to go **Live**.
   If no deploy starts, click **Manual Deploy -> Deploy latest commit**.
6. Confirm in **Logs**: you should see `Jarvis backend v2 running on port 10000`.

## Enabling server-side memory (recommended)
1. Firebase Console -> Project Settings -> Service accounts -> **Generate new private key**.
2. Copy the entire JSON file contents.
3. In Render, add env var `FIREBASE_SERVICE_ACCOUNT` = that JSON (paste as one value).
4. Redeploy. Logs will show `Firestore memory: ENABLED (server-side)`.

Without this, Jarvis still chats and the frontend still logs messages to Firestore;
the server just won't read history back into prompts. With it, Jarvis has full recall.

## Endpoints
- `POST /api/jarvis`                { message }                     -> chat with memory
- `GET/POST /api/profile`           { ...facts }                    -> durable profile
- `POST /api/finance/log`           { amount, category, note, type }
- `POST /api/finance/advice`        { question? }
- `POST /api/health/log`            { workout, duration, notes } or { metric, value }
- `POST /api/health/coach`          { question? }
- `POST /api/nutrition/log`         { meal, calories, protein, notes }
- `POST /api/nutrition/plan`        { question? }
- `POST /api/immigration/update`    { ...status }
- `POST /api/immigration/ask`       { question? }
- `POST /api/brief`                 { events? }                     -> daily brief
- `POST /api/content/draft`         { topic, format }               -> IG draft (approval-gated)
- `GET  /api/content/drafts`
- `POST /api/income/opportunities`  { focus? }                      -> researched leads
