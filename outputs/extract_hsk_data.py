"""
Extract HSK 3.0 syllabus data (vocab, characters, grammar) from the official
PDF into clean CSVs, with the "汉考国际" watermark stripped out.

Run in PyCharm:
    pip install pdfplumber
    python extract_hsk_data.py "/path/to/新版HSK考试大纲（词汇、汉字、语法）（12.25）.pdf"

Produces (in the same folder as this script):
    hsk_vocab.csv        -> 序号, 等级, 词语, 拼音, 词性
    hsk_characters.csv   -> 汉字, 级别, 类型   (类型 = 认读字 / 书写字)
    hsk_grammar.csv       -> 级别, 类别, 类别名称, 细目, 语法内容

Notes on source structure (confirmed from the actual PDF):
- 词汇大纲 runs roughly pp.1-276 of the document body, one continuous table
  (序号 / 等级 / 词语 / 拼音 / 词性) split across pages, each page repeating a
  "序号 等级 词语 拼音 词性" header and stamped with a "汉考国际" watermark
  (sometimes garbled, e.g. "际 汉考国际").
- 等级 is a plain integer 1-6, or "7-9" for the combined upper band, and
  sometimes carries a parenthetical secondary level, e.g. "1（4）" (primary
  level 1, word reappears with an expanded meaning/POS at level 4).
- 词性 can have a parenthetical alternate POS, e.g. "形、（副）", and can be
  blank (no POS given).
- Some 词语 entries carry a numeric homograph suffix, e.g. "本1"/"本2",
  distinguishing otherwise-identical words with different meanings/readings.
- 汉字大纲 (pp.~277-306) lists 认读字 (recognition characters) per single
  level 1-9, then 书写字 (writing characters) in level BANDS, e.g.
  "HSK（一级）~（二级）书写字", "HSK（三级）书写字", ... "HSK（七—九级）书写字".
  Both are simple numbered lists ("1.爱 2.八 3.爸 ...").
- 语法大纲 (pp.~307-328) is one table per level with columns
  类别 / 类别名称 / 细目 / 语法内容, where 类别/类别名称/细目 are often only
  filled on the first row of a group (merged cells) and blank on subsequent
  rows -- the parser below forward-fills those.
"""

import re
import sys
import csv
from pathlib import Path

import pdfplumber

# The watermark is stamped diagonally across the page as the 4 characters of
# "汉考国际", and pdfplumber's reading-order text extraction interleaves these
# stray characters into the real table content -- sometimes as their own
# isolated token/line, sometimes glued with NO space onto the front of the
# next real token (e.g. "国27" instead of "27", "际吧" instead of "吧").
# Critically, 汉 and 国 are ALSO real, legitimate vocabulary/characters
# (汉语, 汉字, 国, 国际, ...), so we can't blindly delete every occurrence --
# see _maybe_strip_fused_prefix() below for how word-slot tokens are handled.
WATERMARK_CHARS = "汉考国际"
# First pinyin letter for each watermark character's own reading -- used to
# tell "祝 is real word text" apart from "祝 is watermark glued onto a word".
WATERMARK_INITIAL = {"汉": "h", "考": "k", "国": "g", "际": "j"}


def _strip_leading_watermark(tok: str) -> str:
    return re.sub(f"^[{WATERMARK_CHARS}]+", "", tok)


