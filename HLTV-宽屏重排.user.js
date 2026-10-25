// ==UserScript==
// @name         HLTV 宽屏重排
// @name:en      HLTV Re-layout
// @namespace    http://t1mmuz.com/
// @version      1.0.0
// @description  去掉 hltv.org 两侧广告后，自动加宽页面、按实际栏目重算栅格并清理残留广告占位，宽屏不再空出两大块。
// @description:en  Re-layout hltv.org after side ads are gone: widen the page, rebuild the column grid from the columns that actually remain, and drop leftover ad placeholders.
// @author       t1mmuz
// @match        https://*.hltv.org/*
// @match        https://hltv.org/*
// @icon         https://www.hltv.org/img/static/favicon/favicon-32x32.png
// @grant        none
// @run-at       document-start
// @license      MIT
// @homepageURL  https://github.com/summitsoul/t1mmuzScripts
// @supportURL   https://github.com/summitsoul/t1mmuzScripts/issues
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    /* ------------------------------------------------------------------
     * 可调参数
     * ------------------------------------------------------------------
     * minViewport   小于这个宽度就完全交回 HLTV 自己的手机/平板布局
     * panelMax      不同栏数下面板的最大宽度（4 栏=首页，3 栏=新闻/比赛，2 栏=…）
     * colWidth      侧栏固定宽度，正文永远是剩余空间
     * viewportRatio 面板最多占视口的比例，避免贴边
     * articleTextMax 新闻正文的最大行宽，宽屏下保持可读
     * ------------------------------------------------------------------ */
    const CONFIG = {
        minViewport: 1100,
        gap: 16,
        viewportRatio: 0.96,
        panelMax: { 4: 1600, 3: 1400, 2: 1200, 1: 1100 },
        colWidth: { leftCol: 180, rightCol: 200, right2Col: 200 },
        // 1100~1340 之间空间有限，侧栏收窄一点，别把正文挤没了
        compactColWidth: { leftCol: 160, rightCol: 165, right2Col: 165 },
        compactBelow: 1340,
        articleTextMax: 860
    };

    const COLUMNS = ['leftCol', 'contentCol', 'rightCol', 'right2Col'];

    // 这些是纯广告壳子：广告被拦掉后它们仍会占高度（有的还带 padding 撑出来的比例）
    const AD_SHELLS = [
        '.aditude-placement',
        '.main-top',
        '.mobiletop',
        '.bg-sidebar',
        '#g0_right',
        '#g1_top',
        '#g1_middle',
        '#g4_middle',
        '#g4_bottom'
    ].join(',');

    const CSS = `
:root { --hltv-rl-max: 1000px; }

/* 广告壳子本身就不再占位 */
.hltv-rl .aditude-placement,
.hltv-rl .main-top,
.hltv-rl .mobiletop,
.hltv-rl .bg-sidebar,
.hltv-rl #g0_right,
.hltv-rl #g1_top,
.hltv-rl #g1_middle,
.hltv-rl #g4_middle,
.hltv-rl #g4_bottom {
    display: none !important;
}

@media (min-width: 1100px) {
    /* 浅色面板原来卡在 1000px，两侧留出大片黑色 */
    .hltv-rl .bgPadding {
        max-width: var(--hltv-rl-max) !important;
    }

    /* 里面这层也别再卡 975px */
    .hltv-rl .widthControl {
        max-width: none !important;
    }

    .hltv-rl .colCon {
        grid-gap: 0 ${CONFIG.gap}px !important;
    }

    /* 允许正文列真正收缩，避免长链接/表格把栅格撑破 */
    .hltv-rl .colCon > .leftCol,
    .hltv-rl .colCon > .contentCol,
    .hltv-rl .colCon > .rightCol,
    .hltv-rl .colCon > .right2Col {
        min-width: 0 !important;
    }

    /* 新闻正文限宽，宽屏一行不至于拉太长 */
    .hltv-rl .contentCol > article.newsitem .newstext-con {
        max-width: ${CONFIG.articleTextMax}px;
        margin-left: auto;
        margin-right: auto;
    }
}
`;

    const root = document.documentElement;
    root.classList.add('hltv-rl');

    const style = document.createElement('style');
    style.id = 'hltv-rl-style';
    style.textContent = CSS;
    (document.head || root).appendChild(style);

    let hiddenByUs = new Set();
    let timer = 0;

    function findColCon() {
        const all = document.querySelectorAll('.colCon');
        for (const con of all) {
            if (directChild(con, 'contentCol')) return con;
        }
        return null;
    }

    function directChild(parent, className) {
        for (const child of parent.children) {
            if (child.classList.contains(className)) return child;
        }
        return null;
    }

    function isAdShell(el) {
        return el.matches(AD_SHELLS);
    }

    /** 栏目里是否还存在看得见的内容（广告壳子不算） */
    function hasContent(col) {
        if (!col) return false;

        for (const child of col.children) {
            if (isAdShell(child)) continue;
            const cs = getComputedStyle(child);
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
            const rect = child.getBoundingClientRect();
            if (rect.width > 4 && rect.height > 4) return true;
        }

        // 只剩纯文本的栏目
        const rect = col.getBoundingClientRect();
        return rect.height > 12 && col.textContent.trim().length > 0;
    }

    function clearInline(el) {
        el.style.removeProperty('display');
    }

    function reset(con) {
        hiddenByUs.forEach(clearInline);
        hiddenByUs.clear();
        if (!con) return;
        ['display', 'grid-template-areas', 'grid-template-columns', 'column-gap', 'row-gap'].forEach(function (prop) {
            con.style.removeProperty(prop);
        });
        root.style.removeProperty('--hltv-rl-max');
    }

    function apply() {
        const con = findColCon();
        if (!con) return;

        const viewport = root.clientWidth;

        // 窄屏：撤销所有改动，让 HLTV 自己的响应式规则接管
        if (viewport < CONFIG.minViewport) {
            reset(con);
            return;
        }

        // 先把上一次我们自己隐藏的栏目放出来，才能读到网站原本的显示状态
        hiddenByUs.forEach(clearInline);
        hiddenByUs.clear();

        const nodes = {};
        COLUMNS.forEach(function (name) {
            nodes[name] = directChild(con, name);
        });

        // 网站自己就没渲染 / 自己隐藏的栏目不参与排版
        const present = COLUMNS.filter(function (name) {
            return nodes[name] && getComputedStyle(nodes[name]).display !== 'none';
        });

        if (present.indexOf('contentCol') === -1) {
            reset(con);
            return;
        }

        // 去广告后变成空壳的侧栏直接折叠，不再留一条竖白条
        const kept = present.filter(function (name) {
            return name === 'contentCol' || hasContent(nodes[name]);
        });

        present.forEach(function (name) {
            if (kept.indexOf(name) !== -1) return;
            nodes[name].style.setProperty('display', 'none', 'important');
            hiddenByUs.add(nodes[name]);
        });

        const tracks = kept.map(function (name) {
            if (name === 'contentCol') return 'minmax(0, 1fr)';
            const widths = viewport < CONFIG.compactBelow ? CONFIG.compactColWidth : CONFIG.colWidth;
            return (widths[name] || 180) + 'px';
        });

        const panelMax = CONFIG.panelMax[Math.min(kept.length, 4)] || 1400;
        const panel = Math.min(panelMax, Math.floor(viewport * CONFIG.viewportRatio));

        root.style.setProperty('--hltv-rl-max', panel + 'px');
        con.style.setProperty('display', 'grid', 'important');
        con.style.setProperty('grid-template-areas', '"' + kept.join(' ') + '"', 'important');
        con.style.setProperty('grid-template-columns', tracks.join(' '), 'important');
        con.style.setProperty('column-gap', CONFIG.gap + 'px', 'important');
        con.style.setProperty('row-gap', '0', 'important');
    }

    function schedule(delay) {
        clearTimeout(timer);
        timer = setTimeout(apply, delay);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { schedule(0); }, { once: true });
    } else {
        schedule(0);
    }

    window.addEventListener('load', function () {
        schedule(80);
        // 广告是异步插入的，加载完再补两次
        setTimeout(apply, 1200);
        setTimeout(apply, 3000);
    }, { once: true });

    window.addEventListener('resize', function () { schedule(200); });
    window.addEventListener('pageshow', function () { schedule(60); });

    // 广告位、懒加载内容会改变栏目高度，变动后再算一次
    function startObserver() {
        if (!document.body) return;
        new MutationObserver(function (records) {
            for (const record of records) {
                if (record.type === 'childList' && (record.addedNodes.length || record.removedNodes.length)) {
                    schedule(250);
                    return;
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
    }

    if (document.body) {
        startObserver();
    } else {
        document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    }
})();
