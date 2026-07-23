"""
Bundle hsk_vocab.csv / hsk_characters.csv / hsk_grammar.csv into one
hsk_data.json that the static site (index.html) loads client-side.

Run this once whenever you regenerate the CSVs (e.g. after re-running
extract_hsk_data.py against the full PDF):

    python csv_to_json.py

Produces hsk_data.json in the same folder. Re-run + commit + push to GitHub
whenever the underlying CSVs change -- GitHub Pages serves whatever's in the
repo, so there's no separate "deploy" step beyond a normal git push.
"""

import csv
import json
from pathlib import Path

OUT_DIR = Path(__file__).parent


def read_csv(path):
    p = OUT_DIR / path
    if not p.exists():
        print(f"  (skipping {path} -- not found)")
        return []
    with open(p, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def main():
    vocab = read_csv("hsk_vocab.csv")
    if not vocab:
        vocab = read_csv("hsk_vocab_level1.csv")
    characters = read_csv("hsk_characters.csv")
    if not characters:
        characters = read_csv("hsk_characters_level1.csv")
    grammar = read_csv("hsk_grammar.csv")
    if not grammar:
        grammar = read_csv("hsk_grammar_level1.csv")

    data = {"vocab": vocab, "characters": characters, "grammar": grammar}

    out_path = OUT_DIR / "hsk_data.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote {out_path}")
    print(f"  vocab: {len(vocab)} rows")
    print(f"  characters: {len(characters)} rows")
    print(f"  grammar: {len(grammar)} rows")


if __name__ == "__main__":
    main()
