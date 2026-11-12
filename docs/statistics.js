export function renderLevelStatistics(counts, total = 0, isPreview = false) {
  const panel = document.getElementById('level-statistics');
  const chart = document.getElementById('level-chart');
  const notice = document.getElementById('analysis-preview');
  panel.hidden = !total;
  notice.hidden = !isPreview;
  chart.replaceChildren();
  if (!total) return;

  const levels = [1, 2, 3, 4, 5, 6, null];
  const max = Math.max(...levels.map(level => counts.get(level) ?? 0));
  const columns = document.createDocumentFragment();
  for (const level of levels) {
    const count = counts.get(level) ?? 0;
    const percent = 100 * count / total;
    const column = document.createElement('li');
    column.className = `chart-column level-${level ?? 'unknown'}`;
    const amount = document.createElement('strong');
    amount.textContent = count.toLocaleString('zh-CN');
    const track = document.createElement('div');
    track.className = 'chart-track';
    track.setAttribute('aria-hidden', 'true');
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.style.height = `${100 * count / max}%`;
    track.append(bar);
    const name = document.createElement('span');
    name.className = 'chart-name';
    name.textContent = level ? `${level} 级` : '未收录';
    const share = document.createElement('span');
    share.className = 'chart-share';
    share.textContent = percent > 0 && percent < 0.05 ? '<0.1%' : `${percent.toFixed(1)}%`;
    column.append(amount, track, name, share);
    columns.append(column);
  }
  chart.append(columns);
}
