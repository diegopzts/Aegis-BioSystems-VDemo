# AEGIS BioSystems



**Autonomous Health Intelligence for Space Exploration**



*Beyond Monitoring. Towards Prevention.*



Educational demonstration for the NASA Space Apps Challenge 2026. Ares Pathfinder is a fictional Mars transit mission featuring 30 days of synthetic telemetry for Maya Chen. Observation rules are demonstrative and lack clinical validation.



[Deploy to GitHub and Render from PowerShell](#deploy-the-demo-to-github-and-render-from-powershell).



[Enable the orbital view or switch back to classic](#orbital-view-and-classic-rollback).



## Orbital view and classic rollback



The Docker image starts in the orbital view. The local backend starts in the classic view if the variable is undefined. The `AEGIS_ORBITAL_UI_ENABLED` flag accepts `1` or `true` to enable the orbital view and `0` to revert to the classic view in both environments.



- **Local development.** Add `AEGIS_ORBITAL_UI_ENABLED=1` to `backend/.env` or run `$env:AEGIS_ORBITAL_UI_ENABLED = '1'` in the FastAPI terminal. Restart FastAPI and reload the page. To switch back to the classic view, change the value to `0` and repeat these steps. The terminal environment takes precedence over `backend/.env`.

- **Render.** In the service, open **Environment**, add `AEGIS_ORBITAL_UI_ENABLED` with value `1`, and choose **Save and deploy**. To revert to the classic view for all visitors, save the value `0` in the same way. [Environment Variables on Render](https://render.com/docs/configure-environment-variables).

- **In your browser.** Select **Classic** under **Visual experience** to save that preference in the browser. Select **Automatic** to follow the server flag again. For an immediate rollback, open the same route with `?aegis-ui=classic` (or append `&aegis-ui=classic` if query parameters are already present). This option takes precedence and works without querying `/api/config`. Remove the parameter to reapply the saved preference.



If the configuration query or the orbital view fails to load, the classic view appears with a notice. Both experiences use the same console, microphone, voice queue, and data. Switching via the selector preserves the active session. Opening the emergency link reloads the page, so you will need to restart the microphone if it was active. On Render Free, **Save and deploy** restarts the service and may clear temporary demo state. Use the selector if you need to switch back to the classic view during a session without restarting the service.



The local checkpoint `checkpoint/pre-orbital-experience` identifies the previous version. The flag and selector let you revert to the classic view without restoring files from the checkpoint.



## Run on Windows



Requirements: Python 3.11 or later, Node.js 22 or later, and npm. Run each block from the root of this project in a separate PowerShell terminal.



**Terminal 1 · FastAPI**



```powershell

python -m venv .venv

.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

Set-Location backend

..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8005

```



If Windows resolves `python` to the Microsoft Store alias, use `py -m venv .venv` or invoke the installed interpreter using its full path. You do not need to activate the virtual environment.



**Terminal 2 · Vite**



```powershell

Set-Location frontend

npm.cmd ci

npm.cmd run dev

```



Open [AEGIS BioSystems](http://127.0.0.1:5173/). The [interactive FastAPI documentation](http://127.0.0.1:8005/docs) describes the endpoints. If port 5173 is in use, run `npm.cmd run dev -- --port 5187` and open [the alternate view](http://127.0.0.1:5187/). If you use Gemini Live on that port, add `http://127.0.0.1:5187` to `CORS_ORIGINS` in `backend/.env` and restart FastAPI.



### Orbital blue star



The orbital view draws the star with one WebGL triangle. The fragment shader uses a projected sphere radius of 0.70, slow noise-domain drift for the plasma, and separate falloffs for the corona and prominences. The voice activity uniform controls only a small brightness accent. The canvas targets roughly 30 updates per second, caps its backing resolution at 384 pixels per side, and lowers that cap to 256 when frame intervals stay high. It stops drawing while the document is hidden and renders a still frame with reduced motion. A static CSS star appears when WebGL is unavailable or the context is lost. The Classic view is available through `?aegis-ui=classic`.



### BioSystems 3D



Open **BioSystems 3D** in either the orbital or classic view. The AstroSalud viewer was integrated as a native AEGIS component using the Three.js version already present in the project. It preserves the original GLB, camera, lights, grid, region highlighting, rotation, zoom, and focus. The support layer retains the original name-based filtering, though it does not constitute a full skeleton. The file does not include internal organs, texture maps, or embedded animations; transitions and rotation are handled by the viewer.



The `frontend/public/biosystems/cuerpo.glb` file is 26.48 MB and downloads once the module is opened. Vite copies it untransformed to `dist/biosystems/cuerpo.glb`, and Docker bundles it to serve over HTTPS from the same origin as the application. WebGL 2 is required; if continuous rotation feels sluggish, you can pause it without reducing model quality. The reduced-motion preference disables automatic rotation and animated camera movement. **Load model** accepts a self-contained GLB or glTF file from your machine without uploading it to a server.



Stress practice and its charts remain separate from AEGIS simulated telemetry. Gemini preserves the existing contract: full body, head, chest, or limbs, viewed from the front, left, right, or back. To return to the initial view, use **Reset view** or ask Gemini to reset the model. The `checkpoint/pre-biosystems-3d-migration` checkpoint preserves the immediately preceding version.



### Live Vital Monitoring



The `datossensor.html` monitor retains its interface and Canvas 2D engine inside React and Shadow DOM. The ECG scrolls at 120 visual points per second regardless of display refresh rate. ECG profiles, custom controls, oximetry, NIRS, and redox profiles are synthetic. **Pause** freezes the waveform, and **Reset simulation** restores controls and trends. Previous mission history remains accessible in its section, preserving its scales and exports.



The simulation sends the displayed figures to FastAPI; Gemini can query them via `get_live_vitals`, along with available coverage from the last minute. The session does not persist these figures to disk. The optional Web Serial port reads text ADC values (one sample per line, 9600 or 115200 bps) and renders them exclusively in the browser. It does not send samples or health estimates to FastAPI or Gemini. The USB button requires HTTPS or localhost, a browser supporting Web Serial, and a connected device.



## Configure Gemini



1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey).

2. From the project root, copy the example file and open the local configuration:



   ```powershell

   if (-not (Test-Path -LiteralPath .\backend\.env)) { Copy-Item .\backend\.env.example .\backend\.env }

   notepad .\backend\.env

   ```



3. Enter the key in `GEMINI_API_KEY` and restart FastAPI. The header indicates whether the backend is responding. In the assistant panel, "Gemini unconfigured" indicates a missing key, while "Gemini configured" indicates a local key has been loaded. Verify access by sending a message.



The backend reads the key from the service environment or the local `backend/.env` file. The default text model is `gemini-3.5-flash`. Setting `GEMINI_MODEL=auto` queries the available catalog and tries up to four candidate text models in case of compatibility or service errors. `GEMINI_LIVE_MODEL=auto` searches for conversational Live models and tries fallback models if the initial connection fails. Both options accept an explicit model ID. Quota, available models, and permissions depend on the project configured in AI Studio. If Live fails, you can continue using text chat.



### Companion and AEGIS data



The Companion has continuous access to the AEGIS domain. It uses typed backend tools to query the mission, simulator, physiology by day or range, sleep and recommendations, wellness, alert reviews, and activity. For general questions, it uses a bounded summary. It can inspect observations when relevant and distinguish manual logs from simulation data. Sleep does not have an independent editable log.



With clear instructions via text or voice, it can create, edit, and delete manual logs, review alerts, switch scenarios, advance or reset the simulation, and control the UI. If a log ID or value is missing, it asks for clarification. At most one persistent change is executed per turn. Model commands never grant access to arbitrary SQL, files, PowerShell, or executable code. Physiological values are simulated by the backend.



Recent chat context, relevant tool outputs (which may include observations), and audio when voice is started are processed by Google Gemini. The conversation and transcript remain in tab memory and can be cleared. AEGIS does not store audio. The API key is read exclusively from `backend/.env`. Changes and their audit log are stored locally in SQLite; the log records the operation, identifier when applicable, timestamp, and outcome. Record deletion is logical (soft delete). Under **Local activity**, you can undo recent creations or deletions if the record is still at the corresponding version, or request an undo by activity ID.



Try "Log mood 4, stress 3, and energy 5", "Edit stress on log #12 to 2", or "Remove log #12" (using an actual ID from local history). **Saved** is displayed based on the FastAPI response. Resetting returns to day 1 of the baseline scenario while preserving logs and reviews. The active scenario and day are stored in the browser. Wellness prompts are enabled by default, appear at most once per simulated day, and can be disabled under **Configure check-ins**. AEGIS is a synthetic-data demonstration and does not replace professional support.



### Voice and diagnostics



1. In the local console, open **Companion → Start voice** and grant browser microphone permission. Ask a brief question, then request a long response. Watch **Audio diagnostics** and verify that text/transcription appears during the turn.

2. Interrupt by speaking while AEGIS is playing its response. Previous playback should stop. If the browser suspends audio, click **Resume audio**.

3. Briefly disconnect from the internet, reconnect, and observe the reconnection attempts. Up to three attempts are made, with delays of 0.5, 1.5, and 3.5 seconds. If exhausted, click **Reconnect**. A new session is established without resending previous audio. Gemini voice history is not resumed. **Stop voice** releases resources.



To absorb jittery arrivals, voice waits to buffer 120 ms at startup or 240 ms if the buffer runs dry. If that threshold is not reached within 300 ms, it plays whatever is available. At the end of a turn, any remaining chunk is played immediately, even if shorter. The player schedules complete chunks against the audio clock and preserves ordering. If the memory limit (32 MiB or 8,192 chunks) is reached, already-accepted audio is drained and a warning is raised; pending chunks are not overwritten by newer ones.



Diagnostics report PCM rate, accepted and played chunks, buffer underruns, approximate output latency, and audio and socket states, without storing audio or transcripts. Capture sends 16-bit mono PCM at 16 kHz, little-endian; output uses the sample rate advertised in the MIME type, defaulting to 24 kHz if omitted. Sources: [Gemini Live formats](https://ai.google.dev/gemini-api/docs/live-api/capabilities), [Live sessions](https://ai.google.dev/gemini-api/docs/live-api/session-management), and [Web Audio clock](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/currentTime).



### Test text Gemini



With an empty key in `backend/.env`, open the console and verify that modules remain available and that Companion displays **Gemini unconfigured**. Local prompts and mission modules work with an empty key.



With a configured key and a restarted backend, run from PowerShell:



```powershell

try {

  $body = @{ messages = @(@{ role = 'user'; text = 'Reply with OK.' }) } | ConvertTo-Json -Depth 4

  $result = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8005/api/chat' -ContentType 'application/json' -Body $body -TimeoutSec 90

  if ($result.reply -and $result.model) { 'Success' } else { 'Error: unexpected response' }

} catch {

  if ($_.Exception.Response) { "HTTP Error $([int]$_.Exception.Response.StatusCode)" }

  else { 'Error: backend unreachable or request timed out' }

}

```



To check configuration status alone, run `(Invoke-RestMethod 'http://127.0.0.1:8005/api/health').geminiStatus`. `configured` indicates a key is present, and `unconfigured` indicates it is missing or empty. To verify Live separately, use **Start voice** in the browser and ask a brief question. Internet access, microphone permission, and a Live model accessible to your project are required.



## Three-minute demo



| Time | Screen | Action |

| --- | --- | --- |

| 0:00 | **Mission Overview** | Introduce the mission, metrics, and the initial **Sleep deficit** scenario. Verify that Gemini is configured before testing chat or voice. |

| 0:25 | **Sleep Intelligence** | Select November 12. Review the five consecutive nights under 7 hours and the associated recommendation. |

| 0:55 | **Companion** | Ask "How have I slept this week and what can I improve?". Compare the answer against the average and observations. |

| 1:25 | **Psychological Wellness** | Log a stress level of 5 and verify the update in the history and chart. |

| 1:50 | **Companion** | Ask "What relationship do you see between my rest and wellness?". The assistant can inspect the descriptive association. |

| 2:15 | **BioSystems 3D** | Say "Open the 3D viewer, focus on the chest, and rotate right." Use **Reset view** to restore the camera. |

| 2:40 | **Voice** | Select **Start voice**, ask a sleep-related question, and finish with **Stop voice** if your key supports Live. |



**Vital Monitoring** offers 24-hour, 7-day, and 30-day views, line and bar charts, baseline overlays, and CSV/JSON exports. Switch **Scenario** to step through nominal baseline, insufficient sleep, schedule shift, elevated stress, and recovery. Views, exports, and Gemini all query the same simulation.



## Data and testing



`backend/app/simulation.py` generates 30 reproducible days using a fixed seed. For physiological metrics, the average of the 24 hourly samples matches the daily summary. For sleep, the sum of minutes asleep across the 24 intervals matches the recorded duration. Timestamps follow a simulated mission clock. `backend/app/analytics.py` centralizes sleep thresholds and recommendations. Check-ins belong to the active scenario and simulated mission day, tagged with their real-world entry time. Existing logs are preserved on day 30. The chart plots the latest check-in for each day.



From the root directory, with the environment ready:



```powershell

Push-Location backend

..\.venv\Scripts\python.exe -m pytest -q

Pop-Location

Push-Location frontend

npm.cmd run test

npm.cmd run build

Pop-Location

```



- **Automated tests:** health checks, contracts, reproducible scenarios, consistency, sleep calculations, SQLite persistence, action validation, navigation, and calendar behavior.

- **Provider simulation:** tool execution flows, text fallback, errors, voice WebSocket, state transitions, client disconnect, and microphone release. The viewer test mocks the canvas and verifies region and camera controls.

- **Browser verification:** mission dashboard, night selection, calendar detail, vital-sign view switching, CSV download, guided pause, and WebGL rendering and rotation.

- **Extended Companion verification:** The test suite uses mocked responses to verify direct state mutations, provider errors, late-arriving chunk playback, and disconnections. Live connectivity was verified against `gemini-3.8-live` with tool calling and transcription, without transmitting audio or personal records. Live conversation with a real microphone is tested via the steps above.



Implementation references: [Function Calling](https://ai.google.dev/gemini-api/docs/function-calling), [Gemini Live SDK](https://ai.google.dev/gemini-api/docs/live-api/get-started-sdk), [Tools in Live](https://ai.google.dev/gemini-api/docs/live-api/tools), and [Model Catalog](https://ai.google.dev/api/models).



## Simulate a situation



The **Simulate Situation:** bar triggers Bio-Sync, O₂ Leak, Extreme Isolation, or Mars Murphy's Law. **Restore Nominal** returns to the standard view, stops ambient audio and the breathing guide, and discards prior pending context. State lives in FastAPI memory for the duration of the demo session. Narrative Day 142 does not alter the preceding calendar.



The UI receives its initial state from `GET /api/simulation`, each trigger result from `POST /api/simulation/{scenario}`, and—when voice is active—updates over the same Live WebSocket. Habitat changes are fictional, versioned, and deduplicated. In Zero-UI, primary metrics, voice status, navigation, and restoration remain accessible.



To hear the initial intervention, open **Companion → Start voice** and allow microphone access. Trigger a situation and wait for the voice prompt without speaking. If you trigger the situation first, Live receives the latest pending situation upon connecting. Gemini 3.8 Live receives a full client turn; fallback models receive real-time text input. Ambient audio is optional and ducks while voice playback is active. Both the visual guide and the LFO operate on a 10 s period. In Isolation, the acoustic proxy uses the same authorized microphone, with all processing remaining local to the browser.



In live testing with the Gemini 3.8 Live SDK, the first audio from the synthetic Bio-Sync turn arrived **923 ms** after sending context over an already-open connection. The microphone was not active. This figure excludes the local WebSocket, playback buffering, and speaker output. For an end-to-end latency comparison, measure on the same machine and browser from PCM transmission to first audible output using the same script across both the previous and current builds. That comparative measurement is not currently available.



References: [Gemini Live SDK](https://ai.google.dev/gemini-api/docs/live-api/get-started-sdk), [Gemini 3.8 Live](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live), [Live Tools](https://ai.google.dev/gemini-api/docs/live-api/tools), and [AnalyserNode](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode).



Isolated local benchmarking used 5,000 synthetic 40 ms PCM chunks per variant against the same mocked provider. Median per-send time: 14.90 µs without serialization, 16.60 µs with the uncontended lock. 95th percentile: 20.90 µs and 23.40 µs, respectively. This benchmark excludes network latency, contention during situation changes, and audio playback.



### Greeting, mood, and Bio-Sync guide



- Open the console and then **Companion** to see "How are you, how are you feeling today?". The written prompt is tagged as an AEGIS prompt until a greeting transcript exists. **Start voice** requests browser microphone access and triggers the spoken greeting once per logical voice session. Automatic reconnections reuse that session identifier.

- In **Psychological Wellness**, select one of the five bubbles and click **Save mood**. Energy, stress, and notes are optional. Notes accept up to 600 characters. History displays the manual log ID, which you can reference to ask Companion to edit or delete the entry. AEGIS prompts do not automatically create entries.

- Activate **Panic Crisis**. The orb expands forward for 5 s and contracts back for 5 s. You can pause, resume, or hide the guide. With reduced motion enabled, the guide displays both phases statically.

- With voice active, select each situation and verify whether Gemini begins with "Anomaly detected." The bar displays the intended narrative even when voice is disconnected. Any mention of a tower refers to the simulation. **Restore Nominal** closes the visual narrative, stops the guide and ambient audio, and cancels pending context. AEGIS is a synthetic-data demonstration.



### Earth–Mars monitor and wellness visualizations



The demo's orbital geometry fixes separation at 377.74 million km. FastAPI divides that distance by 299,792.458 km/s and rounds to the nearest second (21 min 00 s, one-way). Scenarios alter the fictional link status and the **AEGIS AUTONOMOUS OVERRIDE** badge. The reference distance remains fixed. [Speed of light constant, NIST](https://physics.nist.gov/cuu/Constants/Value/c.html).



The Companion orb samples the active microphone stream locally and smooths the RMS amplitude. The analyzer output remains disconnected. AEGIS neither stores nor transmits this index. The constellation plots self-logs with manual IDs and places omitted optional scores under "No data". Hover over or focus a star to inspect its details, and activate the star with Enter or Space to open the full detail view. The accessible list provides the same information.



### Narration and turn diagnostics



The WebSocket tags audio chunks with session, turn, scenario, and sequence metadata. Any snapshot from an older or identical version is discarded before canceling audio. When replacing an active narrative, the bridge waits for the canceled turn to finish before attributing audio to the next turn. Generation completion is tracked separately from turn completion and local playback. A provider close notice drains already-received audio before reconnecting, and tool responses do not restart playback.



Narrative bursts are admitted gradually into the original queue to avoid triggering its latency-drop rule. Pre-buffering is capped at 90 s and raises an error if exceeded. The orb reads amplitude against the playback clock during output and uses the passive analyzer while listening. Browser echo cancellation remains enabled. During narrative output, only low-amplitude residual input is attenuated, while Gemini barge-in events and the **Stop voice** button remain fully honored.



**Audio diagnostics** displays pending duration, last turn event, abbreviated identifiers, and interruption and reconnection counts. None of these fields contain audio or transcripts. To test echo cancellation and barge-in on local hardware, start voice, trigger Bio-Sync with audible speaker output, and let the turn complete. Repeat while speaking over the narrative and verify that playback interrupts cleanly. Then switch scenarios and return to nominal to confirm that only prior audio is canceled.



## Deploy the demo to GitHub and Render from PowerShell



The [Render Blueprint](render.yaml) provisions **one Free Docker Web Service**, with no database or paid disk. The [Dockerfile](Dockerfile) builds Vite using the lockfile and copies the output into the FastAPI image. The server listens on `0.0.0.0:$PORT` (local fallback: `10000`). In production, the UI, API, and voice share a single domain: `/api/…` for HTTP and `wss://<your-domain>/api/live` for Gemini Live. The server preserves Uvicorn's ping, and the browser uses existing reconnection logic. [Web Services](https://render.com/docs/web-services) · [Docker](https://render.com/docs/docker) · [WebSockets](https://render.com/docs/websocket).



### 1. Prepare and verify the local project



From the root directory, with Python 3.14, Node.js 22, and Git installed:



```powershell

py -3.14 -m venv .venv

.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

if (-not (Test-Path backend\.env)) { Copy-Item backend\.env.example backend\.env }

Push-Location backend

..\.venv\Scripts\python.exe -m pytest -q

Pop-Location

npm.cmd --prefix frontend ci

npm.cmd --prefix frontend run test

npm.cmd --prefix frontend run build  # TypeScript and Vite

```



The dashboard and situations work without an API key. To enable Gemini locally, edit `backend/.env` on your machine and set `GEMINI_API_KEY`. This file is excluded from Git and Docker; process environment variables take precedence. Use standard development commands: from `backend`, run `..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8005`; in another terminal from the root directory, run `npm.cmd --prefix frontend run dev`. Open [Vite](http://127.0.0.1:5173/) and run `Invoke-RestMethod http://127.0.0.1:8005/api/health`.



To verify the FastAPI-served build **without the local key**, use a separate terminal. Assigning a space overrides the local `.env` file and is treated as an empty key:



```powershell

$env:GEMINI_API_KEY = ' '

$env:AEGIS_PUBLIC_DEMO = '1'

Set-Location backend

..\.venv\Scripts\python.exe -m app.serve

```



Open [the compiled build](http://localhost:10000/), test `/mission/dashboard`, and query `Invoke-RestMethod http://localhost:10000/api/health`. It should return `status: ok` and `geminiStatus: unconfigured`. `/api/does-not-exist` must return 404, not HTML. React handles navigation between modules directly from the dashboard. Close that terminal when finished. With Docker Desktop running, you can also execute `docker build -t aegis-biosystems .` and `docker run --rm -p 127.0.0.1:10000:10000 aegis-biosystems` from the root directory.



### 2. Push the code to a private GitHub repository



If your local copy already has an initial commit, check repository status and skip the initialization and commit commands. Before staging files, confirm that private paths appear in the output of `git check-ignore`. Before committing or pushing, verify that they do not appear in `git ls-files` or the staged index. Never manually stage recordings, real notes, or credentials.



```powershell

if (-not (Test-Path .git)) { git init -b main }

git status --short --untracked-files=all

git check-ignore -- backend/.env backend/data/wellness.sqlite3 .venv frontend/node_modules frontend/dist

git add -- .gitignore .gitattributes .dockerignore Dockerfile render.yaml README.md backend frontend

git diff --cached --name-only

git ls-files -- backend/.env backend/data .venv frontend/node_modules frontend/dist

git -c core.whitespace=-blank-at-eof diff --cached --check

git diff --cached --quiet

if ($LASTEXITCODE -eq 1) { git commit -m "Prepare AEGIS BioSystems for Render" }

git remote -v

```



- **Using GitHub CLI with no remote yet:** run `gh auth login` via browser if not already signed in, then run `gh repo create aegis-biosystems --private --source=. --remote=origin --push`. Verify with `gh repo view --json visibility,url` that visibility is `PRIVATE`.

- **Using the GitHub web interface:** on [New repository](https://github.com/new), create `aegis-biosystems`, select **Private**, and leave the repository empty (no README, license, or `.gitignore`). Copy its HTTPS URL and run `git remote add origin https://github.com/YOUR_USERNAME/aegis-biosystems.git` followed by `git push -u origin main`. Git Credential Manager may open a browser window to authenticate. If `origin` already exists, verify that it points to this private repository before pushing; do not overwrite it by default.



### 3. Create the Free service on Render



1. In the [Render Dashboard](https://dashboard.render.com/), connect GitHub and grant access to the private `aegis-biosystems` repository. Follow [Your First Render Deploy](https://render.com/docs/your-first-deploy) to link your account.

2. Select **New → Blueprint**, choose the repository and the `main` branch, and use the root `render.yaml`. Before applying, confirm that it will create **a single Web Service** with the **Docker** runtime, **Free** plan, `./Dockerfile`, and `/api/health` health check. [Blueprint Specification](https://render.com/docs/blueprint-spec).

3. To enable Companion, enter `GEMINI_API_KEY` when Render prompts for the secret (`sync: false`). To deploy without AI if the form requires a value, create **New → Web Service** with the same settings above without adding the variable. You can add it later under the service via **Environment → Add Environment Variable → Save and deploy**. Never add the key to the Dockerfile or the repository. `GEMINI_MODEL` and `GEMINI_LIVE_MODEL` are optional; `PORT` and `RENDER_EXTERNAL_URL` are provided automatically by Render. For a custom domain, add its exact HTTPS origin to `CORS_ORIGINS`. [Variables and Secrets](https://render.com/docs/configure-environment-variables) · [Render Environment Variables](https://render.com/docs/environment-variables).

4. Apply the Blueprint and monitor **Events** and **Logs** until the service reaches **Live**. The [health check](https://render.com/docs/health-checks) does not call Gemini: it checks server responsiveness and only reports whether a key is set. `configured` does not guarantee that the key is valid or has available quota.



### 4. Verify the deployed web app



1. Open your service's `onrender.com` HTTPS URL. Query `/api/health`; open the Dashboard, vital signs, sleep, and wellness modules; and reload a deep route such as `/mission/dashboard`. Verify that a nonexistent file under `/assets/` and an unknown route under `/api/` return 404.

2. With the API key configured, open Companion and send a test question. Next, click **Start voice**, grant microphone access, and ask another question. In **DevTools → Network → WS**, verify `wss://<your-domain>/api/live` with status `101`, and listen to the response. Trigger **Panic Crisis** and verify that "Anomaly detected" is spoken aloud in addition to appearing as text. Restore **Nominal** and test **Stop voice**.

3. Open a private/incognito window and verify that neither the synthetic notes nor the active situation from the first window appear. Do not use personal information during testing.



If the **build** fails, inspect the first error in Logs (lockfile, TypeScript compilation, or the Python build stage). If the **health check** fails, inspect `/api/health`, startup logs, and `PORT`. If the key shows as **unconfigured**, check the service's environment variable; if it shows as configured and Gemini returns an error, check model permissions, authentication, and quota. If **WebSocket** fails, check HTTPS/WSS, microphone permission, and exact origin matching (a `403` on connect typically indicates a rejected origin or missing session cookie; reload the page). A redeploy drops active connections, and the client retries a limited number of times; if retries are exhausted, click **Reconnect**. If reloading an SPA route returns a 404, verify that the build included `dist/index.html`. During a cold start, wait for the service to become responsive again before retrying voice.



**Privacy and limits.** The public demo uses an `HttpOnly` cookie to isolate visitor sessions, a temporary per-visitor SQLite database for wellness and activity logs, and in-memory per-visitor storage for scenarios. It does not use the local development database. Session state may be lost after one hour of visitor inactivity, or upon service restart, spin-down, or redeploy. Anyone sharing the same browser profile shares that visitor session; there are no user accounts or data recovery mechanisms. Use synthetic data only; text and microphone audio used with Companion are sent to Gemini to generate responses. Recordings and full conversations are not written to logs. Chat is rate-limited per visitor and per service; voice limits concurrent connections, request frequency, and session duration. These are demo guardrails, not an authentication system or a guarantee regarding Gemini quotas or billing.



**Render Free plan.** As of November 14, 2026, the [official documentation](https://render.com/docs/free) specifies spin-down after **15 minutes without inbound traffic**, a spin-up time of roughly one minute, **750 instance hours per month per workspace**, and potential restarts. Spin-down, restarts, or redeploys wipe changes to the local filesystem. Render also meters bandwidth and build minutes. This demo does not provision an external database: Free Postgres **expires after 30 days** and provides no backups, making it unsuitable for durable storage. If persistence is needed in the future, choose a dedicated database service and review its [official pricing](https://render.com/pricing) beforehand.
