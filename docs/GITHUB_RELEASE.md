
---

**PlainTab v3.3.1**

> Unofficial fork build of [PlainTab](https://github.com/kaininx/PlainTab). Not published on the Chrome Web Store or Microsoft Edge Add-ons — install it as an unpacked extension.

**Install**

1. Download `PlainTab-v3.3.1.zip` below and extract it anywhere.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode** in the top-right corner.
4. Click **Load unpacked** and choose the extracted folder that contains `manifest.json`.
5. Open a new tab to see PlainTab.

**Notes**

- Unpacked extensions do not auto-update: download and extract a newer zip over the same folder, then click **Reload** on `chrome://extensions`.
- Chrome may warn that this is a developer-mode extension. That is normal for this install method.
- An unpacked build has a different extension ID from the store version, so both keep separate settings and data.

**Highlights**

- Deleting wallpapers from the gallery now shows an undo notice: click Undo within 6 seconds to restore everything as it was.
- Rapid deletes merge into a single counted notice, and one Undo restores all of them at their original positions.
- Works for uploaded images, uploaded videos, and Wallhaven pool items; deferred cleanup completes automatically on the next new tab even if the page was closed early.

**Summary**

v3.3.1 makes deleting wallpapers forgiving. Every delete in the gallery now opens a short undo window: the item leaves the list right away, the actual image data is kept for 6 seconds, and clicking Undo on the corner notice restores it with its original position, thumbnail, and current-wallpaper pointer. Rapid deletes merge into one counted notice that can be undone in a single click, and the deferred cleanup always finishes — even after closing the page early, the next new tab clears out what is no longer referenced.

---

**PlainTab v3.3.1**

> 个人 fork 构建，不是官方发布。[kaininx/PlainTab](https://github.com/kaininx/PlainTab) 仍是维护主线；本构建未上架 Chrome 网上应用店或 Edge 加载项，只能以「加载已解压的扩展程序」的方式使用。

**安装**

1. 下载下方 `PlainTab-v3.3.1.zip`，解压到任意目录。
2. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）。
3. 打开右上角的「开发者模式」。
4. 点「加载已解压的扩展程序」，选择解压出来、内含 `manifest.json` 的那个文件夹。
5. 打开新标签页即可看到 PlainTab。

**说明**

- 未打包的扩展不会自动更新：下载并解压新版本覆盖同一文件夹，然后在 `chrome://extensions` 点一次「重新加载」。
- Chrome 可能提示这是开发者模式扩展，属于该安装方式的正常行为。
- 未打包构建与商店版本的扩展 ID 不同，两者的设置与数据各自独立。

**更新重点**

- 图库删除壁纸后会出现可撤销的提示：6 秒内点「撤销」即可原样恢复。
- 连续删除合并为一条带数量的提示，一次撤销全部恢复原位。
- 上传图片、视频与 Wallhaven 图库项均支持；延迟清理自动完成，即使提前关闭页面，下次打开新标签页也会清理干净。

**总结**

v3.3.1 让删除壁纸这件事变得可以后悔。图库里的每次删除都会开启一个短暂的撤销窗口：条目立刻从列表移除，原图数据保留 6 秒，期间点击右下角提示上的「撤销」即可连位置、缩略图与当前壁纸指向一起恢复。连续删除会合并为一条带数量的提示，一次点击全部恢复；延迟清理也一定会完成——即使删除后立刻关闭页面，下次打开新标签页时也会把不再使用的原图清理干净。
