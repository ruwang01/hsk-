const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_DOCUMENT_CHARS = 500_000;
export const PREVIEW_CHARS = 12_000;

function checkLength(length) {
  if (length > MAX_DOCUMENT_CHARS) throw new Error('文档文字超过 50 万字符，请拆分后重新上传。');
}

async function zipClass() {
  const { default: Zip } = await import('./vendor/jszip.min.js');
  return Zip ?? globalThis.JSZip;
}

function decodeText(data) {
  const bytes = new Uint8Array(data);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030', { fatal: true }).decode(bytes);
  }
}

async function readWord(data) {
  const Zip = await zipClass();
  const archive = await Zip.loadAsync(data);
  const part = archive.file('word/document.xml');
  if (!part) throw new Error('这个 Word 文件缺少正文，请另存为 DOCX 后重试。');
  if (part._data?.uncompressedSize > 20 * 1024 * 1024) {
    throw new Error('Word 正文过大，请拆分后重新上传。');
  }
  const document = new DOMParser().parseFromString(await part.async('string'), 'application/xml');
  const root = document.documentElement;
  const namespace = root.namespaceURI;
  const body = root.getElementsByTagNameNS(namespace, 'body')[0];
  if (root.localName !== 'document' || !body) throw new Error('无法读取 Word 正文，请另存为 DOCX 后重试。');

  const fragments = [];
  let length = 0;
  function append(text) {
    length += text.length;
    checkLength(length);
    fragments.push(text);
  }
  function read(element) {
    if (element.namespaceURI === namespace) {
      switch (element.localName) {
        case 'del':
        case 'moveFrom':
          return;
        case 't':
          append(element.textContent);
          return;
        case 'tab':
          append('\t');
          return;
        case 'br':
        case 'cr':
          append('\n');
          return;
      }
    }
    for (const child of element.children) read(child);
    if (element.namespaceURI === namespace && element.localName === 'p') append('\n');
  }
  read(body);
  return fragments.join('').replace(/\n$/, '');
}

let cmaps;
class PdfBinaryData {
  async fetch({ kind, filename }) {
    if (kind !== 'cMapUrl') throw new Error('PDF resource unavailable.');
    if (!cmaps) {
      cmaps = Promise.all([zipClass(), fetch(new URL('./vendor/pdf-cmaps.bin', import.meta.url))])
        .then(async ([Zip, response]) => {
          if (!response.ok) throw new Error('无法载入 PDF 中文字符映射。');
          return Zip.loadAsync(await response.arrayBuffer());
        }).catch(error => { cmaps = null; throw error; });
    }
    const entry = (await cmaps).file(filename);
    if (!entry) throw new Error('PDF character map unavailable.');
    return entry.async('uint8array');
  }
}

async function readPdf(data, onProgress, signal) {
  const { getDocument, GlobalWorkerOptions } = await import('./vendor/pdf.min.js');
  GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.js', import.meta.url).href;
  const task = getDocument({
    data: new Uint8Array(data),
    BinaryDataFactory: PdfBinaryData,
    useWorkerFetch: false,
    useWasm: false,
    isEvalSupported: false,
    stopAtErrors: true,
  });
  function cancel() { task.destroy().catch(() => {}); }
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    signal?.throwIfAborted();
    const pdf = await task.promise;
    const pages = [];
    let length = 0;
    let emptyPages = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      signal?.throwIfAborted();
      onProgress?.(`正在读取 PDF · ${number} / ${pdf.numPages} 页`);
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.map(item => (item.str ?? '') + (item.hasEOL ? '\n' : '')).join('');
      if (!text.trim()) emptyPages++;
      length += text.length + (number > 1 ? 1 : 0);
      checkLength(length);
      pages.push(text);
      page.cleanup();
    }
    return { text: pages.join('\n'), note: emptyPages ? `${emptyPages} 页无可提取文字` : '' };
  } catch (error) {
    if (error.name === 'PasswordException') throw new Error('PDF 有密码保护，请解密后重新上传。');
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (!signal?.aborted) await task.destroy().catch(() => {});
  }
}

export async function readDocument(file, onProgress, signal) {
  if (file.size > MAX_FILE_BYTES) throw new Error('文件超过 25 MB，请拆分后重新上传。');
  const extension = file.name.split('.').at(-1).toLowerCase();
  if (!['txt', 'docx', 'pdf'].includes(extension)) throw new Error('请选择 TXT、DOCX 或 PDF 文件。');

  let result;
  try {
    const data = await file.arrayBuffer();
    signal?.throwIfAborted();
    if (extension === 'txt') result = { text: decodeText(data) };
    if (extension === 'docx') result = { text: await readWord(data) };
    if (extension === 'pdf') result = await readPdf(data, onProgress, signal);
  } catch (error) {
    signal?.throwIfAborted();
    if (error.message?.startsWith('文档') || error.message?.startsWith('Word') ||
        error.message?.startsWith('这个 Word') || error.message?.startsWith('无法读取 Word') ||
        error.message?.startsWith('PDF 有密码')) throw error;
    throw new Error('无法读取该文档，请确认文件可打开后重试。', { cause: error });
  }
  if (!result.text.trim()) {
    throw new Error(extension === 'pdf' ? 'PDF 没有可提取的文字。扫描件请先做 OCR。' : '文档里没有可分析的文字。');
  }
  checkLength(result.text.length);
  return result;
}
