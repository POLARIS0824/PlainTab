const assert = require('assert');
const fs = require('fs');

// 针对性检查：命令面板总开关 paletteEnabled。
// 覆盖默认值回填、四个触发点门控、预热跳过、设置 UI 同步与重置恢复。

function read(p) {
  return fs.readFileSync(p.replace(/\//g, '\\'), 'utf8');
}

const data = read('js/wallpaper/data.js');
const newtab = read('js/newtab.js');
const panel = read('js/settings-panel.js');
const css = read('css/settings.css');

// 1) 存储层默认值：mergeDefaults 自动回填，无需 LS_VERSION 迁移。
const defaultsBlock = data.slice(
  data.indexOf('var DEFAULT_SHORTCUTS'),
  data.indexOf('var DEFAULT_GITHUB_ICON')
);
assert.ok(
  defaultsBlock.includes('paletteEnabled: true'),
  'DEFAULT_SHORTCUTS.settings should default paletteEnabled to true'
);
assert.ok(
  !data.includes('LS_VERSION = 4'),
  'paletteEnabled backfills via mergeDefaults; no schema bump expected'
);

// 2) 门控读取用 !== false（缺失即视为启用）。
assert.ok(
  newtab.includes('function paletteFeatureEnabled()') &&
  newtab.includes("loadShortcutSettings().paletteEnabled !== false"),
  'newtab.js should expose paletteFeatureEnabled with !== false semantics'
);

// 3) 快捷键分支被门控包裹：关闭时不吞按键。
const hotkeyStart = newtab.indexOf("if (eventMatchesHotkey(e, window.Palette");
assert.ok(hotkeyStart > 0, 'palette hotkey handlers should exist');
const hotkeyWindow = newtab.slice(newtab.lastIndexOf('if (paletteFeatureEnabled())', hotkeyStart), hotkeyStart);
assert.ok(
  hotkeyWindow.length > 0 && !hotkeyWindow.includes('}'),
  'both palette hotkey branches must sit inside the paletteFeatureEnabled() guard'
);

// 4) 双击 / 中键 / openPalette 门控。
['dblclick', 'auxclick'].forEach((evt) => {
  const at = newtab.indexOf("document.addEventListener('" + evt + "'");
  const body = newtab.slice(at, newtab.indexOf('});', at));
  assert.ok(
    body.includes('paletteFeatureEnabled()'),
    evt + ' handler must early-return when the palette is disabled'
  );
});
const openPaletteBody = newtab.slice(
  newtab.indexOf('function openPalette('),
  newtab.indexOf('function settingsSurfaceActive')
);
assert.ok(
  openPaletteBody.includes('if (!paletteFeatureEnabled()) return;'),
  'openPalette should bail out defensively when disabled'
);

// 5) 禁用状态下预热不注入 palette 资源。
const warmup = newtab.slice(
  newtab.indexOf('function schedulePanelWarmup'),
  newtab.indexOf('function onboardingSeen')
);
assert.ok(
  warmup.includes('if (paletteFeatureEnabled()) ensurePalette()'),
  'idle warmup should skip ensurePalette() when disabled'
);

// 6) 设置 UI：读写函数、开关渲染、关闭即收起、置灰、重置回默认。
assert.ok(panel.includes('function loadPaletteEnabled()'), 'settings panel needs loadPaletteEnabled');
assert.ok(panel.includes('function savePaletteEnabled('), 'settings panel needs savePaletteEnabled');
assert.ok(
  panel.includes('id="cpEnabled"') && panel.includes('cp-master'),
  'shortcuts page should render the master switch as first open-method item'
);
assert.ok(
  panel.includes('cp-feature-off') && panel.includes('function updatePaletteDisabledUI()'),
  'disabled state should toggle the cp-feature-off shell class'
);
const resetFallback = panel.slice(
  panel.indexOf('function resetShortcutsDefaults'),
  panel.indexOf('function resetAllDefaults')
);
assert.ok(
  resetFallback.includes('paletteEnabled: true') && resetFallback.includes('syncShortcutsControls()'),
  'resetting shortcuts defaults restores paletteEnabled and syncs the switch'
);

// 7) i18n：16 个语言包都本地化了两个新键，且不与英文文案雷同。
const i18nDir = 'js/i18n';
const files = fs.readdirSync(i18nDir).filter((f) => f.endsWith('.js'));
assert.strictEqual(files.length, 16, 'expected 16 locale packs');
global.window = {};
global.document = { write() {} };
global.navigator = { language: 'en' };
global.localStorage = { getItem() { return ''; } };
require('../../js/languages.js');
files.forEach((f) => require('../../js/i18n/' + f));
const enLabel = window.I18N.en.cpEnabledLabel;
const enDesc = window.I18N.en.modalDescPaletteEnabled;
files.forEach((f) => {
  const locale = f.replace(/\.js$/, '');
  const pack = window.I18N[locale] || {};
  assert.ok(typeof pack.cpEnabledLabel === 'string' && pack.cpEnabledLabel.length > 0, locale + ': missing cpEnabledLabel');
  assert.ok(typeof pack.modalDescPaletteEnabled === 'string' && pack.modalDescPaletteEnabled.length > 0, locale + ': missing modalDescPaletteEnabled');
  if (locale !== 'en') {
    assert.notStrictEqual(pack.cpEnabledLabel, enLabel, locale + ': cpEnabledLabel looks like an English fallback');
    assert.notStrictEqual(pack.modalDescPaletteEnabled, enDesc, locale + ': modalDescPaletteEnabled looks like an English fallback');
  }
});

// 8) 置灰样式存在且不影响主开关。
assert.ok(
  css.includes('.cp-feature-off .setting-item:not(.cp-master)'),
  'settings.css should dim non-master shortcut items when the palette is off'
);

console.log('palette enabled toggle behavior ok');
