# Voice Clone TTS — Full Stack (React + Node/Express + F5-TTS)

A full-stack voice cloning TTS app. Users upload a short reference audio clip,
enter text, and get speech generated in the cloned voice using F5-TTS (MIT license).

## Architecture

```
React (frontend)
   │  multipart: refAudio, refText, genText
   ▼
Node/Express (backend)  ──►  static audio serving /uploads
   │
   ▼
Python FastAPI (ai-service) ──► F5-TTS model (GPU/CPU)
```

## Folder structure

```
voice-clone-tts/
├── backend/        Node + Express (port 5000)
│   ├── server.js
│   ├── package.json
│   └── uploads/    (generated audio, auto-created)
├── ai-service/     Python FastAPI (port 8000)
│   ├── main.py
│   ├── requirements.txt
│   └── outputs/    (generated audio, auto-created)
├── frontend/       Vite + React (port 5173)
│   ├── src/App.jsx
│   ├── src/api.js
│   └── index.html
└── docker-compose.yml
```

## Local setup (dev mode)

### 1. AI service (Python)

Requires Python 3.10+. GPU strongly recommended (CUDA), CPU works but slow.

```bash
cd ai-service
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

First run downloads F5-TTS model weights (~1-2 GB) automatically.

### 2. Backend (Node)

```bash
cd backend
npm install
npm run dev        # runs on http://localhost:5000
```

### 3. Frontend (React)

```bash
cd frontend
npm install
npm run dev        # runs on http://localhost:5173
```

Open http://localhost:5173, upload a 10-30s clean voice clip,
enter its transcript (Ref Text), type what you want spoken, hit Generate.

## Docker (all services)

```bash
docker compose up --build
```

Requires the NVIDIA Container Toolkit for GPU support.
Without a GPU, the compose file automatically falls back to CPU
(slow but functional).

## Production notes

- Put a reverse proxy (nginx) in front; serve `/uploads` statically or via S3.
- Add auth + rate limiting before exposing publicly.
- Add a consent checkbox: only clone voices the user has rights to.
- For concurrent users, add a job queue (BullMQ/Redis) around the AI service.
