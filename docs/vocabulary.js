const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const packageRelationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
const documentRelationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function toXmlText(value) {
  return String(value)
    .replace(/_x[0-9a-f]{4}_/gi, match => '_x005F' + match)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function table(rows, includeCount) {
  const headers = ['词语', 'HSK 等级'];
  if (includeCount) headers.push('出现次数');
  return [headers, ...rows.map(({ word, level, count }) => {
    const values = [word, level ?? '未收录'];
    if (includeCount) values.push(count);
    return values;
  })];
}

export function vocabularyTxt(rows, includeCount) {
  const lines = table(rows, includeCount).map(row => row.map(
    value => String(value).replace(/[\r\n\t]/g, ' ')).join('\t'));
  return new Blob(['\ufeff', lines.join('\r\n'), '\r\n'], { type: 'text/plain;charset=utf-8' });
}

function relationships(id, kind, target) {
  return `<Relationships xmlns="${packageRelationships}"><Relationship Id="${id}" Type="${documentRelationships}/${kind}" Target="${target}"/></Relationships>`;
}

export async function vocabularyExcel(rows, includeCount) {
  const { default: Zip } = await import('./vendor/jszip.min.js');
  const zip = new (Zip ?? globalThis.JSZip)();
  const values = table(rows, includeCount);
  const rowsXml = values.map((row, i) => {
    const cells = row.map((value, j) => {
      const address = `${'ABC'[j]}${i + 1}`;
      return typeof value === 'number'
        ? `<c r="${address}"><v>${value}</v></c>`
        : `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${toXmlText(value)}</t></is></c>`;
    }).join('');
    return `<row r="${i + 1}">${cells}</row>`;
  }).join('');
  const range = `A1:${includeCount ? 'C' : 'B'}${values.length}`;

  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
    <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  </Types>`);
  zip.file('_rels/.rels', relationships('rId1', 'officeDocument', 'xl/workbook.xml'));
  zip.file('xl/_rels/workbook.xml.rels', relationships('rId1', 'worksheet', 'worksheets/sheet1.xml'));
  zip.file('xl/workbook.xml', `<workbook xmlns="${spreadsheet}" xmlns:r="${documentRelationships}">
    <bookViews><workbookView/></bookViews>
    <sheets><sheet name="词表" sheetId="1" r:id="rId1"/></sheets>
  </workbook>`);
  zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="${spreadsheet}">
    <dimension ref="${range}"/>
    <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
    <cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="${includeCount ? 3 : 2}" width="15" customWidth="1"/></cols>
    <sheetData>${rowsXml}</sheetData>
    <autoFilter ref="${range}"/>
  </worksheet>`);

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: xlsxMime });
}

function download(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function connectVocabulary(levelLabel, levelBadge) {
  const $ = id => document.getElementById(id);
  const filter = $('vocabulary-filter');
  const list = $('vocabulary-list');
  const status = $('vocabulary-count');
  let allWords = [];
  let filteredWords = [];
  let analysisWords = [];

  function renderDictionary() {
    const level = Number(filter.value);
    filteredWords = level ? allWords.filter(row => row.level === level) : allWords;
    const fragment = document.createDocumentFragment();
    for (const { word, level } of filteredWords) {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = word;
      item.append(label, levelBadge(level, true));
      fragment.append(item);
    }
    list.replaceChildren(fragment);
    const count = filteredWords.length.toLocaleString('zh-CN');
    status.textContent = `${level ? levelLabel(level) : '全部等级'} · ${count} 个词`;
    $('vocabulary-txt').disabled = $('vocabulary-xlsx').disabled = filteredWords.length === 0;
  }

  function bindExport(prefix, getRows, getName, includeCount) {
    const message = $(`${prefix}-export-status`);
    const formats = { txt: vocabularyTxt, xlsx: vocabularyExcel };
    for (const [extension, createFile] of Object.entries(formats)) {
      const button = $(`${prefix}-${extension}`);
      button.addEventListener('click', async () => {
        const rows = getRows();
        if (!rows.length || button.getAttribute('aria-busy') === 'true') return;
        const name = getName();
        button.setAttribute('aria-busy', 'true');
        message.textContent = '';
        try {
          download(await createFile(rows, includeCount), `${name}.${extension}`);
        } catch {
          message.textContent = '导出失败，请重试。';
        } finally {
          button.removeAttribute('aria-busy');
        }
      });
    }
  }

  filter.addEventListener('change', renderDictionary);
  bindExport('vocabulary', () => filteredWords, () => filter.value ? `HSK ${filter.value} 级词表` : 'HSK 全部词表', false);
  bindExport('analysis', () => analysisWords, () => '分词词表', true);

  return {
    setDictionary(levels) {
      allWords = Array.from(levels, ([word, level]) => ({ word, level }));
      filter.disabled = false;
      renderDictionary();
    },
    setAnalysis(words) {
      analysisWords = words;
      $('analysis-exports').hidden = !words.length;
      $('analysis-export-status').textContent = '';
    },
  };
}
