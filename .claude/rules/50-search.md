# 搜索规则

## 所有权

- `js/newtab.js` 拥有搜索执行和搜索历史交互。
- `js/settings-panel.js` 拥有搜索设置 UI，并应用样式/配置变化。
- `js/wallpaper/data.js` 在 `ptab_ui.search` 下持久化搜索配置，并归一化搜索历史。

## 当前配置

`ptab_ui.search` 当前包含：

- `visibility`：`always`、`hover` 或 `never`；默认 `always`。
- `engine`：`google`、`bing`、`baidu` 或 `duckduckgo`；默认 `google`。
- `position`：垂直位置预设，如 `edge-top`、`top`、`upper`、`center-upper`、`center`、`center-lower`、`lower`、`bottom`、`edge-bottom`。
- `align`：`left`、`center` 或 `right`。
- `iconPosition`：`left` 或 `right`；默认 `right`。
- `iconVisibility`：`always` 或 `hidden`；默认 `always`。
- `surface`：`light`、`glass`、`theme`、`solid`、`outline` 或 `clean`；默认 `glass`。
- `shadow`：`none`、`soft` 或 `standard`；默认 `standard`。
- `radius`：`capsule`、`rounded` 或 `sharp`；默认 `capsule`。
- `width`、`backgroundOpacity`、`blur`。
- `placeholder`：用户自定义 placeholder；为空时使用本地化默认文案。
- `enterBehavior`：`current` 或 `newtab`；默认 `current`。
- `historyLimit`：`0`、`5` 或 `10`；默认 `5`。
- `historyItems`：去重后的搜索历史。

窄屏（`max-width: 480px`）下，存储默认仍保持 `center` 以兼容桌面和历史配置，但视觉上的默认居中搜索栏应显示在 `upper` 高度；在窄屏执行“恢复默认搜索设置”或全局恢复时，搜索位置应恢复为 `upper`。

## 搜索图标

- 搜索图标显示只有两种模式：显示和隐藏。
- 不要重新引入“仅聚焦时显示”。
- 网页模式下，图标可以点击切换搜索引擎。如果图标隐藏，不能留下不可见但可点击的命中区域。
- 扩展模式下，图标是静态搜索提示，不应切换引擎。

## 搜索执行

- 空 query 不做任何事。
- 成功搜索前先写入搜索历史。
- 扩展模式可用时使用 `chrome.search.query({ text, disposition })`。
- 网页模式根据回车行为用 `_self` 当前页打开，或 `_blank` 新标签页打开。
- 当前页搜索是默认行为。

## 搜索历史

- 历史面板懒创建在 `#searchBar` 下。
- 支持按输入过滤、方向键选择、Enter 搜索选中项、Escape 关闭、blur 延迟关闭，以及根据视口自动选择上方/下方位置。
- `historyLimit = 0` 时禁用展示和保存。

## 键盘聚焦

- `always` 模式下页面加载完成即预聚焦搜索框（`newtab.js` 的 `prefocusSearchInput`，在 `init` 中调用）：在按键期间移动焦点会让 IME 把首字母当裸文本提交成英文，预聚焦让中文输入法的组合从一开始就落在输入框上。`hover`/`never` 模式不预聚焦。全局 Escape 关闭面板/命令面板后、面板预热完成后、`window` focus 与 `visibilitychange` 重新可见时都会重新预聚焦（焦点落在 body 时），覆盖"页面在 webview 未聚焦时加载导致 focus() 落不住"的窗口期。
- `always` 模式下搜索框内按 Escape 不失焦（保持聚焦不变量，避免下次打字回到 IME 竞态）；`hover` 模式 Escape 失焦并按 blur 逻辑收回搜索栏。
- 空闲页按下任意可打印按键（`e.key.length === 1`）或 IME 组合键（`Process` / `keyCode 229`）即聚焦搜索框，实现位于 `newtab.js` 的 `tryFocusSearchFromKey`；用于预聚焦未覆盖的场景（Escape 失焦后、面板关闭后、hover 模式）。
- 不 `preventDefault`，字符自然落入新聚焦的输入框。
- 触发前必须全部通过守卫：无 Ctrl/Meta/Alt 修饰键；当前焦点不在搜索框或任何可交互元素（`button, a[href], input, textarea, select, [contenteditable], [tabindex]`）；`canRevealSearch()` 通过（`never` 模式即关闭）；设置表面未激活；公告浮层（`.pt-notice-overlay:not([hidden])`）未打开；命令面板打开时由全局 keydown 顶部提前 return，天然不触发。
- 聚焦前设置 `suppressSearchHistoryOnFocus = true` 并先 `showSearch()`（hover 模式下搜索栏默认 `visibility:hidden`，必须先加 `.visible` 再 `focus()`），与点击空白聚焦路径一致。
- 搜索框内按 Escape：历史下拉可见时先关下拉；否则 `always` 模式保持聚焦（见上），`hover` 模式失焦并由现有 blur/hideSearch 逻辑收回搜索栏。

## 视觉规则

- 搜索样式应由 attribute/class 和 CSS 变量驱动，不要到处写 inline style。
- 字体缩放使用 `--app-font-size`、`--app-font-scale` 和 `html[data-font-scale]`。
- placeholder 自定义必须立即更新当前输入框，并持久化到 `ptab_ui.search.placeholder`。
