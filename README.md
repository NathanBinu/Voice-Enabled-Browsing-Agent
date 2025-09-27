# Voice-Enabled Browser Agent (MVP)

- STT + TTS: Deepgram (Aura voices for TTS)
- Intent Parsing: OpenRouter (`openai/gpt-oss-120b`)
- Execution: Browserbase + Playwright
- Client: Simple web page (record → run → hear TTS)

## Quickstart
1. `cp .env.example .env` and fill keys
2. `npm install`
3. `npm run dev`
4. open `http://localhost:3000/`
