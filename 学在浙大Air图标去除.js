// ==UserScript==
// @name         学在浙大Air图标去除
// @namespace    http://t1mmuz.com/
// @version      0.2.1
// @description  利用MutationObserver避免闪烁
// @author       t1mmuz
// @match        https://courses.zju.edu.cn/*
// @grant        none
// @license      MIT
// ==/UserScript==
 
(function() {
    'use strict';
 
    // 删除所有 name 属性以 "air" 开头的元素
    function removeAirElements() {
        const nameElements = document.querySelectorAll('[name^="air"]');
        const idElements = document.querySelectorAll('[id^="air"]');
        const allElements = [...nameElements, ...idElements];
        allElements.forEach(element => {
            element.remove();
        });
    }
 
    // 隐藏 chatbot 图标
    function hideChatbotIcon() {
        const iconElement = document.querySelector('.bot-button');
        if (iconElement) {
            iconElement.style.opacity = '0';
        }
    }
 
    // 执行删除操作
    removeAirElements();
    hideChatbotIcon();
 
    setTimeout(() => {
        hideChatbotIcon();
    }, 30000); // 30000ms = 30秒
})();
