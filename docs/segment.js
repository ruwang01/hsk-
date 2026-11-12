// Implements Jieba's weighted dictionary cut, HMM fallback, and the desktop
// tool's HSK dictionary merge. Keep separators so the annotated view is lossless.
const WORD = /[\p{L}\p{N}_]/u;
const HAN = /^[\u4e00-\u9fd5]+$/u;
const MIN_SCORE = -3.14e100;
const STATES = ['B', 'M', 'E', 'S'];
const PREVIOUS = { B: ['E', 'S'], M: ['M', 'B'], E: ['B', 'M'], S: ['S', 'E'] };

function hmmCut(text, model) {
  if (!HAN.test(text)) {
    return text.match(/[\u4e00-\u9fd5]+|[a-zA-Z0-9]+(?:\.\d+)?%?|[^]/gu)
      .flatMap(part => HAN.test(part) ? hmmCut(part, model) : [part]);
  }
  const backtrack = [];
  let scores = Object.fromEntries(STATES.map(state => [
    state, model.start[state] + (model.emit[state][text[0]] ?? MIN_SCORE),
  ]));
  for (let i = 1; i < text.length; i++) {
    const next = {};
    const step = {};
    for (const state of STATES) {
      const emission = model.emit[state][text[i]] ?? MIN_SCORE;
      const candidates = PREVIOUS[state];
      const score = prior => scores[prior] + (model.transition[prior][state] ?? MIN_SCORE) + emission;
      const [first, second] = candidates;
      const a = score(first);
      const b = score(second);
      const winner = a > b || (a === b && first > second) ? first : second;
      next[state] = winner === first ? a : b;
      step[state] = winner;
    }
    scores = next;
    backtrack.push(step);
  }
  const path = new Array(text.length);
  path[text.length - 1] = scores.E > scores.S ? 'E' : 'S';
  for (let i = text.length - 2; i >= 0; i--) path[i] = backtrack[i][path[i + 1]];

  const words = [];
  let start = 0;
  let consumed = 0;
  for (let i = 0; i < text.length; i++) {
    if (path[i] === 'B') start = i;
    if (path[i] === 'E') {
      words.push(text.slice(start, i + 1));
      consumed = i + 1;
    }
    if (path[i] === 'S') {
      words.push(text[i]);
      consumed = i + 1;
    }
  }
  if (consumed < text.length) words.push(text.slice(consumed));
  return words;
}

function dictionaryCut(block, frequencies, logTotal, model) {
  const scores = new Float64Array(block.length + 1);
  const ends = new Uint32Array(block.length);
  for (let i = block.length - 1; i >= 0; i--) {
    let best = -Infinity;
    let end = i + 1;
    for (let j = i + 1; j <= block.length; j++) {
      const frequency = frequencies.get(block.slice(i, j));
      if (frequency === undefined) break;
      if (frequency === 0) continue;
      const score = Math.log(frequency) - logTotal + scores[j];
      if (score >= best) {
        best = score;
        end = j;
      }
    }
    scores[i] = best === -Infinity ? scores[i + 1] - logTotal : best;
    ends[i] = end;
  }

  const words = [];
  let buffer = '';
  function flush() {
    if (buffer.length === 1) words.push(buffer);
    if (buffer.length > 1) {
      const parts = frequencies.get(buffer) ? buffer : hmmCut(buffer, model);
      for (const part of parts) words.push(part);
    }
    buffer = '';
  }
  for (let i = 0; i < block.length; i = ends[i]) {
    const word = block.slice(i, ends[i]);
    if (word.length === 1) {
      buffer += word;
    } else {
      flush();
      words.push(word);
    }
  }
  flush();
  return words;
}

export function createSegmenter(dictionary, model, levels) {
  const frequencies = new Map();
  let total = 0;
  function add(word, frequency) {
    frequencies.set(word, frequency);
    total += frequency;
    for (let length = 1; length < word.length; length++) {
      const prefix = word.slice(0, length);
      if (!frequencies.has(prefix)) frequencies.set(prefix, 0);
    }
  }
  for (const line of dictionary.split('\n')) {
    const separator = line.lastIndexOf(' ');
    add(line.slice(0, separator), Number(line.slice(separator + 1)));
  }
  const hskWords = [...levels.keys()].filter(word => /[\u4e00-\u9fff]/u.test(word));
  for (const word of hskWords) add(word, 1500 + 600 * [...word].length);
  const maxWordLength = Math.max(2, ...hskWords.map(word => word.length));
  const hskSet = new Set(hskWords);
  const logTotal = Math.log(total);

  return function segment(text) {
    const words = [];
    for (const match of text.matchAll(/[\u4e00-\u9fd5a-zA-Z0-9+#&._%\-]+|\r\n|[^]/gu)) {
      const block = match[0];
      if (/^[\u4e00-\u9fd5a-zA-Z0-9+#&._%\-]+$/u.test(block)) {
        for (const word of dictionaryCut(block, frequencies, logTotal, model)) words.push(word);
      } else {
        words.push(block);
      }
    }
    const tokens = [];
    let offset = 0;
    for (let i = 0; i < words.length;) {
      let word = words[i];
      let candidate = word;
      let end = i + 1;
      for (let j = i + 1; j < words.length; j++) {
        candidate += words[j];
        if (candidate.length > maxWordLength) break;
        if (hskSet.has(candidate)) {
          word = candidate;
          end = j + 1;
        }
      }
      tokens.push({ text: word, start: offset, end: offset + word.length,
        isWord: WORD.test(word), level: levels.get(word) ?? null });
      offset += word.length;
      i = end;
    }
    return tokens;
  };
}
