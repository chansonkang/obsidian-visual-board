/* Full-text retrieval and the article library share existing document sources. */
function searchV3Locations(docId) {
  return Object.values(state.boards).flatMap(b => b.nodes.filter(n => n.type === 'article' && n.doc === docId).map(n => ({ board: b, node: n })));
}
function searchV3Path(boardId) { return path(boardId).map(b => b.title).join(' › '); }
function searchV3Highlight(value, query) {
  const text = String(value), q = query.trim(), lower = text.toLocaleLowerCase(), needle = q.toLocaleLowerCase();
  if (!needle) return esc(text);
  let start = 0, html = '', index;
  while ((index = lower.indexOf(needle, start)) !== -1) {
    html += esc(text.slice(start, index)) + '<mark>' + esc(text.slice(index, index + q.length)) + '</mark>';
    start = index + q.length;
  }
  return html + esc(text.slice(start));
}
function searchV3Matches(d, query) {
  const lines = String(d.body || '').split('\n'), q = query.trim().toLocaleLowerCase();
  if (!q) return [{ line: 1, text: lines[0] || d.title }];
  const matches = lines.map((text, index) => ({ line: index + 1, text })).filter(hit => hit.text.toLocaleLowerCase().includes(q));
  if (!matches.length && (d.title + ' ' + d.path).toLocaleLowerCase().includes(q)) return [{ line: 1, text: lines[0] || d.title }];
  if (!matches.length && searchV3Locations(d.id).some(place => searchV3Path(place.board.id).toLocaleLowerCase().includes(q))) return [{ line: 1, text: lines[0] || d.title }];
  return matches;
}
function openContentSearch() {
  if (!setModal('搜索并定位', '<p class="search-v3-intro">检索文章标题、正文和画板名称，直接回到对应位置。</p><label class="sr-only" for="search-input">搜索文章正文或画板</label><input id="search-input" data-testid="search-input" type="search" autocomplete="off" placeholder="输入标题、正文关键词或画板名称…"><div class="search-v3-summary" id="search-v3-summary" role="status" aria-live="polite"></div><div id="search-results" class="search-v3-results"></div>', true)) return;
  document.querySelector('.modal').classList.add('content-search-modal');
  searchV3Render('');
  $('search-input').addEventListener('input', e => searchV3Render(e.target.value));
}
function searchV3Render(query) {
  const q = query.trim(), lower = q.toLocaleLowerCase();
  const boards = Object.values(state.boards).filter(b => !q || (b.title + ' ' + searchV3Path(b.id)).toLocaleLowerCase().includes(lower));
  const docs = Object.values(state.docs).map(d => ({ d, hits: searchV3Matches(d, q), locations: searchV3Locations(d.id) })).filter(result => result.hits.length);
  $('search-v3-summary').textContent = (q ? '找到 ' : '示例库 · ') + docs.length + ' 篇文章 · ' + boards.length + ' 个画板';
  const boardHTML = boards.length ? '<h3 class="search-v3-section">画板</h3><div class="search-v3-board-list">' + boards.map(b => `<button class="search-v3-board" data-search-board="${esc(b.id)}" data-testid="search-board-${esc(b.id)}"><span class="search-v3-board-symbol" aria-hidden="true">▱</span><span><strong>${searchV3Highlight(b.title, q)}</strong><small>${esc(searchV3Path(b.id))}</small></span><span class="search-v3-arrow" aria-hidden="true">↗</span></button>`).join('') + '</div>' : '';
  const docHTML = docs.map(({ d, hits, locations }) => {
    const first = hits[0], snippets = hits.slice(0, 3).map((hit, index) => `<button class="search-v3-snippet" data-search-hit="${esc(d.id)}" data-search-line="${hit.line}" data-search-node="${esc(locations[0]?.node.id || '')}" data-search-place="${esc(locations[0]?.board.id || '')}" data-testid="search-preview-${esc(d.id)}-${index}"><span class="search-v3-line-label">第 ${hit.line} 行</span><span>${searchV3Highlight(hit.text || '（空行）', q)}</span><span class="search-v3-snippet-arrow" aria-hidden="true">↗</span></button>`).join('');
    const places = locations.length ? locations.map((place, index) => `<button class="search-v3-place" data-search-hit="${esc(d.id)}" data-search-line="${first.line}" data-search-node="${esc(place.node.id)}" data-search-place="${esc(place.board.id)}" data-testid="search-hit-${esc(d.id)}${index ? '-' + index : ''}" aria-label="定位 ${esc(d.title)}，${esc(searchV3Path(place.board.id))}，第 ${first.line} 行"><span>${esc(searchV3Path(place.board.id))}</span><b>定位 ↗</b></button>`).join('') : `<button class="search-v3-place" data-search-hit="${esc(d.id)}" data-search-line="${first.line}" data-testid="search-hit-${esc(d.id)}"><span>尚未放入画板</span><b>打开原文 ↗</b></button>`;
    return `<article class="search-v3-result"><div class="search-v3-result-heading"><div><h4>${searchV3Highlight(d.title, q)}</h4><small>${esc(d.path)}</small></div><button class="search-v3-add" data-search-add="${esc(d.id)}" data-testid="search-add-${esc(d.id)}" aria-label="添加 ${esc(d.title)} 到当前画板">＋ 添加</button></div><div class="search-v3-snippets">${snippets}${hits.length > 3 ? `<small class="search-v3-more">另有 ${hits.length - 3} 处匹配</small>` : ''}</div><div class="search-v3-places">${places}</div></article>`;
  }).join('');
  $('search-results').innerHTML = boardHTML + (docs.length ? '<h3 class="search-v3-section">文章</h3>' + docHTML : '') || '<div class="search-v3-empty">没有找到匹配内容。试试其他关键词。</div>';
}
function showSearchHitPreview(docId, line, query) {
  openPreview(docId);
  const d = state.docs[docId], pre = $('preview').querySelector('pre');
  if (!d || !pre) return;
  const target = Math.max(1, Math.min(Number(line) || 1, String(d.body).split('\n').length));
  pre.classList.add('search-v3-source');
  pre.innerHTML = String(d.body).split('\n').map((text, index) => `<span class="search-v3-source-line ${index + 1 === target ? 'search-v3-source-hit' : ''}" data-source-line="${index + 1}" ${index + 1 === target ? 'data-testid="search-matched-line" tabindex="-1"' : ''}><span class="search-v3-source-number" aria-hidden="true">${index + 1}</span><span>${searchV3Highlight(text || ' ', query || '')}</span></span>`).join('');
  const context = document.createElement('div');
  context.className = 'search-v3-context';
  context.dataset.testid = 'search-location-context';
  context.textContent = '定位至第 ' + target + ' 行' + (query ? ' · “' + query + '”' : '');
  pre.before(context);
  requestAnimationFrame(() => pre.querySelector('.search-v3-source-hit')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
}
function searchV3OpenHit(element) {
  const docId = element.dataset.searchHit, line = Number(element.dataset.searchLine) || 1, query = $('search-input')?.value || '';
  const placeId = element.dataset.searchPlace, nodeId = element.dataset.searchNode;
  if (!state.docs[docId] || !closeModal()) return;
  if (placeId && state.boards[placeId]) {
    navigate(placeId);
    const b = board(), n = b.nodes.find(item => item.id === nodeId && item.doc === docId);
    if (n) {
      selected = n.id;
      b.view.x = 690 - (n.x + (n.w || 200) / 2) * b.view.zoom;
      b.view.y = 310 - (n.y + (n.h || 240) / 2) * b.view.zoom;
      save(); render();
      const card = [...document.querySelectorAll('[data-node]')].find(item => item.dataset.node === n.id);
      card?.classList.add('search-v3-target');
      card?.focus({ preventScroll: true });
    }
  }
  showSearchHitPreview(docId, line, query);
}
function openArticleLibrary() {
  if (!setModal('添加文章', '<p class="search-v3-intro">选取已有文章放入当前画板，或新建一篇文章。所有引用同步同一份正文。</p><label class="sr-only" for="library-input">搜索已有文章或输入新文章标题</label><input id="library-input" data-testid="library-input" type="search" autocomplete="off" placeholder="搜索已有文章，或输入新文章标题…"><div id="library-results" class="search-v3-library"></div><div class="modal-foot"><small>添加至「' + esc(board().title) + '」</small><button class="btn primary" data-action="create-document" data-testid="create-document">＋ 新建文章</button></div>', true)) return;
  document.querySelector('.modal').classList.add('article-library-modal');
  searchV3LibraryRender('');
  $('library-input').addEventListener('input', e => searchV3LibraryRender(e.target.value));
}
function searchV3LibraryRender(query) {
  const q = query.trim(), lower = q.toLocaleLowerCase();
  const docs = Object.values(state.docs).filter(d => (d.title + ' ' + d.body).toLocaleLowerCase().includes(lower));
  $('library-results').innerHTML = docs.length ? docs.map(d => `<div class="search-v3-library-row"><div><strong>${searchV3Highlight(d.title, q)}</strong><small>${esc(d.path)}</small></div><button class="btn" data-search-add="${esc(d.id)}" data-testid="add-doc-${esc(d.id)}" aria-label="添加 ${esc(d.title)}">＋ 添加</button></div>`).join('') : '<div class="search-v3-empty">没有找到已有文章，可以用这个标题新建。</div>';
}
document.addEventListener('click', function searchV3Click(event) {
  const element = event.target.closest('[data-search-hit],[data-search-board],[data-search-add]');
  if (!element) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (element.hasAttribute('data-search-hit')) searchV3OpenHit(element);
  else if (element.hasAttribute('data-search-board')) navigate(element.dataset.searchBoard);
  else if (closeModal()) addDoc(element.dataset.searchAdd);
}, true);
