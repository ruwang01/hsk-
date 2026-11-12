import { createSegmenter } from './segment.js';

const $ = id => document.getElementById(id);
const input = $('input');
const reading = $('reading');
const EXAMPLE = '昨天，我和朋友一起去图书馆。我们准备了一些资料，打算讨论一个有趣的问题。\n\n下午突然下雨了，我们决定留下来继续学习。';
let levels;
let segment;
let segmentLoading;
let tokens = [];
let analyzedText = '';
let selectedButton = null;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function levelText(level) {
  return level ? `HSK ${level} 级` : '未收录';
}

function badge(level, compact = false) {
  return node('span', `badge level-${level ?? 'unknown'}`,
    compact && level ? `${level} 级` : levelText(level));
}

function updateInput() {
  $('characters').textContent = `${input.value.length.toLocaleString('zh-CN')} / 12,000 字符`;
  $('analyze').disabled = !levels || !input.value.trim();
  if (tokens.length && input.value !== analyzedText) {
    clearResult('原文已修改，请重新分词');
  }
}

function clearResult(message = '分级结果将在这里显示') {
  tokens = [];
  analyzedText = '';
  const empty = node('div', 'empty');
  const mark = node('span', '', '文');
  mark.setAttribute('aria-hidden', 'true');
  empty.append(mark, node('p', '', message));
  reading.replaceChildren(empty);
  $('summary').textContent = '点击词语查看详情';
  $('copy').disabled = true;
  $('copy').textContent = '复制分词';
  $('selection').hidden = true;
  selectedButton = null;
  renderLegend();
}

function renderLegend(counts) {
  const legend = $('legend');
  legend.replaceChildren();
  for (const level of [1, 2, 3, 4, 5, 6, null]) {
    const item = badge(level, true);
    if (counts) item.textContent += ` · ${counts.get(level) ?? 0}`;
    legend.append(item);
  }
}

async function loadGzip(path, asJSON = false) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('读取分词数据失败');
  const unpacked = new Response(response.body.pipeThrough(new DecompressionStream('gzip')));
  return asJSON ? unpacked.json() : unpacked.text();
}

function getSegmenter() {
  if (segment) return Promise.resolve(segment);
  if (!segmentLoading) {
    segmentLoading = Promise.all([loadGzip('./jieba-dict.bin'), loadGzip('./jieba-hmm.bin', true)])
      .then(([dictionary, model]) => (segment = createSegmenter(dictionary, model, levels)))
      .catch(error => { segmentLoading = null; throw error; });
  }
  return segmentLoading;
}

async function analyze() {
  const text = input.value;
  if (!levels || !text.trim()) return;
  clearResult('正在分词…');
  $('analyze').disabled = true;
  try {
    const cut = await getSegmenter();
    if (input.value !== text) return;
    const result = cut(text);
    if (result.map(token => token.text).join('') !== text) throw new Error('分词结果校验失败');
    tokens = result;
    analyzedText = text;
    renderTokens();
  } catch {
    if (input.value === text) clearResult('分词数据加载失败，请重试');
  } finally {
    updateInput();
  }
}

function renderTokens() {
  const fragment = document.createDocumentFragment();
  const counts = new Map();
  let total = 0;
  for (const token of tokens) {
    if (!token.isWord) {
      fragment.append(document.createTextNode(token.text));
      continue;
    }
    const button = node('button', `token level-${token.level ?? 'unknown'}`, token.text);
    button.type = 'button';
    button.setAttribute('aria-label', `${token.text}，${levelText(token.level)}`);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => selectToken(button, token));
    fragment.append(button);
    counts.set(token.level, (counts.get(token.level) ?? 0) + 1);
    total++;
  }
  reading.replaceChildren(fragment);
  reading.scrollTop = 0;
  renderLegend(counts);
  $('summary').textContent = `共 ${total} 个词 · ${total - (counts.get(null) ?? 0)} 个有等级`;
  $('copy').disabled = false;
}

function selectToken(button, token) {
  selectedButton?.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-pressed', 'true');
  selectedButton = button;
  $('selected-word').textContent = token.text;
  $('selected-level').replaceChildren(badge(token.level));
  $('selection').hidden = false;
}

function view(name) {
  const isLookup = name === 'lookup';
  $('lookup-view').hidden = !isLookup;
  $('analysis-view').hidden = isLookup;
  for (const [id, active] of [['lookup-tab', isLookup], ['analysis-tab', !isLookup]]) {
    $(id).classList.toggle('active', active);
    $(id).setAttribute('aria-pressed', String(active));
  }
  if (isLookup) $('word').focus();
}

$('analysis-tab').addEventListener('click', () => view('analysis'));
$('lookup-tab').addEventListener('click', () => view('lookup'));
input.addEventListener('input', updateInput);
$('analyze').addEventListener('click', analyze);
$('example').addEventListener('click', () => {
  input.value = EXAMPLE;
  updateInput();
  analyze();
});
$('clear').addEventListener('click', () => {
  input.value = '';
  clearResult();
  updateInput();
  input.focus();
});
$('copy').addEventListener('click', async () => {
  const split = tokens.map((token, i) => (token.isWord && tokens[i - 1]?.isWord ? ' ' : '') + token.text).join('');
  try {
    await navigator.clipboard.writeText(split);
    $('copy').textContent = '已复制';
  } catch {
    $('copy').textContent = '复制失败';
  }
});
$('lookup-form').addEventListener('submit', event => {
  event.preventDefault();
  const word = $('word').value.trim();
  if (!levels || !word) return;
  const level = levels.get(word) ?? null;
  $('lookup-result').hidden = false;
  $('lookup-result').replaceChildren(node('strong', '', word), badge(level));
});

renderLegend();
try {
  const response = await fetch('./hsk.json');
  if (!response.ok) throw new Error('词表读取失败');
  const data = await response.json();
  levels = new Map(Object.entries(data).map(([word, entries]) => [word, entries[0]]));
  $('source-count').textContent = `1–6 级 · ${levels.size.toLocaleString('zh-CN')} 词`;
  $('lookup-submit').disabled = false;
  updateInput();
} catch {
  $('source-count').textContent = '词表加载失败';
  clearResult('词表加载失败，请刷新网页');
}
