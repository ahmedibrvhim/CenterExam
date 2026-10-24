# CenterApp Exams

Upload a book (PDF) → choose pages / topic / question types / difficulty → the AI writes new questions → download several versions (A–F) and an answer key per version.

## Run
```bash
npm install
cp .env.example .env.local   # then put your GEMINI_API_KEY inside (free key: https://aistudio.google.com/apikey)
npm run dev                  # http://localhost:3000
```

## How it works
1. **Read**: pdf.js extracts the text of every page in the browser (the PDF is never uploaded).
2. **Chunk + retrieve**: the chosen page range is cut into chunks; with a topic they are ranked by BM25 keyword search (Arabic-aware), otherwise spread evenly.
3. **Generate (live)**: every 2 chunks go to `/api/generate`, which streams from Gemini. Each question is validated and shown on screen the moment it is written. Gemini's "thinking" is switched off to make it much faster.
4. **Limits**: when Google answers 429 the app reads *which* limit was hit. Per-minute -> countdown, then it resumes by itself. Per-day -> it stops, saves what it already wrote, and shows when the quota resets (midnight Pacific time). Google does not publish "requests left", so the counter on screen counts requests sent from this browser (approximate).
5. **Library (database)**: every exam is saved automatically in the browser's IndexedDB. Open it later to preview, delete bad questions, and print / download any version (A-F) or its answer key again. PDFs are rebuilt from the saved questions each time, so they always match.
6. **Versions**: same seed = same shuffle. Answers follow the shuffle, so each key is correct.

## Notes
- The library lives in *this browser on this computer*. It is not shared between devices, and clearing site data deletes it. For sharing between teachers/computers you need a server database (e.g. Supabase or SQLite).
- Scanned PDFs (images) have no text -> they need OCR first.
- Free tier: Google may use the text to improve its products and the free tier is meant for non-commercial use. Don't upload private books.
- If you deploy this publicly, protect `/api/generate` (login / rate limit).
- Change the model with `GEMINI_MODEL` in `.env.local`.
"# CenterExam" 
