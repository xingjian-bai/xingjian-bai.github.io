/* Xingjian Bai — site.js
 * Minimal, framework-free.
 * Features:
 *  - theme (dark/light) toggle with localStorage + dark default
 *  - bibtex toggle for each paper
 *  - publications filter toggle (Selected / All)
 *  - mobile nav toggle
 *  - scroll-spy to highlight active nav link
 */
(function () {
    'use strict';

    // ---------- Theme ----------
    var root = document.documentElement;
    var themeBtn = document.querySelector('[data-theme-toggle]');

    function applyTheme(t) {
        if (t === 'dark' || t === 'light') {
            root.setAttribute('data-theme', t);
        } else {
            root.removeAttribute('data-theme');
        }
        if (themeBtn) {
            var isDark = t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
            themeBtn.textContent = isDark ? '☀' : '☾';
            themeBtn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
        }
    }
    applyTheme(localStorage.getItem('theme') || 'dark');

    if (themeBtn) {
        themeBtn.addEventListener('click', function () {
            var current = root.getAttribute('data-theme');
            var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            var next;
            if (!current) next = systemDark ? 'light' : 'dark';
            else if (current === 'dark') next = 'light';
            else next = 'dark';
            localStorage.setItem('theme', next);
            applyTheme(next);
        });
    }

    // ---------- Bibtex ----------
    document.querySelectorAll('[data-bibtex-toggle]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-bibtex-toggle');
            var box = document.getElementById(id);
            if (!box) return;
            var isOpen = box.hasAttribute('open');
            if (isOpen) box.removeAttribute('open');
            else box.setAttribute('open', '');
            btn.setAttribute('aria-expanded', String(!isOpen));
        });
    });

    // ---------- Publications filter (Selected / All) ----------
    var pubToggle = document.querySelector('.pub-toggle');
    var pubList = document.querySelector('.pub-list[data-view]');
    if (pubToggle && pubList) {
        pubToggle.addEventListener('click', function (e) {
            var btn = e.target.closest('button[data-view]');
            if (!btn) return;
            var view = btn.getAttribute('data-view');
            pubList.setAttribute('data-view', view);
            pubToggle.querySelectorAll('button[data-view]').forEach(function (b) {
                var on = b === btn;
                b.classList.toggle('active', on);
                b.setAttribute('aria-selected', String(on));
            });
        });
    }

    // ---------- Mobile nav ----------
    var navToggle = document.querySelector('.nav-toggle');
    var navList = document.getElementById('nav-list');
    if (navToggle && navList) {
        navToggle.addEventListener('click', function () {
            navList.classList.toggle('open');
            var expanded = navToggle.getAttribute('aria-expanded') === 'true';
            navToggle.setAttribute('aria-expanded', String(!expanded));
        });
        navList.addEventListener('click', function (e) {
            if (e.target.closest('a')) navList.classList.remove('open');
        });
    }

    // ---------- Scroll spy ----------
    var sections = Array.from(document.querySelectorAll('main section[id]'));
    var navLinks = Array.from(document.querySelectorAll('.nav a.navlink'));
    function setActive() {
        var y = window.scrollY + 90;
        var current = sections[0] && sections[0].id;
        sections.forEach(function (s) { if (s.offsetTop <= y) current = s.id; });
        navLinks.forEach(function (a) {
            a.classList.toggle('active', a.getAttribute('href') === '#' + current);
        });
    }
    window.addEventListener('scroll', setActive, { passive: true });
    setActive();
})();
