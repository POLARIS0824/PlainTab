const assert = require('assert');
const fs = require('fs');

// 针对性检查：每日一言复制按钮。
// 覆盖按钮标记、点击换句的选中保护、剪贴板双路径、反馈提示、i18n 键与惰性显形样式。

function read(p) {
  return fs.readFileSync(p.replace(/\//g, '\\'), 'utf8');
}

const html = read('index.html');
const quote = read('js/quote.js');
const css = read('css/base.css');
const data = read('js/wallpaper/data.js');

// 1) 按钮标记：位于 #quoteLine 内，语义化 button，且不用 hidden 属性控制显隐。
const lineStart = html.indexOf('id="quoteLine"');
assert.ok(lineStart > 0, 'index.html should keep #quoteLine');
const lineBlock = html.slice(lineStart, html.indexOf('</div>', lineStart));
assert.ok(lineBlock.includes('id="quoteCopy"'), 'copy button must live inside #quoteLine');
assert.ok(lineBlock.includes('type="button"'), 'copy button must be type=button');
assert.ok(!/id="quoteCopy"[^>]*\shidden/.test(lineBlock), 'copy button must not use the hidden attribute; visibility is CSS driven');

// 2) 点击整行仍然换一句，但要让开复制按钮与文字选中。
assert.ok(
  quote.includes("closest && e.target.closest('.quote-copy')"),
  'line click handler must ignore clicks that land on the copy button'
);
assert.ok(
  quote.includes('function hasQuoteSelection()') && quote.includes('if (hasQuoteSelection()) return;'),
  'line click handler must bail out while quote text is selected, so a drag-select is not replaced'
);
assert.ok(
  quote.includes("copyEl.addEventListener('click', copyQuote)"),
  'copy button needs its own click listener'
);

// 3) 剪贴板：优先异步 API，失败降级 execCommand，且写入不得延迟（会丢失用户激活态）。
assert.ok(
  quote.includes('navigator.clipboard') && quote.includes('writeText'),
  'copy should prefer navigator.clipboard.writeText'
);
assert.ok(quote.includes("execCommand('copy')"), 'copy needs the hidden textarea + execCommand fallback');
assert.ok(
  !/setTimeout\([^)]*copyToClipboard|requestAnimationFrame\([^)]*copyToClipboard/i.test(quote),
  'clipboard write must be started in the click task, not deferred'
);

// 4) 复制内容与反馈。
assert.ok(quote.includes("' —— '"), 'copied text should join quote and attribution with an em dash');
assert.ok(
  quote.includes("toast('quoteCopied'") && quote.includes("toast('quoteCopyFailed'"),
  'both success and failure feedback must be wired through PlainTabNotice.toast'
);
assert.ok(
  quote.includes('selectQuoteText()'),
  'failed copy should select the text so the user can copy manually'
);
assert.ok(
  quote.includes('window.PlainTabNotice'),
  'feedback must reuse the existing notice layer instead of new UI'
);
const apiBlock = quote.slice(
  quote.indexOf('window.PlainTabQuote = {'),
  quote.indexOf('})();', quote.indexOf('window.PlainTabQuote = {'))
);
assert.ok(!apiBlock.includes('copy:'), 'public PlainTabQuote API should stay unchanged for now');

// 5) 样式：默认完全惰性，只在支持悬停的设备显形，loading 期间不可点。
assert.ok(/\.quote-copy\s*\{[^}]*opacity: 0/.test(css), '.quote-copy should start invisible');
assert.ok(/\.quote-copy\s*\{[^}]*pointer-events: none/.test(css), '.quote-copy should start non-interactive');
assert.ok(!/\.quote-copy\s*\{[^}]*user-select/.test(css), 'quote text must stay selectable');
const hoverAt = css.indexOf('@media (hover: hover)');
assert.ok(hoverAt > 0, 'reveal rule must be wrapped in @media (hover: hover) so touch devices never get it');
assert.ok(
  css.slice(hoverAt, hoverAt + 400).includes('.quote-line:hover .quote-copy'),
  'the copy button should be revealed on hovering the quote line'
);
assert.ok(
  css.indexOf('.quote-line.loading .quote-copy') > hoverAt,
  'loading override must come after the hover rule to win the cascade'
);

// 5b) 命中区连续性：按钮不得用 margin 与一言拉开距离，否则指针从文字移向按钮时会
//     先经过空隙、离开 :hover 命中区，按钮随即隐藏且点不到。视觉间隙必须留在 padding 里。
const baseCopyAt = css.indexOf('\n.quote-copy {');
assert.ok(baseCopyAt > 0, '.quote-copy base rule should exist');
const baseCopyBlock = css.slice(baseCopyAt, css.indexOf('}', baseCopyAt));
assert.ok(
  !/margin[a-z-]*:\s*[^0;]/.test(baseCopyBlock),
  '.quote-copy must not offset itself with a margin; the gap has to live inside its own hit box'
);
assert.ok(
  /padding:\s*0 0 0 10px/.test(baseCopyBlock) && /width:\s*38px/.test(baseCopyBlock),
  '.quote-copy should carry the visual gap as left padding so its hit box stays attached to #quoteLine'
);
const narrowAt = css.indexOf('@media (max-width: 640px)');
assert.ok(narrowAt > 0, 'narrow-screen override should exist');
const narrowCopyAt = css.indexOf('.quote-copy', narrowAt);
const narrowCopyBlock = css.slice(narrowCopyAt, css.indexOf('}', narrowCopyAt));
assert.ok(
  !/margin[a-z-]*:\s*[^0;]/.test(narrowCopyBlock),
  'narrow-screen .quote-copy must touch #quoteLine instead of using a margin gap'
);

// 6) 不碰存储：无新键、无 schema 迁移。
assert.ok(!data.includes('quoteCopy') && !data.includes('quoteCopied'), 'no storage schema change expected');
assert.ok(!data.includes('LS_VERSION = 5'), 'quote copy should not bump LS_VERSION');

// 7) 16 个语言包都本地化了 3 个新键，且非英文包不是英文回退。
const i18nDir = 'js/i18n';
const files = fs.readdirSync(i18nDir).filter((f) => f.endsWith('.js'));
assert.strictEqual(files.length, 16, 'expected 16 locale packs');
global.window = {};
global.document = { write() {} };
global.navigator = { language: 'en' };
global.localStorage = { getItem() { return ''; } };
require('../../js/languages.js');
files.forEach((f) => require('../../js/i18n/' + f));
const keys = ['quoteCopyTitle', 'quoteCopied', 'quoteCopyFailed'];
const en = window.I18N.en;
keys.forEach((key) => {
  assert.ok(typeof en[key] === 'string' && en[key].length > 0, 'en: missing ' + key);
});
files.forEach((f) => {
  const locale = f.replace(/\.js$/, '');
  const pack = window.I18N[locale] || {};
  keys.forEach((key) => {
    assert.ok(typeof pack[key] === 'string' && pack[key].length > 0, locale + ': missing ' + key);
    if (locale !== 'en') {
      assert.notStrictEqual(pack[key], en[key], locale + ': ' + key + ' looks like an English fallback');
    }
  });
});

console.log('quote copy behavior ok');
