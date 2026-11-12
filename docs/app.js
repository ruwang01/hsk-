import { createSegmenter } from './segment.js';
import { connectVocabulary } from './vocabulary.js';
import { readDocument, PREVIEW_CHARS } from './documents.js';
import { renderLevelStatistics } from './statistics.js';

const $ = id => document.getElementById(id);
const vocabulary = connectVocabulary(levelText, badge);
const input = $('input');
const reading = $('reading');
const EXAMPLE = '昨天，我和朋友一起去图书馆。我们准备了一些资料，打算讨论一个有趣的问题。\n\n下午突然下雨了，我们决定留下来继续学习。';
let levels;
let segment;
let segmentLoading;
let tokens = [];
let analyzedText = '';
let selectedButton = null;
let uploadedDocument = null;
let documentReader = null;
let analysisRequest = 0;
let analyzing = false;

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


function currentText() {
  return uploadedDocument?.text ?? input.value;
}

function showDocumentStatus(message, error = false) {
  const status = $('document-status');
  status.textContent = message;
  status.classList.toggle('error', error);
}

function removeDocument() {
  documentReader?.abort();
  documentReader = null;
  uploadedDocument = null;
  input.readOnly = false;
  $('document-file').value = '';
  showDocumentStatus('');
}

async function uploadDocument(file) {
  if (!file) return;
  documentReader?.abort();
  const controller = new AbortController();
  documentReader = controller;
  updateInput();
  showDocumentStatus(`正在读取 ${file.name}…`);
  try {
    const result = await readDocument(file, message => {
      if (documentReader === controller) showDocumentStatus(message);
    }, controller.signal);
    if (documentReader !== controller) return;
    uploadedDocument = { ...result, name: file.name };
    input.value = result.text.slice(0, PREVIEW_CHARS);
    input.readOnly = true;
    const note = result.note ? ` · ${result.note}` : '';
    showDocumentStatus(`${file.name}${note}`);
    documentReader = null;
    await analyze();
  } catch (error) {
    if (documentReader !== controller) return;
    const current = uploadedDocument ? ` 当前仍为 ${uploadedDocument.name}。` : '';
    showDocumentStatus(error.message + current, true);
  } finally {
    if (documentReader === controller) documentReader = null;
    updateInput();
  }
}

function updateInput() {
  const text = currentText();
  const size = text.length.toLocaleString('zh-CN');
  $('characters').textContent = uploadedDocument ? `全文 ${size} 字符` : `${size} / 12,000 字符`;
  $('analyze').disabled = !levels || !text.trim() || Boolean(documentReader) || analyzing;
  if (tokens.length && text !== analyzedText) {
    clearResult('原文已修改，请重新分词');
  }
}

function clearResult(message = '分级结果将在这里显示') {
  tokens = [];
  vocabulary.setAnalysis([]);
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
  renderLevelStatistics();
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
  const text = currentText();
  if (!levels || !text.trim() || documentReader) return;
  const request = ++analysisRequest;
  clearResult('正在分词…');
  analyzing = true;
  updateInput();
  try {
    const cut = await getSegmenter();
    await new Promise(resolve => setTimeout(resolve, 0));
    if (request !== analysisRequest || currentText() !== text) return;
    const result = cut(text);
    if (result.map(token => token.text).join('') !== text) throw new Error('分词结果校验失败');
    tokens = result;
    analyzedText = text;
    renderTokens();
  } catch {
    if (request === analysisRequest && currentText() === text) clearResult('分词失败，请重试。');
  } finally {
    if (request === analysisRequest) analyzing = false;
    updateInput();
  }
}

function renderTokens() {
  const fragment = document.createDocumentFragment();
  const counts = new Map();
  const words = new Map();
  let total = 0;
  for (const token of tokens) {
    const preview = token.start < PREVIEW_CHARS;
    if (!token.isWord) {
      if (preview) fragment.append(document.createTextNode(token.text));
      continue;
    }
    if (preview) {
      const button = node('button', `token level-${token.level ?? 'unknown'}`, token.text);
      button.type = 'button';
      button.setAttribute('aria-label', `${token.text}，${levelText(token.level)}`);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => selectToken(button, token));
      fragment.append(button);
    }
    counts.set(token.level, (counts.get(token.level) ?? 0) + 1);
    const previous = words.get(token.text);
    if (previous) {
      previous.count++;
    } else {
      words.set(token.text, { word: token.text, level: token.level, count: 1 });
    }
    total++;
  }
  reading.replaceChildren(fragment);
  reading.scrollTop = 0;
  renderLegend(counts);
  renderLevelStatistics(counts, total, analyzedText.length > PREVIEW_CHARS);
  $('summary').textContent = `共 ${total} 个词 · ${total - (counts.get(null) ?? 0)} 个有等级`;
  $('copy').disabled = false;
  vocabulary.setAnalysis([...words.values()]);
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
  for (const tab of ['analysis', 'lookup', 'vocabulary']) {
    const active = name === tab;
    $(`${tab}-view`).hidden = !active;
    $(`${tab}-tab`).classList.toggle('active', active);
    $(`${tab}-tab`).setAttribute('aria-pressed', String(active));
  }
  if (name === 'lookup') $('word').focus();
}

$('analysis-tab').addEventListener('click', () => view('analysis'));
$('lookup-tab').addEventListener('click', () => view('lookup'));
$('vocabulary-tab').addEventListener('click', () => view('vocabulary'));
input.addEventListener('input', updateInput);
$('document-file').addEventListener('change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  return uploadDocument(file);
});
$('analyze').addEventListener('click', analyze);
$('example').addEventListener('click', () => {
  removeDocument();
  input.value = EXAMPLE;
  updateInput();
  analyze();
});
$('clear').addEventListener('click', () => {
  removeDocument();
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
  $('document-file').disabled = false;
  vocabulary.setDictionary(levels);
  updateInput();
} catch {
  $('source-count').textContent = '词表加载失败';
  $('vocabulary-count').textContent = '词表加载失败，请刷新网页。';
  clearResult('词表加载失败，请刷新网页');
}
