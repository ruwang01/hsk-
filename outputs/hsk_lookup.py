"""
HSK proficiency-level lookup.

Loads hsk_vocab.csv / hsk_characters.csv / hsk_grammar.csv (produced by
extract_hsk_data.py) and answers: "what level is this word/character?"

Usage (CLI demo):
    python hsk_lookup.py 爱
    python hsk_lookup.py 本

Usage (as a module):
    from hsk_lookup import HSKLookup
    hsk = HSKLookup("hsk_vocab.csv", "hsk_characters.csv")
    hsk.lookup("苹果")
    # -> {"query": "苹果", "type": "word",
    #     "matches": [{"word": "苹果", "level": "1", "pinyin": "píngguǒ", "pos": "名"}]}
"""

import csv
import re
import sys
from collections import defaultdict
from pathlib import Path


def _strip_homograph_suffix(s: str) -> str:
    """'本1' -> '本' (numeric homograph markers used in the syllabus)."""
    return re.sub(r"\d+$", "", s)


class HSKLookup:
    def __init__(self, vocab_csv="hsk_vocab.csv", characters_csv="hsk_characters.csv"):
        self.vocab_by_word = defaultdict(list)   # normalized word -> [rows]
        self.char_levels = defaultdict(list)     # char -> [(level, type)]

        vocab_path = Path(vocab_csv)
        if vocab_path.exists():
            with open(vocab_path, encoding="utf-8-sig") as f:
                for row in csv.DictReader(f):
                    word_raw = row["词语"]
                    word = _strip_homograph_suffix(word_raw)
                    self.vocab_by_word[word].append({
                        "word": word_raw,
                        "level": row["等级"],
                        "pinyin": row["拼音"],
                        "pos": row["词性"],
                    })

        char_path = Path(characters_csv)
        if char_path.exists():
            with open(char_path, encoding="utf-8-sig") as f:
                for row in csv.DictReader(f):
                    self.char_levels[row["汉字"]].append((row["级别"], row["类型"]))

    def lookup(self, query: str) -> dict:
        query = query.strip()
        result = {"query": query, "matches": []}

        # 1) exact word match (vocab list)
        if query in self.vocab_by_word:
            result["type"] = "word"
            result["matches"] = self.vocab_by_word[query]
            return result

        # 2) single character -> character syllabus levels
        if len(query) == 1 and query in self.char_levels:
            result["type"] = "character"
            result["matches"] = [
                {"character": query, "level": lvl, "category": typ}
                for lvl, typ in self.char_levels[query]
            ]
            return result

        # 3) fallback: multi-character query not found as a word -> report
        #    per-character levels so the user still gets useful info.
        if len(query) > 1:
            char_hits = []
            for ch in query:
                if ch in self.char_levels:
                    char_hits.append({
                        "character": ch,
                        "matches": [{"level": lvl, "category": typ} for lvl, typ in self.char_levels[ch]],
                    })
            if char_hits:
                result["type"] = "character_breakdown"
                result["matches"] = char_hits
                return result

        result["type"] = "not_found"
        return result


def main():
    if len(sys.argv) < 2:
        print("Usage: python hsk_lookup.py <word_or_character>")
        sys.exit(1)
    hsk = HSKLookup()
    for q in sys.argv[1:]:
        print(hsk.lookup(q))


if __name__ == "__main__":
    main()
