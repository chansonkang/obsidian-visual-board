import { test } from 'node:test';
import assert from 'node:assert/strict';
import { articleImageTokens, insertArticleImage } from '../src/article-images';

test('Obsidian image embeds keep dimensions, captions, order, duplicates, and exact source ranges', () => {
  const body = '段落一\n![[附件/猫.png|320]]\n段落二\n![[附件/猫.png|320x200]]\n![[附件/猫.png|我的猫]]\n![[附件/猫.png|320]]';
  const images = articleImageTokens(body);
  assert.equal(images.length, 4);
  assert.deepEqual(images.map(image => image.link), Array(4).fill('附件/猫.png'));
  assert.deepEqual(images.map(image => image.width), [320, 320, undefined, 320]);
  assert.equal(images[1].height, 200);
  assert.equal(images[2].alt, '我的猫');
  for (const image of images) assert.equal(body.slice(image.start, image.end), image.markdown);
  assert.ok(images[0].start < images[1].start && images[1].start < images[2].start);
});

test('Markdown destinations support spaces, escaped brackets, balanced parentheses, and optional titles', () => {
  const body = [
    '![小猫](cat.png)',
    '![带空格](<附件/my cat.png> "图像标题")',
    '![escaped \\] label](images/my\\ cat\\(1\\).png \'title\')',
    '![nested [alt]](https://example.com/a(b(c)).png (title (nested)))',
    '![empty alt]()',
  ].join('\n');
  const images = articleImageTokens(body);
  assert.equal(images.length, 5);
  assert.deepEqual(images.map(image => image.link), ['cat.png', '附件/my cat.png', 'images/my cat(1).png', 'https://example.com/a(b(c)).png', '']);
  assert.deepEqual(images.map(image => image.alt), ['小猫', '带空格', 'escaped ] label', 'nested [alt]', 'empty alt']);
  for (const image of images) assert.equal(body.slice(image.start, image.end), image.markdown);
});

test('fenced code and matched inline code are ignored while real neighboring images remain', () => {
  const body = [
    '![[before.png]]',
    '```markdown',
    '![[hidden.png]] ![hidden](hidden.png)',
    '```',
    '~~~',
    '![[tilde-hidden.png]]',
    '~~~',
    '`![[inline-hidden.png]]` and ``![backtick ` text](hidden.png)``',
    '![alt `code` text](real.png)',
    '\\![[escaped.png]]',
    '![[after.png]]',
  ].join('\n');
  assert.deepEqual(articleImageTokens(body).map(image => image.link), ['before.png', 'real.png', 'after.png']);
  assert.deepEqual(articleImageTokens('````\n![[hidden.png]]\n```\n![[still-hidden.png]]'), []);
  assert.deepEqual(articleImageTokens('` unmatched code opener ![[real.png]]').map(image => image.link), ['real.png']);
});

test('malformed image syntax and ordinary links do not produce image placements', () => {
  const body = '[[note]] [note](note.md) ![[unterminated\n ![x](broken(parenthesis.png) ![x](a b.png) ![[ ]]';
  assert.deepEqual(articleImageTokens(body), []);
});

test('insertion replaces the exact selection and preserves the surrounding original paragraphs', () => {
  const original = '前面的段落\n\n需要替换的内容\n\n后面的段落';
  const start = original.indexOf('需要'), end = original.indexOf('\n\n后面');
  assert.equal(insertArticleImage(original, start, end, '![[new.png]]'), '前面的段落\n\n![[new.png]]\n\n后面的段落');
  assert.equal(insertArticleImage('before after', 6, 6, '![x](x.png)'), 'before\n\n![x](x.png)\n\n after');
  assert.equal(insertArticleImage('first\nlast', 6, 6, '![[x.png]]'), 'first\n\n![[x.png]]\n\nlast');
  assert.equal(insertArticleImage('end', 3, 3, '![[x.png]]'), 'end\n\n![[x.png]]');
  assert.equal(insertArticleImage('start', 0, 0, '![[x.png]]'), '![[x.png]]\n\nstart');
  assert.equal(insertArticleImage('abc', 2, 1, '![[x.png]]'), 'a\n\n![[x.png]]\n\nc');
  assert.equal(insertArticleImage('unchanged', 0, 9, ''), 'unchanged');
  assert.equal(insertArticleImage('first\r\nlast', 7, 7, '![[x.png]]'), 'first\r\n\r\n![[x.png]]\r\n\r\nlast');
});
