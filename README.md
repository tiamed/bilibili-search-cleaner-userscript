# B站搜索净化 - API命中与DOM高亮过滤

一个用于 Bilibili 搜索页的 userscript。脚本会拦截 B 站搜索接口，根据接口返回里的 `hit_columns` 保留真正命中的视频；当首屏或懒加载没有接口数据时，会根据页面自身渲染出的关键词高亮节点做 DOM 兜底过滤，隐藏无关视频结果。

## 功能

- 拦截 Bilibili 搜索 API：
  - `/x/web-interface/wbi/search/all/v2`
  - `/x/web-interface/wbi/search/type`
  - `/x/web-interface/search/type`
  - `/x/web-interface/search/all/v2`
- 根据接口结果中的 `hit_columns` 或 `hitColumns` 判断命中视频。
- 支持从 SSR 初始数据中提取视频结果。
- 对首屏和懒加载结果进行 DOM 高亮兜底判断，不硬编码搜索关键词。
- 自动隐藏无关搜索结果，并在页面顶部显示过滤统计。
- 点击提示条可切换显示全部结果或重新过滤。

## 安装

1. 安装 userscript 管理器，例如 Tampermonkey、Violentmonkey 或 ScriptCat。
2. 打开 [GreasyFork 脚本页](https://greasyfork.org/zh-CN/scripts/585729-b%E7%AB%99%E6%90%9C%E7%B4%A2%E5%87%80%E5%8C%96-api%E5%91%BD%E4%B8%AD%E4%B8%8Edom%E9%AB%98%E4%BA%AE%E8%BF%87%E6%BB%A4) 或仓库中的 [`bilibili-search-cleaner.user.js`](./bilibili-search-cleaner.user.js)。
3. 在安装页面或 raw 页面中安装脚本。
4. 访问 <https://search.bilibili.com/> 搜索页面验证效果。

## GreasyFork 同步

同步 URL：

```text
https://raw.githubusercontent.com/tiamed/bilibili-search-cleaner-userscript/main/bilibili-search-cleaner.user.js
```

## 适用范围

脚本只匹配：

```text
https://search.bilibili.com/*
```

## 开发

这是一个纯 userscript 项目，没有构建步骤。修改后直接在 userscript 管理器中重新安装或更新 `bilibili-search-cleaner.user.js` 即可。

## License

MIT. See [LICENSE](./LICENSE).
