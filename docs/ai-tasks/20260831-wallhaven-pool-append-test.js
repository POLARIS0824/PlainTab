/**
 * Wallhaven 图池增量追加（append + evict）与设置画廊点击上墙 行为检查。
 *
 * 锁定的行为（用户视角）：
 * 1. 定时/手动追加模式：新一批图插到队列前面，旧图保留；超过 48 张淘汰最旧。
 * 2. toplist 刷新先按配置窗口取；配置窗口一张新图都给不出时，用最近 24 小时日榜兜底。
 * 3. 与池子里重复的批次不产生变化（added=0，不重置 index、不推进 lastAddedAt）。
 * 4. 设置面板 Apply（换配置）仍保持整体替换语义。
 * 5. 点击设置画廊缩略图立即把那张设为当前壁纸。
 * 6. 设置面板提供「拉取一批」按钮，点击后池子头部出现新图。
 * 7. 备份导出覆盖整个池子的 Blob。
 * 8. 到期判定以 lastAddedAt 为锚点：空批次不消耗间隔，冷却窗口内不重复请求。
 * 9. 新增 i18n key 在全部语言文件中存在。
 *
 * 运行（无框架，Playwright 走 npx 缓存）：
 *   set NODE_PATH=E:\Scoop\persist\nodejs-lts\npm-cache\_npx\a80a913f4f8f2557\node_modules
 *   node docs\ai-tasks\20260831-wallhaven-pool-append-test.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const indexUrl = 'file:///' + path.join(repoRoot, 'index.html').replace(/\\/g, '/');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const I18N_KEYS_REQUIRED = ['wallhavenPullMore', 'wallpaperThumbSetTip', 'wallpaperDownloadEmpty'];
const I18N_FILES = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pl', 'pt', 'ru', 'tr', 'vi', 'zh-CN', 'zh-TW'];

function assert(condition, message) {
  if (!condition) throw new Error('FAIL: ' + message);
}

// 页面内注入：劫持 fetch，wallhaven API / 图片 / bing 端点全部离线化。
const FETCH_STUB = `
(() => {
  const realFetch = window.fetch.bind(window);
  const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
  window.__whRequests = [];
  function searchItem(id) {
    return {
      id: id,
      url: 'https://wallhaven.cc/w/' + id,
      short_url: 'https://whvn.cc/' + id,
      path: 'https://img.example.test/w/' + id + '.png',
      purity: 'sfw', category: 'general', resolution: '64x64',
      dimension_x: 64, dimension_y: 64, file_type: 'image/png', file_size: 100,
      colors: [], thumbs: {}, created_at: '2026-01-01 00:00:00', source: ''
    };
  }
  window.__whPageItemIds = (page, count) => Array.from({ length: count }, (_, i) => 'p' + page + '_' + String(i + 1).padStart(2, '0'));
  function unwrapProxy(url) {
    try {
      const u = new URL(url);
      if (u.hostname === 'api.codetabs.com' && u.pathname === '/v1/proxy') return u.searchParams.get('quest') || url;
      if (u.hostname === 'api.allorigins.win' && u.pathname === '/raw') return u.searchParams.get('url') || url;
    } catch (e) {}
    return url;
  }
  function fakeResponse(url) {
    const target = unwrapProxy(url);
    if (target.indexOf('https://wallhaven.cc/api/v1/search') === 0) {
      window.__whRequests.push(target);
      const parsed = new URL(target);
      const page = Math.max(1, parseInt(parsed.searchParams.get('page') || '1', 10) || 1);
      // __whDailyIds / __whStaticIds 用来模拟「日榜有新图、配置窗口已饱和」的对照场景
      const daily = parsed.searchParams.get('topRange') === '1d';
      let ids;
      if (daily && window.__whDailyIds) ids = window.__whDailyIds.slice();
      else if (!daily && window.__whStaticIds) ids = window.__whStaticIds.slice();
      else ids = window.__whPageItemIds(page, 24);
      const body = JSON.stringify({ data: ids.map(searchItem), meta: { current_page: page, last_page: 5, total: 120 } });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (target.indexOf('https://img.example.test/') === 0) {
      return new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
    if (target.indexOf('bing.kaininx.workers.dev') !== -1 || target.indexOf('bing.biturl.top') !== -1) {
      return new Response(JSON.stringify({ url: 'https://img.example.test/bing.png' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return null;
  }
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const response = fakeResponse(url);
    if (response) return Promise.resolve(response);
    return realFetch(input, init);
  };
})();
`;

const PAGE_HELPERS = `
(() => {
  function rawItems(ids) {
    return ids.map((id) => ({
      id: id,
      url: 'https://wallhaven.cc/w/' + id,
      short_url: 'https://whvn.cc/' + id,
      path: 'https://img.example.test/w/' + id + '.png',
      purity: 'sfw', category: 'general', resolution: '64x64',
      dimension_x: 64, dimension_y: 64, file_type: 'image/png', file_size: 100,
      colors: [], thumbs: {}, created_at: '2026-01-01 00:00:00', source: ''
    }));
  }
  window.__norm = (ids) => window.WallpaperFetch.normalizeWallhavenItems({ data: rawItems(ids) });
  window.__cache = (ids, options) => {
    const cfg = window.WallpaperData.loadWallhavenConfig();
    return window.WallpaperFetch.cacheWallhavenItems(cfg, window.__norm(ids), options || {});
  };
  window.__order = () => (window.WallpaperData.loadWallpaper().cache.order || []).filter((id) => String(id).indexOf('wallhaven_') === 0);
  window.__blobExists = (id) => window.WallpaperData.idbGet(window.WallpaperData.imgKey(id)).then((r) => !!(r && r.blob));
  window.__state = () => window.WallpaperData.loadWallpaper().providers.wallhaven.state;
  window.__setWhIds = (options) => {
    const opts = options || {};
    window.__whDailyIds = opts.daily ? opts.daily.slice() : null;
    window.__whStaticIds = opts.static ? opts.static.slice() : null;
  };
  window.__setWhState = (patch) => window.WallpaperData.updateWallpaper((model) => {
    Object.keys(patch).forEach((key) => { model.providers.wallhaven.state[key] = patch[key]; });
  });
  window.__setWhSorting = (sorting) => {
    const cfg = Object.assign(window.WallpaperData.loadWallhavenConfig(), { sorting: sorting });
    window.WallpaperData.saveWallhavenConfig(cfg);
  };
})();
`;

async function resetStorage(page) {
  await page.goto(indexUrl, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('PlainTab');
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);
    req.onblocked = () => resolve(false);
  }));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.WallpaperData && window.WallpaperFetch && window.SettingsPanelFull);
}

async function checkPoolAppendAndEvict(page) {
  await resetStorage(page);
  const page1 = await page.evaluate(() => window.__whPageItemIds(1, 12));
  const page2 = await page.evaluate(() => window.__whPageItemIds(2, 12));
  const page3 = await page.evaluate(() => window.__whPageItemIds(3, 12));
  const page4 = await page.evaluate(() => window.__whPageItemIds(4, 12));
  const page5 = await page.evaluate(() => window.__whPageItemIds(5, 12));
  const page6 = await page.evaluate(() => window.__whPageItemIds(6, 12));
  const wh = (id) => 'wallhaven_' + id;

  // 种子：整体替换写入第一批 12 张
  await page.evaluate((ids) => window.__cache(ids, {}), page1);
  let order = await page.evaluate(() => window.__order());
  assert(order.length === 12 && order[0] === wh(page1[0]), 'seed replace writes 12-item pool');

  // append 第二批：指针为 0，新图插在指针后（队头），旧图保留，池子 24
  const appendResult = await page.evaluate((ids) => window.__cache(ids, { append: true }), page2);
  order = await page.evaluate(() => window.__order());
  assert(appendResult && appendResult.added === 12, 'append result reports added=12');
  assert(order.length === 24, 'pool grows to 24 after append, got ' + order.length);
  assert(order.slice(0, 12).join(',') === page2.map(wh).join(','), 'new batch is placed right after the pointer (head)');
  assert(order.slice(12).join(',') === page1.map(wh).join(','), 'old images are kept after the new batch');
  const index = await page.evaluate(() => window.WallpaperData.loadWallpaper().cache.index);
  assert(index === 0, 'cache.index points at the first new image after append');
  const preview = await page.evaluate(() => window.WallpaperData.loadPreview());
  const headThumb = await page.evaluate((id) => window.WallpaperData.loadThumbs()[id], order[0]);
  assert(!!preview && preview === headThumb, 'first-paint preview follows the new head image');
  const b1Blob = await page.evaluate((id) => window.__blobExists(id), wh(page2[0]));
  assert(b1Blob, 'appended image blob stored in IndexedDB');

  // 重复批次：added=0，不重置 index
  await page.evaluate(() => window.WallpaperData.saveActiveIndex(7));
  const dupResult = await page.evaluate((ids) => window.__cache(ids, { append: true }), page2);
  order = await page.evaluate(() => window.__order());
  assert(dupResult && dupResult.added === 0, 'duplicate batch reports added=0');
  assert(order.length === 24, 'duplicate batch does not change the pool');
  const indexAfterDup = await page.evaluate(() => window.WallpaperData.loadWallpaper().cache.index);
  assert(indexAfterDup === 7, 'duplicate batch does not reset cache.index');

  // append 第三批：指针 7 → 新图插在已看的 b2_0..6 之后，未看旧图仍在指针前方，36 < 48 无淘汰
  await page.evaluate((ids) => window.__cache(ids, { append: true }), page3);
  order = await page.evaluate(() => window.__order());
  assert(order.length === 36, 'no eviction below the pool limit, got ' + order.length);
  assert(order.slice(0, 7).join(',') === page2.slice(0, 7).map(wh).join(','), 'shown prefix stays in front');
  assert(order.slice(7, 19).join(',') === page3.map(wh).join(','), 'new batch is inserted right after the pointer');
  assert(order.slice(19).join(',') === page2.slice(7).map(wh).concat(page1.map(wh)).join(','), 'unseen images keep their relative order behind the new batch');
  const indexAfterThird = await page.evaluate(() => window.WallpaperData.loadWallpaper().cache.index);
  assert(indexAfterThird === 7, 'pointer is not reset by append, got ' + indexAfterThird);

  // append 第四批：恰好填满 48 张上限，仍无淘汰
  await page.evaluate((ids) => window.__cache(ids, { append: true }), page4);
  order = await page.evaluate(() => window.__order());
  assert(order.length === 48, 'pool reaches the 48 limit, got ' + order.length);
  assert(order.slice(7, 19).join(',') === page4.map(wh).join(','), 'fourth batch inserted after the pointer');
  let cachedCount = await page.evaluate(() => window.__state().cachedCount);
  assert(cachedCount === 48, 'state.cachedCount follows the pool size, got ' + cachedCount);

  // append 第五批：溢出 12 张；指针身后已看的 b2_0..6 最先淘汰，队尾 b1_7..11 跟着裁掉
  await page.evaluate((ids) => window.__cache(ids, { append: true }), page5);
  order = await page.evaluate(() => window.__order());
  assert(order.length === 48, 'pool stays capped at 48');
  assert(order.slice(0, 12).join(',') === page5.map(wh).join(','), 'fifth batch is placed right after the pointer (now head)');
  assert(order.slice(12).join(',') === page4.map(wh).concat(page3.map(wh)).concat(page2.slice(7).map(wh)).concat(page1.slice(0, 7).map(wh)).join(','), 'shown images evicted first, unseen kept');
  const shownGone = await page.evaluate((id) => window.__blobExists(id), wh(page2[0]));
  assert(!shownGone, 'already-shown oldest image blob deleted from IndexedDB');
  const tailGone = await page.evaluate((id) => window.__blobExists(id), wh(page1[11]));
  assert(!tailGone, 'far-tail overflow image evicted after the shown region is exhausted');
  const unseenKept = await page.evaluate((id) => window.__blobExists(id), wh(page2[7]));
  assert(unseenKept, 'unseen image is not evicted while still ahead of the pointer');
  const metaAfter = await page.evaluate(() => window.WallpaperData.loadWallpaper().cache.meta);
  assert(!metaAfter[wh(page2[0])] && !metaAfter[wh(page1[11])] && !!metaAfter[wh(page2[7])] && !!metaAfter[wh(page1[0])], 'evicted image references removed before blob deletion');
  const indexAfterFifth = await page.evaluate(() => window.WallpaperData.loadWallpaper().cache.index);
  assert(indexAfterFifth === 0, 'pointer sits at the first new image after append, got ' + indexAfterFifth);

  // append 第六批：指针 3，已看 3 张淘汰后再裁队尾 3 张（b1_4..6）
  await page.evaluate(() => window.WallpaperData.saveActiveIndex(3));
  await page.evaluate((ids) => window.__cache(ids, { append: true }), page6);
  order = await page.evaluate(() => window.__order());
  assert(order.length === 48, 'pool stays capped at 48 after the sixth append');
  assert(order.slice(0, 12).join(',') === page6.map(wh).join(','), 'sixth batch is placed right after the pointer');
  const sixthShownGone = await page.evaluate((id) => window.__blobExists(id), wh(page5[0]));
  assert(!sixthShownGone, 'images shown just before this append are evicted first');
  const sixthTailGone = await page.evaluate((id) => window.__blobExists(id), wh(page1[6]));
  assert(!sixthTailGone, 'far-tail image evicted when the shown region is exhausted');
  const sixthUnseenKept = await page.evaluate((id) => window.__blobExists(id), wh(page2[7]));
  assert(sixthUnseenKept, 'unseen mid-pool image survives');
  // 队尾裁切共 9 张：b1_0..6 + b2_11、b2_10，边界内的 b2_8、b2_9 存活
  const sixthCutGone = await page.evaluate((id) => window.__blobExists(id), wh(page1[0]));
  assert(!sixthCutGone, 'tail cut reaches the oldest unseen images when shown region is small');
  const sixthCutBoundaryKept = await page.evaluate((id) => window.__blobExists(id), wh(page2[8]));
  assert(sixthCutBoundaryKept, 'tail images within the cut boundary survive');

  // 导出覆盖全部 48 张
  const exportedKeys = await page.evaluate(async () => {
    const payload = await window.WallpaperData.exportUserDataAsync();
    const records = (payload.data && payload.data.indexedDb && payload.data.indexedDb.records) || [];
    return records.map((r) => r.key);
  });
  const missing = order.filter((id) => {
    const key = 'ptab_wallpaper_blob_' + id;
    return exportedKeys.indexOf(key) === -1;
  });
  assert(missing.length === 0, 'backup export covers all 48 pool blobs, missing: ' + missing.join(','));

  // 配置 Apply（不带 append）仍为整体替换
  await page.evaluate((ids) => window.__cache(ids, {}), page1);
  order = await page.evaluate(() => window.__order());
  assert(order.length === 12 && order.join(',') === page1.map(wh).join(','), 'config-apply path still replaces the whole pool');
  const cBlob = await page.evaluate((id) => window.__blobExists(id), wh(page2[0]));
  assert(!cBlob, 'replace path evicts non-kept blobs');
}

async function checkToplistRandomPage(page) {
  await resetStorage(page);
  const page1Ids = await page.evaluate(() => window.__whPageItemIds(1, 24));
  // 铺满热门榜第 1 页全部 24 张，逼出「必须翻更深页码才能拿到新图」的行为
  await page.evaluate((ids) => window.__cache(ids, {}), page1Ids.slice(0, 12));
  await page.evaluate((ids) => window.__cache(ids, { append: true }), page1Ids.slice(12));

  const result = await page.evaluate(() => {
    const cfg = window.WallpaperData.loadWallhavenConfig();
    return window.WallpaperFetch.refreshWallhavenSource(cfg, { append: true }).then(
      (r) => ({ ok: true, added: r && r.added, cached: r && r.cached }),
      (err) => ({ ok: false, message: err && err.message })
    );
  });
  assert(result.ok, 'append refresh succeeds: ' + (result.message || ''));
  assert(result.added === 12, 'toplist append refresh pulls 12 new images, got ' + result.added);
  const requestedPages = await page.evaluate(() => window.__whRequests.map((u) => {
    try { return parseInt(new URL(u).searchParams.get('page') || '1', 10) || 1; } catch (e) { return 1; }
  }));
  assert(requestedPages.some((p) => p !== 1), 'toplist append must request pages beyond 1, got pages: ' + requestedPages.join(','));
  const order = await page.evaluate(() => window.__order());
  assert(order.length === 36, 'appended batch grows the pool below the limit, got ' + order.length);
  assert(order[0].indexOf('wallhaven_p1_') !== 0, 'refreshed head image is a new (non-page-1) image');
}

async function checkConfiguredWindowKeepsPriority(page) {
  await resetStorage(page);
  const page1Ids = await page.evaluate(() => window.__whPageItemIds(1, 24));
  const dailyIds = await page.evaluate(() => window.__whPageItemIds(2, 24).map((id) => 'd_' + id));
  // 热门榜第 1 页全部已在池子里：深页还有新图，日榜不该被调用
  await page.evaluate((payload) => {
    window.__setWhIds({ daily: payload.daily });
    window.WallpaperData.setActiveSource('wallhaven');
  }, { daily: dailyIds });
  await page.evaluate((ids) => window.__cache(ids, {}), page1Ids.slice(0, 12));
  await page.evaluate((ids) => window.__cache(ids, { append: true }), page1Ids.slice(12));

  const result = await page.evaluate(() => {
    const cfg = window.WallpaperData.loadWallhavenConfig();
    return window.WallpaperFetch.refreshWallhavenSource(cfg, { append: true }).then(
      (r) => ({ ok: true, added: r && r.added }),
      (err) => ({ ok: false, message: err && err.message })
    );
  });
  assert(result.ok && result.added === 12, 'append refresh keeps working from deep pages, got ' + result.added + ' ' + (result.message || ''));
  const ranges = await page.evaluate(() => window.__whRequests.map((u) => new URL(u).searchParams.get('topRange')));
  assert(ranges.every((r) => r !== '1d'), 'daily fallback must stay unused while the configured window delivers, got: ' + ranges.join(','));
  const order = await page.evaluate(() => window.__order());
  assert(order.slice(0, 12).every((id) => id.indexOf('wallhaven_d_') !== 0), 'new images come from the configured window, not the daily list');
}

async function checkDailyToplistFallback(page) {
  await resetStorage(page);
  const poolIds = await page.evaluate(() => window.__whPageItemIds(9, 24));
  const dailyIds = await page.evaluate(() => window.__whPageItemIds(1, 24).map((id) => 'd_' + id));
  const wh = (id) => 'wallhaven_' + id;

  // 配置窗口（topRange=1M）每一页都只回池子里已有的那批图，日榜是唯一的新图来源
  await page.evaluate((payload) => {
    window.__setWhIds({ daily: payload.daily, static: payload.static });
    window.WallpaperData.setActiveSource('wallhaven');
  }, { daily: dailyIds, static: poolIds });
  await page.evaluate((ids) => window.__cache(ids, {}), poolIds.slice(0, 12));
  await page.evaluate((ids) => window.__cache(ids, { append: true }), poolIds.slice(12));

  const result = await page.evaluate(() => {
    const cfg = window.WallpaperData.loadWallhavenConfig();
    return window.WallpaperFetch.refreshWallhavenSource(cfg, { append: true }).then(
      (r) => ({ ok: true, added: r && r.added }),
      (err) => ({ ok: false, message: err && err.message })
    );
  });
  assert(result.ok, 'fallback append refresh succeeds: ' + (result.message || ''));
  assert(result.added === 12, 'saturated window still yields a batch through the daily fallback, got ' + result.added);

  const ranges = await page.evaluate(() => window.__whRequests.map((u) => new URL(u).searchParams.get('topRange')));
  assert(ranges[0] === '1M', 'configured window is queried first, got: ' + ranges.join(','));
  assert(ranges[ranges.length - 1] === '1d' && ranges.filter((r) => r === '1d').length === 1,
    'daily fallback runs once, last, got: ' + ranges.join(','));
  const order = await page.evaluate(() => window.__order());
  assert(order.slice(0, 12).join(',') === dailyIds.slice(0, 12).map(wh).join(','), 'fallback images land at the head of the pool');
  const storedTopRange = await page.evaluate(() => window.WallpaperData.loadWallhavenConfig().topRange);
  assert(storedTopRange === '1M', 'daily fallback must not leak into the stored config, got ' + storedTopRange);

  // 对照组：非 toplist 排序没有日榜兜底，只能 added=0
  await page.evaluate(() => window.__setWhSorting('views'));
  const control = await page.evaluate(() => {
    const cfg = window.WallpaperData.loadWallhavenConfig();
    return window.WallpaperFetch.refreshWallhavenSource(cfg, { append: true }).then((r) => (r && r.added), () => -1);
  });
  assert(control === 0, 'non-toplist sorting has no daily fallback and stays empty, got ' + control);
  await page.evaluate(() => window.__setWhSorting('toplist'));

  // 配置窗口本身就是 1d 时不存在额外兜底请求
  const dailyOnly = await page.evaluate(() => {
    window.__whRequests.length = 0;
    const cfg = Object.assign(window.WallpaperData.loadWallhavenConfig(), { topRange: '1d' });
    window.WallpaperData.saveWallhavenConfig(cfg);
    return window.WallpaperFetch.refreshWallhavenSource(window.WallpaperData.loadWallhavenConfig(), { append: true })
      .then((r) => (r && r.added), () => -1);
  });
  const dailyOnlyRanges = await page.evaluate(() => window.__whRequests.map((u) => new URL(u).searchParams.get('topRange')));
  assert(dailyOnly === 12 && dailyOnlyRanges.length === 1 && dailyOnlyRanges[0] === '1d',
    'topRange=1d needs no extra fallback request, got added=' + dailyOnly + ' requests=' + dailyOnlyRanges.join(','));
}

async function checkEmptyBatchAndRetry(page) {
  await resetStorage(page);
  const ids = await page.evaluate(() => window.__whPageItemIds(3, 24));
  // 日榜和配置窗口都只剩池子里已有的图：这一批必然是空的
  await page.evaluate((payload) => {
    window.__setWhIds({ daily: payload.ids, static: payload.ids });
    window.WallpaperData.setActiveSource('wallhaven');
  }, { ids: ids });
  await page.evaluate((ids) => window.__cache(ids, {}), ids.slice(0, 12));
  await page.evaluate((ids) => window.__cache(ids, { append: true }), ids.slice(12));
  const before = await page.evaluate(() => window.__state());

  const result = await page.evaluate(() => {
    const cfg = window.WallpaperData.loadWallhavenConfig();
    return window.WallpaperFetch.refreshWallhavenSource(cfg, { append: true }).then(
      (r) => ({ ok: true, added: r && r.added }),
      (err) => ({ ok: false, added: -1, message: err && err.message })
    );
  });
  assert(result.ok && result.added === 0, 'saturated pool yields an empty batch, got ' + result.added + ' ' + (result.message || ''));
  const after = await page.evaluate(() => window.__state());
  assert(after.lastSuccessAt > before.lastSuccessAt, 'empty batch still records the successful request');
  assert(after.lastAddedAt === before.lastAddedAt, 'empty batch does not advance lastAddedAt');

  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;

  // 锚点过期 + 冷却已过：即使 lastSuccessAt 很新，也要在下次打开时重试
  const now = Date.now();
  await page.evaluate((patch) => window.__setWhState(patch), {
    lastAddedAt: now - 2 * day,
    lastSuccessAt: now - 60 * 1000,
    lastCheckedAt: now - 7 * hour
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.WallpaperData && window.WallpaperFetch);
  const retried = await page.waitForFunction(() => window.__whRequests.length > 0, null, { timeout: 8000 })
    .then(() => true, () => false);
  assert(retried, 'stale lastAddedAt retries on the next new tab after the cooldown');

  // 冷却窗口内：不重复打接口
  const now2 = Date.now();
  await page.evaluate((patch) => window.__setWhState(patch), {
    lastAddedAt: now2 - 2 * day,
    lastSuccessAt: now2 - 60 * 1000,
    lastCheckedAt: now2 - 5 * 60 * 1000
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.WallpaperData && window.WallpaperFetch);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 2500)));
  const inCooldown = await page.evaluate(() => window.__whRequests.length);
  assert(inCooldown === 0, 'cooldown suppresses repeated requests, got ' + inCooldown);

  // 锚点仍然新鲜：整个间隔内不请求
  const now3 = Date.now();
  await page.evaluate((patch) => window.__setWhState(patch), {
    lastAddedAt: now3 - 60 * 1000,
    lastSuccessAt: now3 - 60 * 1000,
    lastCheckedAt: now3 - 7 * hour
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.WallpaperData && window.WallpaperFetch);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 2500)));
  const fresh = await page.evaluate(() => window.__whRequests.length);
  assert(fresh === 0, 'fresh lastAddedAt keeps the interval and skips the request, got ' + fresh);
}

async function checkGalleryClickToApply(page) {
  await resetStorage(page);
  const page1 = await page.evaluate(() => window.__whPageItemIds(1, 12));
  const page2 = await page.evaluate(() => window.__whPageItemIds(2, 12));
  await page.evaluate((ids) => window.__cache(ids, {}), page1);
  await page.evaluate((ids) => window.__cache(ids, { append: true }), page2);
  await page.evaluate(() => {
    window.WallpaperData.setActiveSource('wallhaven');
    const SP = window.SettingsPanelFull;
    SP.setCurrentMode('wallhaven');
    SP.open();
    SP.refresh();
  });
  await page.waitForFunction(() => document.querySelectorAll('#wallpaperGallery .wallpaper-thumb[data-source="wallhaven"]').length, null, { timeout: 15000 });
  const thumbCount = await page.evaluate(() => document.querySelectorAll('#wallpaperGallery .wallpaper-thumb[data-source="wallhaven"]').length);
  assert(thumbCount === 24, 'gallery shows the full 24-image pool, got ' + thumbCount);
  const cursor = await page.evaluate(() => {
    const el = document.querySelector('#wallpaperGallery .wallpaper-thumb[data-source="wallhaven"]');
    return window.getComputedStyle(el).cursor;
  });
  assert(cursor === 'pointer', 'wallhaven gallery thumb advertises clickability, cursor=' + cursor);

  const expectedId = await page.evaluate(() => window.__order()[3]);
  await page.evaluate(() => {
    const thumbs = document.querySelectorAll('#wallpaperGallery .wallpaper-thumb[data-source="wallhaven"]');
    thumbs[3].click();
  });
  try {
    await page.waitForFunction((id) => window.WallpaperShow && window.WallpaperShow.currentOriginalId === id, expectedId, { timeout: 15000 });
  } catch (e) {
    const dump = await page.evaluate((id) => ({
      expectedId: id,
      order: window.__order(),
      index: window.WallpaperData.getActiveIndex(),
      originalId: window.WallpaperShow && window.WallpaperShow.currentOriginalId,
      thumbIds: Array.prototype.map.call(document.querySelectorAll('#wallpaperGallery .wallpaper-thumb[data-source="wallhaven"]'), (el) => el.dataset.id),
      panelClass: document.getElementById('settingsPanel').className
    }), expectedId);
    console.error('CLICK-TO-APPLY FAILURE DUMP:', JSON.stringify(dump, null, 2));
    throw e;
  }
  const activeIndex = await page.evaluate(() => window.WallpaperData.getActiveIndex());
  // tryLoad 加载 order[3] 后指针推进到 4（与日常轮换语义一致，当前图 = index-1）
  assert(activeIndex === 4, 'clicking the 4th thumb loads it and advances the rotation pointer, got ' + activeIndex);
}

async function checkManualPullButton(page) {
  await resetStorage(page);
  const page1 = await page.evaluate(() => window.__whPageItemIds(1, 12));
  const page2 = await page.evaluate(() => window.__whPageItemIds(2, 12));
  await page.evaluate((ids) => window.__cache(ids, {}), page1);
  await page.evaluate((ids) => window.__cache(ids, { append: true }), page2);
  const before = await page.evaluate(() => window.__order());

  await page.evaluate(() => {
    const SP = window.SettingsPanelFull;
    SP.setCurrentMode('wallhaven');
    SP.open();
    SP.refresh();
  });
  const buttonVisible = await page.evaluate(() => {
    const btn = document.getElementById('wallhavenPullBtn');
    return !!(btn && btn.offsetParent !== null);
  });
  assert(buttonVisible, 'wallhaven mode shows the manual pull button');
  await page.click('#wallhavenPullBtn');
  await page.waitForFunction((old) => {
    const order = (window.WallpaperData.loadWallpaper().cache.order || []).filter((id) => String(id).indexOf('wallhaven_') === 0);
    return order.length && order.slice(0, 12).every((id) => old.indexOf(id) === -1);
  }, before, { timeout: 30000 });
  const lastSuccessAt = await page.evaluate(() => window.__state().lastSuccessAt);
  assert(lastSuccessAt > 0, 'manual pull records success timestamp');
  const buttonHiddenOutsideWallhaven = await page.evaluate(() => {
    const SP = window.SettingsPanelFull;
    SP.setCurrentMode('bing');
    SP.refresh();
    const btn = document.getElementById('wallhavenPullBtn');
    return btn ? (btn.offsetParent === null || btn.hidden) : true;
  });
  assert(buttonHiddenOutsideWallhaven, 'pull button hidden for non-wallhaven sources');
}

function checkI18nKeys() {
  I18N_FILES.forEach((lang) => {
    const file = path.join(repoRoot, 'js', 'i18n', lang + '.js');
    const text = fs.readFileSync(file, 'utf8');
    I18N_KEYS_REQUIRED.forEach((key) => {
      assert(text.indexOf('"' + key + '"') !== -1, 'i18n key "' + key + '" missing in js/i18n/' + lang + '.js');
    });
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.addInitScript(FETCH_STUB);
  await page.addInitScript(PAGE_HELPERS);

  try {
    await checkPoolAppendAndEvict(page);
    console.log('PASS pool append/evict/dedupe/replace/export');
    await checkToplistRandomPage(page);
    console.log('PASS toplist random-page append refresh');
    await checkDailyToplistFallback(page);
    console.log('PASS daily toplist fallback');
    await checkConfiguredWindowKeepsPriority(page);
    console.log('PASS configured window keeps priority');
    await checkEmptyBatchAndRetry(page);
    console.log('PASS empty batch keeps interval + cooldown retry');
    await checkGalleryClickToApply(page);
    console.log('PASS gallery click-to-apply');
    await checkManualPullButton(page);
    console.log('PASS manual pull button');
  } finally {
    await browser.close();
  }
  checkI18nKeys();
  console.log('PASS i18n key completeness (' + I18N_FILES.length + ' languages)');
  console.log('ALL CHECKS PASSED');
})().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
