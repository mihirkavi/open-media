/**
 * MCP Apps view (ui://open-media/posts): hosts such as Claude and ChatGPT can show the results of
 * get_feed and search as a readable list of posts instead of raw JSON. The view makes no network
 * calls and loads nothing from elsewhere: it receives the tool result from the host over
 * postMessage, renders it with textContent only, and asks the host to open source links.
 */
export const postsViewUri = 'ui://open-media/posts';
export const mcpAppMimeType = 'text/html;profile=mcp-app';

export const postsViewHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Open Media posts</title>
<style>
:root{--fg:#111;--muted:#666;--line:#e6e6e6;--bg:transparent}
@media (prefers-color-scheme:dark){:root{--fg:#f2f2f2;--muted:#a8a8a8;--line:#2c2c2c}}
body{margin:0;padding:8px 4px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;color:var(--fg);background:var(--bg)}
article{padding:10px 4px;border-bottom:1px solid var(--line)}article:last-child{border-bottom:0}
.meta{color:var(--muted);font-size:12px;margin-bottom:4px}.title{font-weight:600;margin:0 0 2px}
.text{white-space:pre-wrap;word-wrap:break-word;margin:0}.why{color:var(--muted);font-size:12px;margin-top:4px}
a{color:inherit}.empty{color:var(--muted);padding:12px 4px}
</style>
</head>
<body>
<main id="posts" aria-live="polite"><p class="empty">Waiting for posts…</p></main>
<script>
(function () {
  var nextId = 1;
  var pending = {};
  function send(method, params) {
    var id = nextId++;
    window.parent.postMessage({ jsonrpc: '2.0', id: id, method: method, params: params || {} }, '*');
    return new Promise(function (resolve) { pending[id] = resolve; });
  }
  function notify(method, params) { window.parent.postMessage({ jsonrpc: '2.0', method: method, params: params || {} }, '*'); }
  function el(tag, className, text) { var node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; }
  function postsFrom(result) {
    var data = result && result.structuredContent;
    if (!data && result && result.content && result.content[0] && result.content[0].text) { try { data = JSON.parse(result.content[0].text); } catch (_) {} }
    if (!data) return [];
    return data.data || data.posts || (data.results && data.results.posts) || [];
  }
  function render(result) {
    var root = document.getElementById('posts');
    root.textContent = '';
    var posts = postsFrom(result);
    if (!posts.length) { root.appendChild(el('p', 'empty', 'No posts to show.')); return; }
    posts.slice(0, 50).forEach(function (post) {
      var item = el('article');
      var author = post.author || {};
      item.appendChild(el('div', 'meta', [author.name, author.handle, post.network].filter(Boolean).join(' · ')));
      if (post.title) item.appendChild(el('p', 'title', post.title));
      item.appendChild(el('p', 'text', String(post.text || '').slice(0, 600)));
      if (post.url) {
        var link = el('a', '', 'Open source');
        link.href = post.url;
        link.addEventListener('click', function (event) { event.preventDefault(); send('ui/open-link', { url: post.url }); });
        item.appendChild(link);
      }
      if (post.why && post.why.used && post.why.used.length) item.appendChild(el('div', 'why', 'Why this: ' + post.why.used.join('; ')));
      root.appendChild(item);
    });
  }
  window.addEventListener('message', function (event) {
    var message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;
    if (message.id && pending[message.id]) { pending[message.id](message.result); delete pending[message.id]; return; }
    if (message.method === 'ui/notifications/tool-result') render(message.params);
  });
  send('ui/initialize', { appInfo: { name: 'open-media-posts', version: '1.0.0' }, appCapabilities: {}, protocolVersion: '2026-01-26' })
    .then(function () { notify('ui/notifications/initialized'); });
})();
</script>
</body>
</html>`;
