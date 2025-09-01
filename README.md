# Classense – Next.js P2P Calls (REST Signaling)

A minimal Next.js demo that creates peer‑to‑peer video calls using WebRTC with only REST API routes for signaling (no Socket.IO). It includes a simple mock login (teacher + students) and an optional on‑device emotion analysis overlay via MediaPipe Holistic.

## Prerequisites

- Node.js 18+ (LTS recommended)
- Yarn or npm
- ngrok (for HTTPS tunneling during development)

## Install

```
# install dependencies
yarn
# or
npm install
```

## Run (development)

```
yarn dev
# or
npm run dev
```

Open http://localhost:3000

Notes in dev:
- getUserMedia works on http://localhost and on HTTPS origins. For remote devices, use ngrok (below).
- When using ngrok in dev, you may see WebSocket HMR warnings in the console; they are harmless. If you prefer a clean console, run in production mode.

## Run (production)

```
yarn build && yarn start -p 3000
# or
npm run build && npm run start -- -p 3000
```

Open http://localhost:3000

## Expose HTTPS with ngrok

Use ngrok to securely expose your local `http://localhost:3000` to the internet over HTTPS so remote devices can access the app and browser APIs (camera/mic) work.

### 1) Install ngrok

- Official downloads and OS‑specific instructions: https://ngrok.com/download
- macOS (Homebrew): `brew install ngrok`
- Windows (winget): `winget install --id Ngrok.Ngrok -e`
- Linux (Debian/Ubuntu via APT) – see the official page above for the most up‑to‑date repository instructions.

### 2) Create an account and get your Authtoken

- Sign up / sign in: https://dashboard.ngrok.com/
- Get your Authtoken from: https://dashboard.ngrok.com/get-started/your-authtoken

### 3) Add your Authtoken locally

Run this once on your machine (copies your token into the ngrok config):

```
ngrok config add-authtoken <YOUR_AUTHTOKEN>
```

### 4) Start this app on port 3000

In one terminal:

```
yarn dev
# or
npm run dev
```

### 5) Start the ngrok tunnel to port 3000

In a second terminal:

```
ngrok http 3000
# or (explicit target)
ngrok http http://localhost:3000
```

ngrok will display a forwarding URL like `https://<subdomain>.ngrok-free.app`. Open that URL on both teacher and student devices.

Tips
- Dev HMR noise: You may see `_next/webpack-hmr` WebSocket warnings through ngrok; these are harmless. For a cleaner console, run in production (`yarn build && yarn start -p 3000`) and then start `ngrok http 3000`.
- Stop tunnel: Press Ctrl+C in the ngrok terminal.

## TURN (recommended for cross‑network)

Some NATs (LTE/CGNAT, corporate) require a TURN relay. Configure via env vars in `.env.local`:

```
NEXT_PUBLIC_TURN_URL=turn:your.turn.server:3478
NEXT_PUBLIC_TURN_USERNAME=yourUser
NEXT_PUBLIC_TURN_CREDENTIAL=yourSecret
```

Then restart the app. Multiple URLs can be comma‑separated.

### Metered.ca (username/password)

- In your Metered dashboard, copy the TURN server host (hostname + ports) and your username/password.
- Add multiple URLs for better coverage, for example:

```
# Replace YOUR_TURN_HOST with the host provided by Metered
# For strict NATs, include UDP+TCP+TLS and common ports:
NEXT_PUBLIC_TURN_URL=\
  turn:YOUR_TURN_HOST:3478?transport=udp,\
  turn:YOUR_TURN_HOST:3478?transport=tcp,\
  turn:YOUR_TURN_HOST:80?transport=tcp,\
  turns:YOUR_TURN_HOST:443?transport=tcp,\
  turns:YOUR_TURN_HOST:5349?transport=tcp
NEXT_PUBLIC_TURN_USERNAME=<YOUR_METERED_USERNAME>
NEXT_PUBLIC_TURN_CREDENTIAL=<YOUR_METERED_PASSWORD>
```

