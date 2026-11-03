/**
 * MCP Apps view (ADR 0027): hosts such as Claude, ChatGPT and VS Code show Open Media's tool results
 * as Open Media itself looks, black and white and content first, instead of raw JSON. One view
 * recognises what it was given: posts and web-feed items, the person's inbox with unread dots and
 * receipts, their feed algorithm with its code, events, a profile, or anything else as a tidy list.
 *
 * Safety: the view loads nothing from elsewhere and makes no network calls. It receives the tool
 * result from the host over postMessage, builds every node with textContent (never HTML from data),
 * and asks the host to open links, which the host may confirm with the person.
 */
export const appViewUri = 'ui://open-media/view';
/** The first view's address, kept so hosts that cached it still get the current view. */
export const postsViewUri = 'ui://open-media/posts';
export const mcpAppMimeType = 'text/html;profile=mcp-app';

export const appViewHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Open Media</title>
<style>
:root{--fg:#111;--fg2:#555;--fg3:#8a8a86;--line:#e7e7e3;--chip:#f3f3f0;--card:#fff;--bg:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--fg:#f6f6f2;--fg2:#b8b8b3;--fg3:#7d7d78;--line:#262624;--chip:#1a1a18;--card:#0e0e0d;--bg:#0e0e0d}}
:root[data-theme=dark]{--fg:#f6f6f2;--fg2:#b8b8b3;--fg3:#7d7d78;--line:#262624;--chip:#1a1a18;--card:#0e0e0d;--bg:#0e0e0d}
:root[data-theme=dark]{color-scheme:dark}:root[data-theme=light]{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;padding:8px 6px 12px;border-radius:12px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Inter","Segoe UI",system-ui,sans-serif;letter-spacing:-.01em;color:var(--fg);background:var(--bg);-webkit-font-smoothing:antialiased}
.head{display:flex;align-items:center;gap:8px;padding:2px 6px 10px;color:var(--fg2);font-size:12px;font-weight:600}
.mark{width:16px;height:16px;border-radius:50%;background:var(--fg);display:inline-block;position:relative}
.mark:after{content:"";position:absolute;inset:4px;border-radius:50%;background:var(--card)}
.list{display:flex;flex-direction:column}
.item{padding:12px 6px;border-top:1px solid var(--line)}.item:first-child{border-top:0}
.row{display:flex;align-items:center;gap:10px;min-width:0}
.avatar{flex:none;width:32px;height:32px;border-radius:50%;background:var(--fg);color:var(--card);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700}
.who{min-width:0;flex:1}.name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub{color:var(--fg3);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.title{margin:8px 0 2px;font-size:15px;font-weight:700;line-height:1.35}
.text{margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--fg)}
.text.muted{color:var(--fg2)}
.foot{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-top:10px;flex-wrap:wrap}
.stats{margin-right:auto;color:var(--fg3);font-size:12px}
.pill{appearance:none;border:1px solid var(--line);background:transparent;color:var(--fg);border-radius:999px;padding:5px 11px 5px 12px;font-family:inherit;font-size:12px;font-weight:600;line-height:1.2;cursor:pointer;white-space:nowrap}
.pill:hover{background:var(--chip)}
.why{color:var(--fg3);font-size:12px;margin-top:8px}
.dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--fg)}
.time{flex:none;color:var(--fg3);font-size:12px}
.tick{color:var(--fg3);font-size:12px;white-space:nowrap}.tick.read{color:var(--fg)}
.badge{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;background:var(--chip);color:var(--fg2);font-size:11px;font-weight:600}
.code{margin:10px 6px 0;padding:12px;border-radius:12px;background:var(--chip);font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fg2);white-space:pre;overflow:auto}
.rules{margin:6px 6px 0;padding:0;list-style:none}.rules li{color:var(--fg2);padding:2px 0}.rules li:before{content:"·  "}
.when{font-size:12px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:var(--fg2)}
.empty{color:var(--fg3);padding:16px 6px}
.kv{display:grid;grid-template-columns:minmax(90px,30%) 1fr;gap:4px 12px;padding:4px 6px}.kv dt{color:var(--fg3)}.kv dd{margin:0;overflow-wrap:anywhere}
</style>
</head>
<body>
<div class="head"><span class="mark" aria-hidden="true"></span><span id="heading">Open Media</span></div>
<main id="root" aria-live="polite"><p class="empty">Loading…</p></main>
<script>
(function () {
  var nextId = 1, pending = {};
  function send(method, params) { var id = nextId++; window.parent.postMessage({ jsonrpc: '2.0', id: id, method: method, params: params || {} }, '*'); return new Promise(function (resolve) { pending[id] = resolve; }); }
  function notify(method, params) { window.parent.postMessage({ jsonrpc: '2.0', method: method, params: params || {} }, '*'); }
  function el(tag, className, text) { var node = document.createElement(tag); if (className) node.className = className; if (text != null && text !== '') node.textContent = String(text); return node; }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function initials(name) { var parts = String(name || '?').replace(/^@/, '').trim().split(/\\s+/); return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase(); }
  function ago(iso) { var t = Date.parse(iso); if (!t) return ''; var m = Math.round((Date.now() - t) / 60000); if (m < 1) return 'now'; if (m < 60) return m + 'm'; var h = Math.round(m / 60); if (h < 24) return h + 'h'; var d = Math.round(h / 24); return d < 30 ? d + 'd' : new Date(t).toLocaleDateString(); }
  var names = { 'open-media': 'Open Media', farcaster: 'Farcaster', lens: 'Lens', hive: 'Hive', deso: 'DeSo', events: 'Events', rss: 'Web feed' };
  function network(id) { return names[id] || id || ''; }
  function host(url) { try { return new URL(url).hostname.replace(/^www\\./, ''); } catch (_) { return ''; } }
  function openPill(label, url) { if (!url) return null; var b = el('button', 'pill', label + ' \\u2197'); b.type = 'button'; b.addEventListener('click', function () { send('ui/open-link', { url: url }); }); return b; }
  function person(name, sub, avatarText) { var row = el('div', 'row'); add(row, el('div', 'avatar', avatarText || initials(name)), add(el('div', 'who'), el('div', 'name', name), sub ? el('div', 'sub', sub) : null)); return row; }

  function dataOf(result) {
    var data = result && result.structuredContent;
    if (!data && result && result.content && result.content[0] && result.content[0].text) { try { data = JSON.parse(result.content[0].text); } catch (_) {} }
    return data;
  }

  function renderPosts(root, posts) {
    var list = el('div', 'list');
    posts.slice(0, 50).forEach(function (post) {
      var item = el('article', 'item'); var author = post.author || {}; var feed = post.webFeed || post.feed;
      var sub = [author.handle, ago(post.createdAt), network(post.network)].filter(Boolean).join(' \\u00b7 ');
      add(item, person(feed && feed.siteName ? feed.siteName : (author.name || author.handle || 'Someone'), sub));
      if (post.title) add(item, el('p', 'title', post.title));
      if (post.text) add(item, el('p', 'text' + (post.title ? ' muted' : ''), String(post.text).slice(0, 700)));
      var foot = el('div', 'foot');
      if (post.engagement) add(foot, el('span', 'stats', post.engagement.replies + ' replies \\u00b7 ' + post.engagement.reposts + ' reposts \\u00b7 ' + post.engagement.likes + ' likes'));
      var isOpen = post.network === 'open-media';
      add(foot, openPill(feed || post.network === 'rss' ? 'Read on ' + host(post.url) : isOpen ? 'Open in Open Media' : 'Open on ' + network(post.network), post.url));
      if (foot.childNodes.length) add(item, foot);
      if (post.why && post.why.used && post.why.used.length) add(item, el('div', 'why', 'Why this: ' + post.why.used.join(' \\u00b7 ')));
      list.appendChild(item);
    });
    add(root, list);
  }

  function receipt(message) {
    if (message.from !== 'me' || !message.receipt) return null;
    var map = { sending: '\\u23f2 Sending', sent: '\\u2713 Sent', delivered: '\\u2713\\u2713 Delivered', read: '\\u2713\\u2713 Read', failed: '! Not sent' };
    return el('span', 'tick' + (message.receipt === 'read' ? ' read' : ''), map[message.receipt] || '');
  }

  function renderInbox(root, conversations) {
    var list = el('div', 'list');
    conversations.slice(0, 40).forEach(function (conversation) {
      var item = el('article', 'item'); var messages = conversation.messages || []; var last = messages[messages.length - 1] || {};
      var row = el('div', 'row');
      add(row, el('div', 'avatar', initials(conversation.title)), add(el('div', 'who'), el('div', 'name', conversation.title || 'Conversation'), el('div', 'sub', (last.from === 'me' ? 'You: ' : '') + (last.body || ''))));
      var side = el('div', 'row'); add(side, el('span', 'time', ago(last.sentAt || conversation.updatedAt)), conversation.unread ? el('span', 'dot', '') : null);
      add(row, side); add(item, row);
      var tick = receipt(last); if (tick) add(item, add(el('div', 'foot'), tick));
      list.appendChild(item);
    });
    add(root, list);
  }

  function renderLens(root, data) {
    var lens = data.lens || data.manifest || data;
    var title = el('p', 'title', (lens.name || 'Feed algorithm') + (lens.version ? '' : ''));
    if (lens.version) add(title, el('span', 'badge', 'version ' + lens.version));
    add(root, add(el('div', 'item'), title, lens.description ? el('p', 'text muted', lens.description) : null));
    var rules = data.rules || (data.lens && data.lens.rules);
    if (rules && rules.length) { var ul = el('ul', 'rules'); rules.forEach(function (rule) { add(ul, el('li', '', rule)); }); add(root, ul); }
    var changes = data.changes || data.understood; if (changes && changes.length) add(root, el('p', 'why', 'Changed: ' + changes.join(' \\u00b7 ')));
    var manifest = data.manifest || lens; var copy = {}; Object.keys(manifest).forEach(function (key) { if (key !== 'rules' && key !== 'author' && key !== 'builtIn') copy[key] = manifest[key]; });
    add(root, el('div', 'why', 'The code that runs this feed:'), el('pre', 'code', JSON.stringify(copy, null, 2)));
  }

  function renderEvents(root, events) {
    var list = el('div', 'list');
    events.slice(0, 40).forEach(function (event) {
      var item = el('article', 'item'); var when = Date.parse(event.startsAt);
      add(item, el('div', 'when', when ? new Date(when).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''), el('p', 'title', event.title));
      var where = [event.place, event.online ? 'Online' : '', event.free ? 'Free' : event.priceText].filter(Boolean).join(' \\u00b7 '); if (where) add(item, el('p', 'text muted', where));
      var url = event.registrationUrl || (event.sources && event.sources[0] && event.sources[0].url); var foot = el('div', 'foot'); add(foot, openPill('Register on ' + host(url), url)); if (foot.childNodes.length) add(item, foot);
      list.appendChild(item);
    });
    add(root, list);
  }

  function renderProfile(root, profile) {
    var item = el('article', 'item');
    add(item, person(profile.displayName || profile.name || profile.handle, profile.handle ? '@' + String(profile.handle).replace(/^@/, '') : ''));
    if (profile.bio) add(item, el('p', 'text muted', profile.bio));
    var foot = el('div', 'foot'); add(foot, openPill('Open profile', profile.url)); if (foot.childNodes.length) add(item, foot);
    add(root, item);
  }

  function renderOther(root, data) {
    var dl = el('dl', 'kv');
    Object.keys(data).slice(0, 30).forEach(function (key) { var value = data[key]; add(dl, el('dt', '', key), el('dd', '', typeof value === 'object' ? JSON.stringify(value).slice(0, 300) : String(value))); });
    add(root, dl);
  }

  function render(result) {
    var root = document.getElementById('root'); root.textContent = ''; var heading = document.getElementById('heading');
    var data = dataOf(result);
    if (!data) { add(root, el('p', 'empty', 'Nothing to show.')); return; }
    var items = Array.isArray(data) ? data : data.data || data.posts || data.items || (data.results && data.results.posts) || null;
    if (items && items.length && items[0] && items[0].messages) { heading.textContent = 'Your inbox'; renderInbox(root, items); return; }
    if (items && items.length && items[0] && items[0].startsAt) { heading.textContent = 'Upcoming events'; renderEvents(root, items); return; }
    if (items && items.length && items[0] && (items[0].text != null || items[0].author)) { heading.textContent = 'Open Media'; renderPosts(root, items); return; }
    if (items && !items.length) { add(root, el('p', 'empty', 'Nothing here yet.')); return; }
    if (data.format && String(data.format).indexOf('feed-lens') >= 0 || data.manifest || (data.lens && data.lens.format)) { heading.textContent = 'Your algorithm'; renderLens(root, data); return; }
    if (data.handle && (data.displayName || data.bio !== undefined)) { heading.textContent = 'Profile'; renderProfile(root, data); return; }
    renderOther(root, data);
  }

  window.addEventListener('message', function (event) {
    var message = event.data; if (!message || message.jsonrpc !== '2.0') return;
    if (message.id && pending[message.id]) { pending[message.id](message.result); delete pending[message.id]; return; }
    if (message.method === 'ui/notifications/tool-result') render(message.params);
    if (message.method === 'ui/notifications/host-context-changed') theme(message.params);
  });
  // Follow the host's light or dark theme when it says which; otherwise the device setting decides.
  function theme(context) { var value = context && (context.theme || (context.hostContext && context.hostContext.theme)); if (value === 'light' || value === 'dark') document.documentElement.setAttribute('data-theme', value); }
  send('ui/initialize', { appInfo: { name: 'open-media', version: '2.0.0' }, appCapabilities: {}, protocolVersion: '2026-01-26' }).then(function (result) { theme(result); notify('ui/notifications/initialized'); });
})();
</script>
</body>
</html>`;

/** Kept for hosts that load the first view's export by name. */
export const postsViewHtml = appViewHtml;
