export interface ArticleImageToken {
  /** UTF-16 source offsets; end is exclusive. */
  start: number;
  end: number;
  markdown: string;
  link: string;
  alt: string;
  width?: number;
  height?: number;
}

function escaped(body: string, offset: number): boolean {
  let slashes = 0;
  for (let i = offset - 1; i >= 0 && body[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

function unescape(value: string): string {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~\s])/g, '$1');
}

function codeMask(body: string): Uint8Array {
  const mask = new Uint8Array(body.length);
  let fence: { marker: string; length: number } | null = null;
  for (let start = 0; start < body.length;) {
    const nextLine = body.indexOf('\n', start);
    const end = nextLine === -1 ? body.length : nextLine + 1;
    const line = body.slice(start, end).replace(/\r?\n$/, '');
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      mask.fill(1, start, end);
      if (match && match[1][0] === fence.marker && match[1].length >= fence.length && /^\s*$/.test(match[2])) fence = null;
    } else if (match && (match[1][0] === '~' || !match[2].includes('`'))) {
      fence = { marker: match[1][0], length: match[1].length };
      mask.fill(1, start, end);
    }
    start = end;
  }
  for (let i = 0; i < body.length;) {
    if (mask[i] || body[i] !== '`' || escaped(body, i)) { i++; continue; }
    let runEnd = i + 1;
    while (body[runEnd] === '`') runEnd++;
    const length = runEnd - i;
    let close = -1, closeEnd = -1;
    for (let p = runEnd; p < body.length;) {
      if (mask[p]) break;
      if (body[p] !== '`') { p++; continue; }
      let end = p + 1;
      while (body[end] === '`') end++;
      if (end - p === length) { close = p; closeEnd = end; break; }
      p = end;
    }
    if (close !== -1) { mask.fill(1, i, closeEnd); i = closeEnd; }
    else i = runEnd;
  }
  return mask;
}

function wikiImage(body: string, start: number): ArticleImageToken | null {
  let end = start + 3;
  while (end < body.length && body[end] !== '\n' && body[end] !== '\r') {
    if (body.slice(end, end + 2) === ']]' && !escaped(body, end)) break;
    end++;
  }
  if (body.slice(end, end + 2) !== ']]') return null;
  const content = body.slice(start + 3, end);
  let separator = -1;
  for (let i = 0; i < content.length; i++) if (content[i] === '|' && !escaped(content, i)) { separator = i; break; }
  const link = unescape(separator === -1 ? content : content.slice(0, separator)).trim();
  if (!link) return null;
  const alias = separator === -1 ? '' : unescape(content.slice(separator + 1)).trim();
  const dimension = /^(\d+)(?:x(\d+))?$/i.exec(alias);
  const token: ArticleImageToken = { start, end: end + 2, markdown: body.slice(start, end + 2), link, alt: dimension ? link : alias || link };
  if (dimension) {
    const width = Number(dimension[1]), height = dimension[2] ? Number(dimension[2]) : undefined;
    if (Number.isSafeInteger(width) && width > 0) token.width = width;
    if (height !== undefined && Number.isSafeInteger(height) && height > 0) token.height = height;
  }
  return token;
}

function markdownImage(body: string, start: number): ArticleImageToken | null {
  let cursor = start + 2, brackets = 1;
  while (cursor < body.length && brackets) {
    if (body[cursor] === '\\') { cursor += 2; continue; }
    if (body[cursor] === '[') brackets++;
    if (body[cursor] === ']') brackets--;
    cursor++;
  }
  if (brackets || body[cursor] !== '(') return null;
  const alt = unescape(body.slice(start + 2, cursor - 1));
  cursor++;
  while (/\s/.test(body[cursor] || '') && cursor < body.length) cursor++;
  const destinationStart = cursor;
  let destination: string;
  if (body[cursor] === '<') {
    cursor++;
    const begin = cursor;
    while (cursor < body.length && body[cursor] !== '\n' && body[cursor] !== '\r') {
      if (body[cursor] === '\\') { cursor += 2; continue; }
      if (body[cursor] === '>') break;
      cursor++;
    }
    if (body[cursor] !== '>') return null;
    destination = body.slice(begin, cursor++);
  } else {
    let depth = 0;
    while (cursor < body.length) {
      if (body[cursor] === '\\') { cursor += 2; continue; }
      if (body[cursor] === '(') depth++;
      else if (body[cursor] === ')') { if (!depth) break; depth--; }
      else if (/\s/.test(body[cursor])) break;
      cursor++;
    }
    if (depth) return null;
    destination = body.slice(destinationStart, cursor);
  }
  const beforeWhitespace = cursor;
  while (cursor < body.length && /\s/.test(body[cursor])) cursor++;
  if (body[cursor] !== ')') {
    // A title requires separation from its destination.
    if (cursor === beforeWhitespace || !['"', "'", '('].includes(body[cursor])) return null;
    const opener = body[cursor++], closer = opener === '(' ? ')' : opener;
    let depth = 1;
    while (cursor < body.length && depth) {
      if (body[cursor] === '\\') { cursor += 2; continue; }
      if (opener === '(' && body[cursor] === '(') depth++;
      if (body[cursor] === closer) depth--;
      cursor++;
    }
    if (depth) return null;
    while (cursor < body.length && /\s/.test(body[cursor])) cursor++;
    if (body[cursor] !== ')') return null;
  }
  const end = cursor + 1;
  return { start, end, markdown: body.slice(start, end), link: unescape(destination), alt };
}

/** Read source positions without stripping, replacing, or deduplicating Markdown. */
export function articleImageTokens(body: string): ArticleImageToken[] {
  const result: ArticleImageToken[] = [], mask = codeMask(body);
  for (let cursor = 0; cursor < body.length; cursor++) {
    if (mask[cursor] || body[cursor] !== '!' || escaped(body, cursor)) continue;
    const token = body.slice(cursor, cursor + 3) === '![[' ? wikiImage(body, cursor) : body.slice(cursor, cursor + 2) === '![' ? markdownImage(body, cursor) : null;
    if (token) { result.push(token); cursor = token.end - 1; }
  }
  return result;
}

/** Replace the selected range, placing an image between Markdown paragraphs. */
export function insertArticleImage(body: string, offsetStart: number, offsetEnd: number, markdown: string): string {
  const insertion = markdown.trim();
  if (!insertion) return body;
  const clamp = (offset: number) => Math.max(0, Math.min(body.length, Number.isFinite(offset) ? Math.trunc(offset) : 0));
  const a = clamp(offsetStart), b = clamp(offsetEnd), start = Math.min(a, b), end = Math.max(a, b);
  const before = body.slice(0, start), after = body.slice(end);
  const newline = body.includes('\r\n') ? '\r\n' : '\n';
  const gapBefore = before && !/\r?\n\r?\n$/.test(before) ? /\r?\n$/.test(before) ? newline : newline + newline : '';
  const gapAfter = after && !/^\r?\n\r?\n/.test(after) ? /^\r?\n/.test(after) ? newline : newline + newline : '';
  return before + gapBefore + insertion + gapAfter + after;
}