Note: The call UI reads these envs on the client. See `pages/call/[roomId].tsx:50` where `NEXT_PUBLIC_TURN_URL`, `NEXT_PUBLIC_TURN_USERNAME`, and `NEXT_PUBLIC_TURN_CREDENTIAL` are used to build the `RTCPeerConnection` ICE config.

To force using TURN only (útil en redes estrictas o CGNAT):

```
NEXT_PUBLIC_FORCE_TURN=1
```

### Vercel deployment notes

For reliable signaling on Vercel, enable a persistent store:

- Provision Vercel KV (or Upstash Redis) and set:
  - `KV_REST_API_URL`
  - `KV_REST_API_TOKEN`

This repo auto‑detects those env vars and switches the signaling store to Redis.

On Vercel, set the same TURN envs in Project Settings → Environment Variables:

- `NEXT_PUBLIC_TURN_URL`
- `NEXT_PUBLIC_TURN_USERNAME`
- `NEXT_PUBLIC_TURN_CREDENTIAL`
- (optional) `NEXT_PUBLIC_FORCE_TURN` set to `1` para obligar a TURN
- (optional) `KV_REST_API_URL`, `KV_REST_API_TOKEN`

Notas de compatibilidad NAT
- Incluir `turns:...:443?transport=tcp` y `turn:...:80?transport=tcp` ayuda cuando UDP está bloqueado.
- Mantén también `turn:...:3478?transport=udp` para redes abiertas (menor latencia).
- Si aún falla, activa `NEXT_PUBLIC_FORCE_TURN=1` (relay‑only) y vuelve a probar.

When deploying, ensure these envs are added for “Production” (and “Preview” if you use preview deployments). Rebuild after any changes to envs.

## Demo Login and Call Flow

- Navigate to `/`.
- Use the mock users (no passwords):
  - Teacher: `teacher@math101`
  - Students: `student1@math101`, `student2@math101`, etc.
- Teacher creates a room and is redirected to `/call/<ROOM_ID>` with a copy link button.
- Students must log in, then open the teacher’s URL (or paste the room ID on the home page). The call connects automatically—no extra clicks.

## Emotion Analysis (optional)

- On the call page you can start/stop emotion analysis (runs on device via MediaPipe Holistic).
- The app loads MediaPipe from a public CDN to work reliably behind ngrok/HTTPS.

## Troubleshooting

- Camera permission prompt never appears
  - Ensure you are on HTTPS (ngrok) or `http://localhost`.
  - Check browser site permissions; if previously denied, re‑enable camera/mic.
- One tab cannot access camera while another is using it (same device)
  - The student tab falls back to microphone‑only or receive‑only so you can still connect.
- Call does not connect across networks
  - Add a TURN server via `.env.local` (see above).
- Repeated HMR/WebSocket warnings over ngrok
  - Use production mode: `yarn build && yarn start`, then `ngrok http 3000`.
- “Failed to join room” after dev reload
  - The signaling store is persisted across hot reloads, but if you restarted the server, log in again and recreate the room.

## Project Structure (key files)

- `pages/index.tsx` – login + teacher/student dashboard
- `pages/call/[roomId].tsx` – call UI and WebRTC logic (auto‑connect)
- `pages/api/rooms` – REST signaling routes (create/list/join/signal)
- `pages/api/login.ts` – mock login endpoint
- `lib/signalingStore.ts` – in‑memory signaling (persisted on `globalThis` for dev)
- `hooks/useEmotionAnalysis.ts` – optional Holistic‑based analysis (CDN fallback)

## Scripts

- `yarn dev` – run in development
- `yarn build` – build
- `yarn start` – run production server

---

This project is intended for demo/learning. For production: use a proper auth system, a persistent signaling store (DB/Redis), and a managed TURN service.
