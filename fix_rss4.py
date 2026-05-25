#!/usr/bin/env python3
src = open('src/server.ts').read()

# The actual file has escaped quotes like class=\"li\"
old = '''  ${subs.length ? `<div class=\\"bento-p\\"><div class=\\"bento-b stagger\\">${items}</div></div>` : `<div class=\\"emp\\"><div class=\\"emp-icon\\">${I.dl2}</div><div class=\\"emp-t\\">${t(\\"rss_none\\",lang)}</div></div>`}
</div></div>`;
}

function settingsPage('''

new_fn = '''  ${subs.length ? `<div class=\\"bento-p\\"><div class=\\"bento-b stagger\\">${items}</div></div>` : `<div class=\\"emp\\"><div class=\\"emp-icon\\">${I.dl2}</div><div class=\\"emp-t\\">${t(\\"rss_none\\",lang)}</div></div>`}
</div></div>`;
}

function rssList(lang, subs, msg) {
  var _l = lang;
  var items = subs.map(function(s, i) {
    return '<div class="li" style="animation:slideUp .3s var(--ease) both;animation-delay:' + (i*40) + 'ms">' +
      '<div class="li-th" style="background:var(--accent-dim);color:var(--accent);font-family:var(--mono);font-size:.65rem">RSS</div>' +
      '<div class="li-bd">' +
      '<div class="li-t">' + esc(s.name && s.name !== s.user_id ? s.name : s.user_id) + '</div>' +
      '<div class="li-m" style="font-family:var(--mono);font-size:.65rem">#' + s.user_id + ' &middot; ' + (_l==='zh'?'共':'Total') + ' ' + s.last_count + ' ' + (_l==='zh'?'部':'videos') + '</div>' +
      '</div>' +
      '<div class="li-act" style="display:flex;gap:4px">' +
      '<button class="btn btn-xs btn-p" hx-post="/api/rss/check/' + s.user_id + '" hx-target="#rss-body" hx-indicator="closest .li">' + (_l==='zh'?'检查':'Check') + '</button>' +
      '<button class="btn btn-xs btn-g" hx-post="/api/rss/remove/' + s.user_id + '" hx-target="#rss-body" style="color:var(--accent);border-color:var(--accent-dim)">x</button>' +
      '</div>' +
      '</div>';
  });
  return (msg ? '<div style="background:var(--green-dim);color:var(--green);padding:10px 16px;border-radius:var(--r-sm);font-size:.75rem;margin-bottom:14px;border:1px solid var(--green);font-family:var(--mono)">' + msg + '</div>' : '') +
    (subs.length ? '<div class="bento-p"><div class="bento-b stagger">' + items.join('') + '</div></div>' : '<div class="emp"><div class="emp-icon">' + I.dl2 + '</div><div class="emp-t">' + t("rss_none",lang) + '</div></div>');
}

function settingsPage('''

assert old in src, f"old not found"
src = src.replace(old, new_fn, 1)
print("[3/4] rssList inserted")

# 4. Fix check route
old2 = '  return new Response(rssPage(l, subs, msg), { headers: { "Content-Type": "text/html" } });\n});\napp.post("/api/rss/remove'
new2 = '  return new Response(rssList(l, subs, msg), { headers: { "Content-Type": "text/html" } });\n});\napp.post("/api/rss/remove'
assert old2 in src, "check route not found"
src = src.replace(old2, new2, 1)
print("[4/4] check route updated")

open('src/server.ts', 'w').write(src)
print("DONE")
