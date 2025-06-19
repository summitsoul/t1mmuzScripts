// ==UserScript==
// @name         B站直播去模糊遮罩
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  自动移除B站直播页面上的模糊遮罩
// @author       t1mmuz
// @match        https://live.bilibili.com/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        noe
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    function removeMasks() {
        const panel = document.getElementById('web-player-module-area-mask-panel');
        if (panel) {
            panel.remove();
            console.log('[B站去遮罩] 模糊遮罩已移除');
        }

        const masks = document.querySelectorAll('.web-player-module-area-mask');
        masks.forEach(el => {
            el.remove();
        });
    }

    // 初次执行一次
    removeMasks();

    // 监听 DOM 变动，防止遮罩重新出现
    const observer = new MutationObserver(() => {
        removeMasks();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    console.log('[B站去遮罩] Tampermonkey脚本已运行');
})();
