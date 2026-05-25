#!/usr/bin/env python3
"""Safe RSS fixes: icon, mobile nav, rssList helper, check route"""
src = open('src/server.ts').read()

# 1. Add rss icon (after 'no' icon)
old = '  no: svg(`<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`),\n  zz: svg('
new = '  no: svg(`<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`),\n  rss: svg(`<path d="M4 11a9 9 0 019 9"/><path d="M4 4a16 16 0 0116 16"/><circle cx="5" cy="19" r="1"/>`),\n  zz: svg('
assert old in src, "rss icon insert point not found"
src = src.replace(old, new, 1)
print("[1/4] RSS icon added")

# 2. Add RSS tab to mobile nav
old = '  <a href="/downloads" class="${nav===\'d\'?\'active\':\'\'}">${I.dl2}<span>${t("dl",lang)}</span></a>\n  <a href="/settings" class="${nav===\'s\'?\'active\':\'\'}">${I.zz}<span>${lang===\'zh\'?\'设置\':\'Settings\'}</span></a>'
new = '  <a href="/downloads" class="${nav===\'d\'?\'active\':\'\'}">${I.dl2}<span>${t("dl",lang)}</span></a>\n  <a href="/rss" class="${nav===\'r\'?\'active\':\'\'}">${I.rss}<span>RSS</span></a>\n  <a href="/settings" class="${nav===\'s\'?\'active\':\'\'}">${I.zz}<span>${lang===\'zh\'?\'设置\':\'Settings\'}</span></a>'
assert old in src, "mobile nav insert point not found"
src = src.replace(old, new, 1)
print("[2/4] RSS mobile tab added")

# 3. Add rssList after rssPage ending
old = '  ${subs.length ? `<div class="bento-p"><div class="bento-b stagger">${items}</div></div>` : `<div class="emp"><div class="emp-icon">${I.dl2}</div><div class="emp-t">${t("rss_none",lang)}</div></div>`}\n</div></div>`;\n}\n\nfunction settingsPage('
new_fn = '  ${subs.length ? `<div class="bento-p"><div class="bento-b stagger">${items}</div></div>` : `<div class="emp"><div class="emp-icon">${I.dl2}</div><div class="emp-t">${t("rss_none",lang)}</div></div>`}\n</div></div>`;\n}\n\nfunction rssList(lang, subs, msg) {\n  var _l = lang;\n  var items = subs.map(function(s, i) {\n    return \'<div class="li" style="animation:slideUp .3s var(--ease) both;animation-delay:\' + (i*40) + \'ms">\' +\n      \'<div class="li-th" style="background:var(--accent-dim);color:var(--accent);font-family:var(--mono);font-size:.65rem">RSS</div>\' +\n      \'<div class="li-bd">\' +\n      \'<div class="li-t">\' + esc(s.name && s.name !== s.user_id ? s.name : s.user_id) + \'</div>\' +\n      \'<div class="li-m" style="font-family:var(--mono);font-size:.65rem">#\' + s.user_id + \' &middot; \' + (_l===\'zh\'?\'共\':\'Total\') + \' \' + s.last_count + \' \' + (_l===\'zh\'?\'部\':\'videos\') + \'</div>\' +\n      \'</div>\' +\n      \'<div class="li-act" style="display:flex;gap:4px">\' +\n      \'<button class="btn btn-xs btn-p" hx-post="/api/rss/check/\' + s.user_id + \'" hx-target="#rss-body" hx-indicator="closest .li">\' + (_l===\'zh\'?\'检查\':\'Check\') + \'</button>\' +\n      \'<button class="btn btn-xs btn-g" hx-post="/api/rss/remove/\' + s.user_id + \'" hx-target="#rss-body" style="color:var(--accent);border-color:var(--accent-dim)">x</button>\' +\n      \'</div>\' +\n      \'</div>\';\n  });\n  return (msg ? \'<div style="background:var(--green-dim);color:var(--green);padding:10px 16px;border-radius:var(--r-sm);font-size:.75rem;margin-bottom:14px;border:1px solid var(--green);font-family:var(--mono)">\' + msg + \'</div>\' : \'\') +\n    (subs.length ? \'<div class="bento-p"><div class="bento-b stagger">\' + items.join(\'\') + \'</div></div>\' : \'<div class="emp"><div class="emp-icon">\' + I.dl2 + \'</div><div class="emp-t">\' + t("rss_none",lang) + \'</div></div>\');\n}\n\nfunction settingsPage('
assert old in src, "rssPage end not found"
src = src.replace(old, new_fn, 1)
print("[3/4] rssList function added")

# 4. Make check route use rssList
old = '  return new Response(rssPage(l, subs, msg), { headers: { "Content-Type": "text/html" } });\n});\napp.post("/api/rss/remove'
new = '  return new Response(rssList(l, subs, msg), { headers: { "Content-Type": "text/html" } });\n});\napp.post("/api/rss/remove'
assert old in src, "check route not found"
src = src.replace(old, new, 1)
print("[4/4] check route uses rssList")

open('src/server.ts', 'w').write(src)
print("DONE - all 4 changes applied")
