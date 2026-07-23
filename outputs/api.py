"""
HTTP API wrapper around hsk_lookup.py (optional -- only needed if you still
want a Coze-style plugin backend instead of, or alongside, the static
GitHub Pages site).

Run locally:
    pip install fastapi uvicorn
    uvicorn api:app --host 0.0.0.0 --port 8000

Test:
    curl "http://127.0.0.1:8000/lookup?query=苹果"
"""

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from hsk_lookup import HSKLookup

app = FastAPI(
    title="HSK Level Lookup",
    description="Look up the HSK proficiency level for a Chinese word or character.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

hsk = HSKLookup("hsk_vocab.csv", "hsk_characters.csv")


@app.get("/lookup")
def lookup(query: str = Query(..., description="A Chinese word or single character, e.g. 苹果 or 爱")):
    return hsk.lookup(query)


@app.get("/health")
def health():
    return {"status": "ok", "vocab_words_loaded": len(hsk.vocab_by_word), "characters_loaded": len(hsk.char_levels)}
