// ==UserScript==
// @name         B站搜索净化 - API命中与DOM高亮过滤
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  拦截B站搜索API，根据hit_columns保留命中结果；首屏/懒加载无接口数据时根据DOM关键词高亮兜底过滤，隐藏无关视频
// @author       tiamed
// @match        https://search.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @run-at       document-start
// @grant        none
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/585729/B%E7%AB%99%E6%90%9C%E7%B4%A2%E5%87%80%E5%8C%96%20-%20API%E5%91%BD%E4%B8%AD%E4%B8%8EDOM%E9%AB%98%E4%BA%AE%E8%BF%87%E6%BB%A4.user.js
// @updateURL https://update.greasyfork.org/scripts/585729/B%E7%AB%99%E6%90%9C%E7%B4%A2%E5%87%80%E5%8C%96%20-%20API%E5%91%BD%E4%B8%AD%E4%B8%8EDOM%E9%AB%98%E4%BA%AE%E8%BF%87%E6%BB%A4.meta.js
// ==/UserScript==

(function() {
    'use strict';

    const matchedBVids = new Set();
    const allVideoCards = new Map();

    let isApplying = false;
    let showHidden = false;
    let bannerEl = null;
    let observerStarted = false;
    let scanTimer = null;

    const SEARCH_API_PATTERNS = [
        '/x/web-interface/wbi/search/all/v2',
        '/x/web-interface/wbi/search/type',
        '/x/web-interface/search/type',
        '/x/web-interface/search/all/v2'
    ];

    function isSearchApi(url) {
        url = String(url || '');
        return SEARCH_API_PATTERNS.some(pattern => url.includes(pattern));
    }

    // ─── 1. 拦截 fetch ─────────────────────────────────────────
    const originalFetch = window.fetch;

    window.fetch = function(...args) {
        const request = args[0];

        const url = typeof request === 'string'
            ? request
            : request && request.url || '';

        if (isSearchApi(url)) {
            return originalFetch.apply(this, args).then(async response => {
                try {
                    const data = await response.clone().json();
                    processSearchResponse(data, 'fetch');
                } catch (e) {
                    console.warn('[B站过滤] fetch JSON解析失败:', e);
                }

                return response;
            });
        }

        return originalFetch.apply(this, args);
    };

    // ─── 2. 拦截 XMLHttpRequest ────────────────────────────────
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        return _open.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
        if (this._url && isSearchApi(this._url)) {
            this.addEventListener('load', function() {
                try {
                    const data = JSON.parse(this.responseText);
                    processSearchResponse(data, 'xhr');
                } catch (e) {
                    // ignore
                }
            });
        }

        return _send.apply(this, arguments);
    };

    // ─── 3. API 响应处理 ───────────────────────────────────────
    function processSearchResponse(data, source = 'api') {
        if (!data || data.code !== 0 || !data.data) return;

        let total = 0;
        let matchCount = 0;

        walkVideoObjects(data.data, (bvid, item) => {
            total++;

            if (hasHitColumns(item)) {
                if (!matchedBVids.has(bvid)) {
                    matchedBVids.add(bvid);
                    matchCount++;
                }
            }
        });

        console.log(`[B站过滤] ${source} 数据: ${total} 条视频对象, 新增命中 ${matchCount} 条`);

        if (matchCount > 0) {
            showHidden = false;
            scheduleScan(0);
        }
    }

    function walkVideoObjects(root, onVideo) {
        const seen = new WeakSet();

        function walk(obj, depth) {
            if (!obj || typeof obj !== 'object') return;
            if (depth > 30) return;
            if (seen.has(obj)) return;

            seen.add(obj);

            if (Array.isArray(obj)) {
                for (const item of obj) {
                    walk(item, depth + 1);
                }
                return;
            }

            const bvid = normalizeBvid(obj);

            if (bvid) {
                onVideo(bvid, obj);
            }

            for (const v of Object.values(obj)) {
                if (v && typeof v === 'object') {
                    walk(v, depth + 1);
                }
            }
        }

        walk(root, 0);
    }

    function normalizeBvid(obj) {
        if (!obj || typeof obj !== 'object') return null;

        if (typeof obj.bvid === 'string') {
            const m = obj.bvid.match(/(BV[a-zA-Z0-9]{10})/);
            if (m) return m[1];
        }

        const urls = [
            obj.arcurl,
            obj.url,
            obj.link,
            obj.goto_url,
            obj.uri
        ];

        for (const u of urls) {
            if (typeof u === 'string') {
                const m = u.match(/(BV[a-zA-Z0-9]{10})/);
                if (m) return m[1];
            }
        }

        return null;
    }

    function hasHitColumns(obj) {
        if (!obj || typeof obj !== 'object') return false;

        return (
            Array.isArray(obj.hit_columns) && obj.hit_columns.length > 0
        ) || (
            Array.isArray(obj.hitColumns) && obj.hitColumns.length > 0
        );
    }

    // ─── 4. 可选 SSR 提取：只在 boot 时调用 ────────────────────
    function extractSSRDataOnce() {
        const roots = [];

        if (window.__INITIAL_STATE__) {
            roots.push(window.__INITIAL_STATE__);
        }

        const renderDataEl = document.querySelector('#__RENDER_DATA__');

        if (renderDataEl && renderDataEl.textContent.trim()) {
            const parsed = parseRenderData(renderDataEl.textContent.trim());
            roots.push(...parsed);
        }

        if (roots.length === 0) return false;

        let total = 0;
        let matchCount = 0;

        for (const root of roots) {
            walkVideoObjects(root, (bvid, item) => {
                total++;

                if (hasHitColumns(item)) {
                    if (!matchedBVids.has(bvid)) {
                        matchedBVids.add(bvid);
                        matchCount++;
                    }
                }
            });
        }

        if (total > 0) {
            console.log(`[B站过滤] SSR数据: ${total} 条视频对象, 新增命中 ${matchCount} 条`);
        }

        return total > 0;
    }

    function parseRenderData(raw) {
        const results = [];
        const candidates = [raw];

        try {
            candidates.push(decodeURIComponent(raw));
        } catch (e) {}

        try {
            const ta = document.createElement('textarea');
            ta.innerHTML = raw;
            candidates.push(ta.value);

            try {
                candidates.push(decodeURIComponent(ta.value));
            } catch (e) {}
        } catch (e) {}

        for (const text of candidates) {
            try {
                results.push(JSON.parse(text));
            } catch (e) {}
        }

        return results;
    }

    // ─── 5. BV 提取 ────────────────────────────────────────────
    function getBvidFromHref(href) {
        href = String(href || '');
        const m = href.match(/(BV[a-zA-Z0-9]{10})/);
        return m ? m[1] : null;
    }

    // ─── 6. DOM 高亮判断：不硬编码关键词 ───────────────────────
    function cardHasKeywordHighlight(card) {
        if (!card || !card.querySelectorAll) return false;

        /**
         * 只根据页面自身渲染出来的高亮节点判断。
         * 不读取 URL keyword，不硬编码任何关键词。
         */
        const textAreas = [
            '.bili-video-card__info',
            '.bili-video-card__info--tit',
            '.bili-video-card__info--desc',
            '.video-info',
            '.video-title',
            '.video-desc',
            '.search-card',
            'h3',
            'p'
        ];

        const highlightSelectors = [
            'em.keyword',
            '.keyword',
            '[class*="keyword"]',
            '[class*="highlight"]',
            'mark'
        ];

        const roots = [];

        for (const areaSel of textAreas) {
            card.querySelectorAll(areaSel).forEach(node => roots.push(node));
        }

        if (roots.length === 0) {
            roots.push(card);
        }

        for (const root of roots) {
            for (const hiSel of highlightSelectors) {
                const nodes = root.querySelectorAll(hiSel);

                for (const node of nodes) {
                    const text = (node.textContent || '').trim();

                    if (text.length > 0) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    // ─── 7. 找卡片外层，修复空视频占位 ─────────────────────────
    function getWrapperFromLink(link) {
        if (!link || !link.closest) return link;

        /**
         * B站新版搜索卡片结构大致是：
         *
         * .video-list-item.col_3...
         *   .bili-video-card
         *     .bili-video-card__skeleton
         *     .bili-video-card__wrap
         *       a[href*="/video/BV"]
         *     .bili-video-card__info
         *
         * 必须隐藏 .video-list-item / col_ 外层，
         * 不能隐藏 .bili-video-card__wrap，
         * 否则会留下空白占位。
         */

        // 1. 最优先：搜索结果网格项外层
        let wrapper = link.closest(
            '.video-list-item, ' +
            '[class*="video-list-item"], ' +
            '.search-video-card, ' +
            '[class*="search-video-card"]'
        );

        if (isValidVideoWrapper(wrapper)) {
            return wrapper;
        }

        // 2. 其次：B站网格列外层，例如 col_3 / col_xs_1_5
        wrapper = closestByClassPart(link, 'col_');

        if (isValidVideoWrapper(wrapper)) {
            return wrapper;
        }

        // 3. 再其次：完整视频卡片
        wrapper = link.closest('.bili-video-card, .video-card, [class*="video-card"]');

        /**
         * 注意：
         * .bili-video-card__wrap 也包含 video-card 字符串，
         * 但它只是内部封面区域，不能作为隐藏目标。
         */
        if (
            wrapper &&
            wrapper.classList &&
            wrapper.classList.contains('bili-video-card__wrap')
        ) {
            const outer = wrapper.closest(
                '.video-list-item, [class*="video-list-item"], [class*="col_"], .bili-video-card'
            );

            if (isValidVideoWrapper(outer)) {
                return outer;
            }
        }

        if (isValidVideoWrapper(wrapper)) {
            return wrapper;
        }

        // 4. li / article 兜底
        wrapper = link.closest('li, article');

        if (isValidVideoWrapper(wrapper)) {
            return wrapper;
        }

        return link;
    }

    function closestByClassPart(el, part) {
        let cur = el;

        while (cur && cur !== document.body) {
            const cls = String(cur.className || '');

            if (cls.includes(part)) {
                return cur;
            }

            cur = cur.parentElement;
        }

        return null;
    }

    function isValidVideoWrapper(el) {
        if (!el || !el.querySelector) return false;

        // 必须包含 BV 链接
        if (!el.querySelector('a[href*="/video/BV"]')) {
            return false;
        }

        const cls = String(el.className || '');

        // 明确排除内部区域，避免留下空白占位
        if (
            cls.includes('bili-video-card__wrap') ||
            cls.includes('bili-video-card__image') ||
            cls.includes('bili-video-card__mask') ||
            cls.includes('bili-video-card__stats') ||
            cls.includes('bili-watch-later') ||
            cls.includes('v-inline-player')
        ) {
            return false;
        }

        // 搜索页外层卡片
        if (
            cls.includes('video-list-item') ||
            cls.includes('search-video-card') ||
            cls.includes('search-card') ||
            /\bcol_/.test(cls)
        ) {
            return true;
        }

        // 完整卡片兜底
        if (
            cls.includes('bili-video-card') ||
            cls.includes('video-card')
        ) {
            return true;
        }

        // li / article 兜底
        if (el.tagName === 'LI' || el.tagName === 'ARTICLE') {
            return true;
        }

        return false;
    }

    function cleanupInnerHiddenWrappers() {
        if (!document.body) return;

        document
            .querySelectorAll('.bili-video-card__wrap[style*="display: none"]')
            .forEach(el => {
                const outer = el.closest(
                    '.video-list-item, [class*="video-list-item"], [class*="col_"], .bili-video-card'
                );

                // 内部 wrap 不应该单独 display:none，否则会出现空卡片
                if (outer && outer !== el) {
                    el.style.display = '';
                }
            });
    }

    // ─── 8. 扫描 DOM 卡片：只从 BV 链接入手，避免卡死 ───────────
    function scanCards() {
        if (isApplying || !document.body) return;

        cleanupInnerHiddenWrappers();

        let foundNew = false;
        let domHighlightMatched = 0;

        const links = document.querySelectorAll('a[href*="/video/BV"]');

        links.forEach(link => {
            const href = link.getAttribute('href') || '';
            const bv = getBvidFromHref(href);

            if (!bv) return;

            const wrapper = getWrapperFromLink(link);

            if (!wrapper || !wrapper.isConnected) return;

            const old = allVideoCards.get(bv);

            if (
                !old ||
                !old.wrapper ||
                !old.wrapper.isConnected ||
                old.wrapper !== wrapper
            ) {
                // 如果之前误把内部 .bili-video-card__wrap 隐藏了，这里恢复它
                if (
                    old &&
                    old.wrapper &&
                    old.wrapper.isConnected &&
                    old.wrapper !== wrapper
                ) {
                    old.wrapper.style.display = '';
                }

                allVideoCards.set(bv, {
                    card: link,
                    wrapper
                });

                foundNew = true;
            }

            /**
             * 首屏 DOM 高亮兜底：
             * 不硬编码关键词，只看 B站自己渲染出的高亮节点。
             */
            if (!matchedBVids.has(bv) && cardHasKeywordHighlight(wrapper)) {
                matchedBVids.add(bv);
                domHighlightMatched++;
                foundNew = true;
            }
        });

        if (domHighlightMatched > 0) {
            console.log(`[B站过滤] DOM高亮新增命中: ${domHighlightMatched} 条`);
        }

        if ((foundNew || domHighlightMatched > 0) && matchedBVids.size > 0) {
            showHidden = false;
            applyFilter();
        } else {
            updateBannerText();
        }
    }

    // ─── 9. debounce 扫描，防止 MutationObserver 高频卡死 ───────
    function scheduleScan(delay = 200) {
        if (scanTimer) return;

        scanTimer = setTimeout(() => {
            scanTimer = null;
            scanCards();
        }, delay);
    }

    // ─── 10. 应用过滤 ──────────────────────────────────────────
    function applyFilter() {
        if (matchedBVids.size === 0) return;

        isApplying = true;

        let hiddenCount = 0;
        let connectedTotal = 0;

        for (const [bvid, entry] of allVideoCards.entries()) {
            const wrapper = entry && entry.wrapper;

            if (!wrapper || !wrapper.isConnected) {
                continue;
            }

            connectedTotal++;

            if (matchedBVids.has(bvid)) {
                wrapper.style.display = '';
            } else {
                if (showHidden) {
                    wrapper.style.display = '';
                } else {
                    wrapper.style.display = 'none';
                    hiddenCount++;
                }
            }
        }

        isApplying = false;

        refreshBanner(hiddenCount, connectedTotal);
    }

    // ─── 11. 提示条 ────────────────────────────────────────────
    function ensureBanner() {
        if (bannerEl && bannerEl.isConnected) return;
        if (!document.body) return;

        bannerEl = document.createElement('div');
        bannerEl.id = 'bili-filter-banner';

        bannerEl.style.cssText = `
            display: inline-block;
            color: var(--v_text_white, #fff);
            background: var(--v_brand_blue, #00a1d6);
            padding: 6px 14px;
            font-size: 13px;
            cursor: pointer;
            z-index: 9999;
            border-radius: 6px;
            user-select: none;
            white-space: nowrap;
            transition: opacity .2s;
        `;

        bannerEl.addEventListener('mouseenter', () => {
            bannerEl.style.opacity = '.85';
        });

        bannerEl.addEventListener('mouseleave', () => {
            bannerEl.style.opacity = '1';
        });

        bannerEl.addEventListener('click', () => {
            showHidden = !showHidden;
            applyFilter();
        });

        const box = document.createElement('div');
        box.id = 'bili-filter-banner-wrapper';
        box.style.cssText = 'text-align:center; margin:8px 0;';
        box.appendChild(bannerEl);

        const target = document.querySelector(
            '.search-content, .video-list, .search-all-list, #search-result, ' +
            '[class*="search-content"], [class*="video-list"]'
        );

        if (target && target.parentNode) {
            target.parentNode.insertBefore(box, target);
        } else {
            document.body.prepend(box);
        }
    }

    function refreshBanner(hiddenCount, connectedTotal) {
        ensureBanner();

        if (!bannerEl) return;

        bannerEl._hiddenCount = hiddenCount;
        bannerEl._connectedTotal = connectedTotal;
        updateBannerText();
    }

    function updateBannerText() {
        if (!bannerEl) return;

        const total = bannerEl._connectedTotal || getConnectedCardCount();
        const hidden = bannerEl._hiddenCount || 0;
        const matched = getConnectedMatchedCount();

        if (showHidden) {
            bannerEl.textContent = `🔍 已恢复全部 ${total} 条结果，命中 ${matched} 条（点击重新过滤）`;
        } else {
            bannerEl.textContent = `🔍 已过滤 ${hidden} 条无关结果，保留命中 ${matched} 条（点击切换显示）`;
        }
    }

    function getConnectedCardCount() {
        let count = 0;

        for (const entry of allVideoCards.values()) {
            if (entry.wrapper && entry.wrapper.isConnected) {
                count++;
            }
        }

        return count;
    }

    function getConnectedMatchedCount() {
        let count = 0;

        for (const bvid of matchedBVids) {
            const entry = allVideoCards.get(bvid);

            if (entry && entry.wrapper && entry.wrapper.isConnected) {
                count++;
            }
        }

        return count;
    }

    // ─── 12. MutationObserver：只 debounce，不做重活 ────────────
    const observer = new MutationObserver(mutations => {
        if (isApplying) return;

        let shouldScan = false;

        for (const m of mutations) {
            if (m.type !== 'childList') continue;

            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;

                const el = node;

                if (
                    (el.matches && el.matches('a[href*="/video/BV"]')) ||
                    (el.querySelector && el.querySelector('a[href*="/video/BV"]'))
                ) {
                    shouldScan = true;
                    break;
                }
            }

            if (shouldScan) break;
        }

        if (shouldScan) {
            scheduleScan(200);
        }
    });

    // ─── 13. 启动 ──────────────────────────────────────────────
    function bootOnce(label) {
        extractSSRDataOnce();
        scanCards();

        if (matchedBVids.size > 0) {
            applyFilter();
        }

        console.log(
            `[B站过滤] boot ${label}: DOM卡片=${getConnectedCardCount()}, 命中=${getConnectedMatchedCount()}`
        );
    }

    function init() {
        if (!document.body) {
            setTimeout(init, 50);
            return;
        }

        if (!observerStarted) {
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            observerStarted = true;
        }

        bootOnce('init');

        // 少量补扫，兼容首屏 hydration / 异步渲染
        setTimeout(() => bootOnce('500ms'), 500);
        setTimeout(() => bootOnce('1500ms'), 1500);
        setTimeout(() => bootOnce('3000ms'), 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, {
            once: true
        });
    } else {
        init();
    }
})();