def _looks_like_pinyin(tok: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-zÀ-ɏ'’]+", tok))


def clean_line(line: str) -> str:
    """Drop lines that are pure watermark noise or bare page numbers."""
    line = line.strip()
    if not line:
        return ""
    compact = line.replace(" ", "")
    # Lines made up entirely of watermark characters, e.g. "际", "国 考 汉".
    if compact and all(ch in WATERMARK_CHARS for ch in compact):
        return ""
    if re.fullmatch(r"\d{1,4}", line):
        return ""
    return line


def extract_all_text(pdf_path: str):
    """Return list of (page_number, cleaned_text) for every page."""
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            raw = page.extract_text() or ""
            cleaned_lines = [clean_line(l) for l in raw.split("\n")]
            cleaned = "\n".join(l for l in cleaned_lines if l)
            pages.append((i, cleaned))
    return pages


# ---------------------------------------------------------------------------
# 词汇大纲 (vocabulary)
# ---------------------------------------------------------------------------
def _resolve_word(word_raw: str, pinyin: str) -> str:
    """
    Decide whether a leading watermark-set character on the WORD token is
    real (汉语, 汉字, 国, 国际, ...) or a fused watermark stamp (际吧 -> 吧).
    We cross-check against the word's own pinyin: if the first pinyin letter
    doesn't match the expected initial for that leading character's real
    reading, the leading character isn't part of the word -- strip it.
    """
    if not word_raw:
        return word_raw
    first = word_raw[0]
    if first in WATERMARK_CHARS and len(word_raw) > 1:
        expected_initial = WATERMARK_INITIAL[first]
        actual_initial = pinyin[:1].lower() if pinyin else ""
        if actual_initial != expected_initial:
            return word_raw[1:]
    return word_raw


def parse_vocab(pages, start_page, end_page):
    """
    Parse the vocabulary table using the fact that 序号 is a strictly
    increasing sequence starting at 1 -- this lets us re-segment the raw
    token stream even though pdfplumber flattens the table into text and
    the "汉考国际" watermark scatters stray characters through it (as
    isolated tokens, AND fused with no space onto the front of real tokens,
    e.g. "国27" for "27", "际吧" for "吧"). Every slot below strips a leading
    watermark run before validating the token against its expected shape.
    """
    text = "\n".join(t for p, t in pages if start_page <= p <= end_page)
    # Drop repeated column headers.
    text = re.sub(r"序号\s*等级\s*词语\s*拼音\s*词性", " ", text)
    tokens = text.split()

    rows = []
    i = 0
    expected_no = 1
    n = len(tokens)
    while i < n:
        tok = _strip_leading_watermark(tokens[i])
        if tok.isdigit() and int(tok) == expected_no:
            no = expected_no
            j = i + 1
            if j >= n:
                break
            level = _strip_leading_watermark(tokens[j])
            j += 1
            if j >= n:
                break
            word_raw = tokens[j]
            j += 1
            if j >= n:
                break
            # Pinyin can span more than one whitespace-delimited token for
            # verb-object phrases, e.g. "打电话" -> "dǎ diànhuà", "不客气" ->
            # "bú kèqi" -- keep consuming pure-Latin tokens as pinyin.
            pinyin_parts = [tokens[j]]
            j += 1
            while j < n and _looks_like_pinyin(tokens[j]):
                pinyin_parts.append(tokens[j])
                j += 1
            pinyin = _strip_leading_watermark(" ".join(pinyin_parts))

            word = _resolve_word(word_raw, pinyin)

            pos_parts = []
            # Consume tokens until the next one looks like the next serial number.
            # 词性 values never legitimately start with a watermark character,
            # so it's always safe to strip a leading run here (this also drops
            # tokens that were purely watermark noise, e.g. a lone "汉").
            while j < n:
                candidate = _strip_leading_watermark(tokens[j])
                if candidate.isdigit() and int(candidate) == expected_no + 1:
                    break
                cleaned_tok = _strip_leading_watermark(tokens[j])
                if cleaned_tok:
                    pos_parts.append(cleaned_tok)
                j += 1
            pos = " ".join(pos_parts)
            # A watermark character wedged between two halves of what was
            # originally one 、-joined POS token leaves a stray space, e.g.
            # "名 、动" instead of "名、动" -- normalize that back out.
            pos = re.sub(r"\s*、\s*", "、", pos)
            rows.append((no, level, word, pinyin, pos))
            expected_no += 1
            i = j
        else:
            i += 1
    return rows


# ---------------------------------------------------------------------------
# 汉字大纲 (characters)
# ---------------------------------------------------------------------------
CHAR_LIST_RE = re.compile(r"\d+\.\s*([一-鿿])")

LEVEL_HEADER_RE = re.compile(
    r"HSK[（(]([一二三四五六七八九—\d]+级)[）)](?:[~～][（(]([一二三四五六七八九—\d]+级)[）)])?\s*(认读字|书写字)"
)

CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def cn_level_to_label(s: str) -> str:
    if "—" in s or "-" in s:
        return "7-9"
    for cn, n in CN_NUM.items():
        s = s.replace(cn, str(n))
    return s.replace("级", "")


def parse_characters(pages, start_page, end_page):
    text = "\n".join(t for p, t in pages if start_page <= p <= end_page)
    rows = []
    # Split on level headers, keep the header with each following chunk.
    parts = LEVEL_HEADER_RE.split(text)
    # parts alternates: [pre-text, lvl1, lvl2(or None), type, chunk, lvl1, lvl2, type, chunk, ...]
    it = iter(parts[1:])
    for lvl1, lvl2, ctype, chunk in zip(it, it, it, it):
        chars = CHAR_LIST_RE.findall(chunk)
        levels = [cn_level_to_label(lvl1)]
        if lvl2:
            levels.append(cn_level_to_label(lvl2))
        # If it's a band (lvl1..lvl2), tag with the band string instead of expanding.
        level_label = "-".join(levels) if len(levels) > 1 else levels[0]
        for ch in chars:
            rows.append((ch, level_label, ctype))
    return rows


# ---------------------------------------------------------------------------
# 语法大纲 (grammar)
# ---------------------------------------------------------------------------
GRAMMAR_LEVEL_HEADER_RE = re.compile(r"HSK[（(]([一二三四五六七八九—\d]+级)[）)]\s*语法")


def parse_grammar(pages, start_page, end_page):
    """
    Best-effort grammar table parser. Grammar cells are long free-text and
    merged across rows, so this keeps 类别/类别名称/细目 forward-filled from
    the last non-empty value seen, and treats each remaining line as a
    语法内容 entry under the current 细目. Expect to hand-review the output --
    the source table's merged cells don't always survive text extraction
    cleanly.
    """
    text = "\n".join(t for p, t in pages if start_page <= p <= end_page)
    chunks = GRAMMAR_LEVEL_HEADER_RE.split(text)
    rows = []
    it = iter(chunks[1:])
    for lvl, chunk in zip(it, it):
        level_label = cn_level_to_label(lvl)
        cat = subcat = item = ""
        for line in chunk.split("\n"):
            line = line.strip()
            if not line or line.startswith("类别"):
                continue
            cols = re.split(r"\s{2,}|\t", line)
            cols = [c for c in cols if c]
            if not cols:
                continue
            # Heuristic: a full row has 4 columns; partial rows have fewer,
            # meaning earlier columns repeat the previous row's value.
            if len(cols) >= 4:
                cat, subcat, item, content = cols[0], cols[1], cols[2], " ".join(cols[3:])
            elif len(cols) == 3:
                subcat, item, content = cols[0], cols[1], cols[2]
            elif len(cols) == 2:
                item, content = cols[0], cols[1]
            else:
                content = cols[0]
            rows.append((level_label, cat, subcat, item, content))
    return rows


def write_csv(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f"Wrote {len(rows)} rows -> {path}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python extract_hsk_data.py <path-to-pdf>")
        sys.exit(1)

    pdf_path = sys.argv[1]
    out_dir = Path(__file__).parent

    print("Reading PDF (this can take a minute for ~330 pages)...")
    pages = extract_all_text(pdf_path)

    # NOTE: adjust these page ranges if your copy of the PDF has a different
    # cover/TOC length. Check the table of contents on page 2 first --
    # 词汇大纲 / 汉字大纲 / 语法大纲 page ranges are printed there.
    VOCAB_RANGE = (3, 276)
    CHAR_RANGE = (277, 306)
    GRAMMAR_RANGE = (307, 330)

    vocab_rows = parse_vocab(pages, *VOCAB_RANGE)
    write_csv(out_dir / "hsk_vocab.csv", ["序号", "等级", "词语", "拼音", "词性"], vocab_rows)

    char_rows = parse_characters(pages, *CHAR_RANGE)
    write_csv(out_dir / "hsk_characters.csv", ["汉字", "级别", "类型"], char_rows)

    grammar_rows = parse_grammar(pages, *GRAMMAR_RANGE)
    write_csv(out_dir / "hsk_grammar.csv", ["级别", "类别", "类别名称", "细目", "语法内容"], grammar_rows)

    print("\nDone. Spot-check counts against the PDF's table of contents,")
    print("then run hsk_lookup.py to sanity-check a few known words/characters.")


if __name__ == "__main__":
    main()
