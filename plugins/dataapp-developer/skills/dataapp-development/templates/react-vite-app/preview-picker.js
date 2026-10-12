// Lets the user pick a part of the page in Keboola's app preview. Injected into <head> by vite.config.ts in dev.
// - Announces `kai-preview-picker-ready` on load and again on `kai-preview-picker-ping`.
// - Parent → page: `kai-preview-pick-start`, `kai-preview-pick-stop`, `kai-preview-pick-clear` (drops the marker).
// - Page → parent: `kai-preview-picked` with the part's context, `kai-preview-pick-cancelled` on Escape.
// - The context names where the part's JSX is written (`data-kai-source`, stamped by preview-source.js).
// - Only the embedding parent is obeyed or told anything.
(function () {
  if (window.parent === window || window.__kaiPreviewPicker) return;
  window.__kaiPreviewPicker = true;

  var MAX_TEXT = 300;
  var MAX_HTML = 2000;
  var MAX_SELECTOR = 1000;
  var MAX_TRAIL = 4;
  var COLOR = '#1f8fff';

  // The embedding parent's origin, fixed for the life of the page.
  var parentOrigin = (function () {
    try {
      var a = window.location.ancestorOrigins;
      if (a && a.length) return a[0];
      if (document.referrer) return new URL(document.referrer).origin;
    } catch (e) {}
    return '*';
  })();
  function post(message) {
    try {
      window.parent.postMessage(message, parentOrigin);
    } catch (e) {
      console.warn('[kai-preview] picker postMessage failed', e);
    }
  }

  // An outline only: what the part is called is the Builder's to say, not a label over the page.
  function box() {
    var el = document.createElement('div');
    el.setAttribute('data-kai-picker', '');
    el.style.cssText =
      'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;display:none;' +
      'border:2px solid ' + COLOR + ';border-radius:3px;background:rgba(31,143,255,.08);';
    return el;
  }
  var hoverBox = box();
  var markBox = box();
  markBox.style.borderStyle = 'dashed';

  function place(el, target) {
    if (!target || !target.isConnected) {
      el.style.display = 'none';
      return;
    }
    var r = target.getBoundingClientRect();
    el.style.display = 'block';
    el.style.left = r.left + 'px';
    el.style.top = r.top + 'px';
    el.style.width = r.width + 'px';
    el.style.height = r.height + 'px';
  }

  // Distinct sources from the part outwards: where a shared component is used, not only written.
  function sourceTrail(el) {
    var trail = [];
    for (var node = el; node && trail.length < MAX_TRAIL; node = node.parentElement) {
      var s = node.getAttribute && node.getAttribute('data-kai-source');
      if (s && trail.indexOf(s) === -1) trail.push(s);
    }
    return trail;
  }
  function selectorOf(el) {
    var parts = [];
    for (var node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) {
        parts.unshift('#' + CSS.escape(node.id));
        break;
      }
      var part = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (c) {
          return c.tagName === node.tagName;
        });
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
    }
    return parts.join(' > ');
  }
  function clip(text, max) {
    return text.length > max ? text.slice(0, max) + '…' : text;
  }
  function describe(el) {
    var r = el.getBoundingClientRect();
    // Cut before cleaning: a picked container can serialise to megabytes.
    var html = el.outerHTML.slice(0, MAX_HTML * 4).replace(/\sdata-kai-source="[^"]*"/g, '');
    var trail = sourceTrail(el);
    return {
      source: trail[0] || null,
      sourceTrail: trail,
      selector: clip(selectorOf(el), MAX_SELECTOR),
      tag: el.tagName.toLowerCase(),
      text: clip((el.textContent || '').slice(0, MAX_TEXT * 4).replace(/\s+/g, ' ').trim(), MAX_TEXT),
      html: clip(html, MAX_HTML),
      rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
      page: location.pathname + location.search + location.hash,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }

  var picking = false;
  var hovered = null;
  var marked = null;

  function targetOf(ev) {
    var el = ev.target;
    if (!el || el.nodeType !== 1 || el === document.documentElement || el === document.body) return null;
    return el;
  }
  function onMove(ev) {
    var el = targetOf(ev);
    if (el === hovered) return;
    hovered = el;
    place(hoverBox, hovered);
  }
  function block(ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  function onClick(ev) {
    block(ev);
    var el = targetOf(ev);
    if (!el) return;
    stop();
    marked = el;
    place(markBox, marked);
    post({ type: 'kai-preview-picked', selection: describe(el) });
  }
  function onKey(ev) {
    if (ev.key !== 'Escape') return;
    block(ev);
    stop();
    post({ type: 'kai-preview-pick-cancelled' });
  }
  // Swallowed while picking, so the page reacts to none of the gestures that pick.
  var LISTENERS = [
    ['mousemove', onMove],
    ['click', onClick],
    ['keydown', onKey],
  ].concat(
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu', 'submit'].map(function (type) {
      return [type, block];
    }),
  );
  function listen(on) {
    LISTENERS.forEach(function (entry) {
      window[on ? 'addEventListener' : 'removeEventListener'](entry[0], entry[1], true);
    });
  }

  function start() {
    if (picking) return;
    picking = true;
    if (!hoverBox.isConnected) document.documentElement.append(hoverBox, markBox);
    document.documentElement.style.cursor = 'crosshair';
    listen(true);
  }
  function stop() {
    if (!picking) return;
    picking = false;
    hovered = null;
    place(hoverBox, null);
    document.documentElement.style.cursor = '';
    listen(false);
  }
  function follow() {
    if (hovered) place(hoverBox, hovered);
    if (marked) place(markBox, marked);
  }
  window.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);

  window.addEventListener('message', function (ev) {
    if (ev.source !== window.parent || !ev.data) return;
    if (parentOrigin !== '*' && ev.origin !== parentOrigin) return;
    switch (ev.data.type) {
      case 'kai-preview-picker-ping':
        return post({ type: 'kai-preview-picker-ready' });
      case 'kai-preview-pick-start':
        return start();
      case 'kai-preview-pick-stop':
        return stop();
      case 'kai-preview-pick-clear':
        marked = null;
        return place(markBox, null);
    }
  });
  post({ type: 'kai-preview-picker-ready' });
})();
