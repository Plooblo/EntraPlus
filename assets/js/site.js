/* EntraPlus site behaviour. No libraries: everything here is plain JavaScript. */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var CONFIG = window.EP_CONFIG || {};
  var TOOLKIT = window.TOOLKIT || [];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- toast + copy ---------- */
  var toastTimer;
  function toast(text) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }
  window.epToast = toast;

  function copyText(text, button) {
    function done() {
      if (button) {
        var label = button.textContent;
        button.textContent = "Copied";
        button.setAttribute("data-done", "");
        setTimeout(function () { button.textContent = label; button.removeAttribute("data-done"); }, 1500);
      }
      toast("Copied to clipboard");
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("Select the text and press Ctrl+C"); }
      document.body.removeChild(ta);
    }
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest(".copy");
    if (!b) return;
    var target = b.getAttribute("data-copy-target");
    var text = target ? document.getElementById(target).textContent : b.getAttribute("data-copy");
    copyText(text, b);
  });

  /* ---------- tiny PowerShell / HTTP highlighter ---------- */
  function highlight(code) {
    return code.split("\n").map(function (line) {
      var html = esc(line);
      if (/^\s*#/.test(line) || /^\s*\(/.test(line)) return '<span class="c-dim">' + html + "</span>";
      html = html.replace(/^(GET|POST|PATCH|DELETE)\b/, '<span class="c-verb">$1</span>');
      html = html.replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, '<span class="c-str">$1</span>');
      html = html.replace(/(^|[\s(|{;])([A-Z][a-z]+-[A-Za-z]+)(?=[\s`]|$)/g, '$1<span class="c-cmd">$2</span>');
      html = html.replace(/(\s)(-[A-Za-z]+)(?=[\s:]|$)/g, '$1<span class="c-param">$2</span>');
      html = html.replace(/(\$[A-Za-z_][\w.]*)/g, '<span class="c-var">$1</span>');
      return html;
    }).join("\n");
  }

  /* ---------- theme, menu, year ---------- */
  var root = document.documentElement;
  var themeBtn = $("#theme-toggle");
  function syncThemeButton() {
    if (!themeBtn) return;
    var dark = root.dataset.theme === "dark";
    themeBtn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
  if (themeBtn) {
    syncThemeButton();
    themeBtn.addEventListener("click", function () {
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem("ep-theme", root.dataset.theme); } catch (e) {}
      syncThemeButton();
    });
  }
  var menuBtn = $(".menu-btn"), nav = $("#site-nav");
  if (menuBtn && nav) {
    menuBtn.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", String(open));
      menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) { nav.classList.remove("open"); menuBtn.setAttribute("aria-expanded", "false"); }
    });
  }
  var year = $("#year");
  if (year) year.textContent = new Date().getFullYear();

  /* ---------- downloads from config ---------- */
  $$("[data-download]").forEach(function (a) {
    var url = (CONFIG.downloads || {})[a.getAttribute("data-download")];
    if (url) a.href = url;
  });

  /* ---------- accessible tabs (arrow keys, Home, End) ---------- */
  function setupTabs(list, onSelect) {
    var tabs = $$('[role="tab"]', list);
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
      });
      var panel = document.getElementById(tab.getAttribute("aria-controls"));
      if (panel) panel.setAttribute("aria-labelledby", tab.id);
      if (focus) tab.focus();
      onSelect(tab);
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { select(tab, false); });
      tab.addEventListener("keydown", function (e) {
        var next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        select(tabs[(next + tabs.length) % tabs.length], true);
      });
    });
  }

  /* ---------- search shared by the hero and the explorer ---------- */
  var SYNONYMS = {
    offboard: "leaver", offboarding: "leaver", onboard: "starter", onboarding: "starter", joiner: "starter",
    mfa: "policy", "conditional": "policy", recovery: "bitlocker", laptop: "device", ipad: "device",
    lock: "unlock", locked: "unlock", alias: "aliases", email: "aliases", mailbox: "shared", dl: "distribution",
    licence: "licences", license: "licences", csv: "export", admin: "laps", reboot: "restart"
  };
  function tokens(q) {
    return q.toLowerCase().split(/\s+/).filter(Boolean).map(function (t) { return SYNONYMS[t] || t; });
  }
  function haystack(item) {
    return (item.title + " " + item.summary + " " + item.area + " " + item.platform + " " + item.method + " " +
            item.call + " " + item.ps + " " + item.http).toLowerCase();
  }
  TOOLKIT.forEach(function (item) { item._hay = haystack(item); item._title = item.title.toLowerCase(); });
  function score(item, toks) {
    var s = 0;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (item._hay.indexOf(t) === -1) return 0;
      s += 1;
      if (item._title.indexOf(t) !== -1) s += 5;
      if (item._title.indexOf(t) === 0) s += 3;
    }
    return s;
  }
  function search(q) {
    var toks = tokens(q);
    if (!toks.length) return TOOLKIT.slice();
    return TOOLKIT.map(function (it) { return { it: it, s: score(it, toks) }; })
      .filter(function (r) { return r.s > 0; })
      .sort(function (a, b) { return b.s - a.s; })
      .map(function (r) { return r.it; });
  }
  function markText(text, q) {
    var html = esc(text);
    tokens(q).forEach(function (t) {
      if (t.length < 2) return;
      html = html.replace(new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"), "<mark>$1</mark>");
    });
    return html;
  }
  function metaHTML(it) {
    return '<span class="mbadge" data-m="' + it.method + '">' + it.method + "</span>" +
      "<code>" + esc(it.call) + "</code>" +
      '<span class="risk" data-r="' + it.risk + '"><i></i>' + cap(it.risk) + "</span>" +
      '<span class="plan-badge" data-plan="' + it.plan + '">' + it.plan + "</span>";
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---------- hero: live toolkit search ---------- */
  var heroQ = $("#hero-q"), heroList = $("#hero-results");
  function renderHero(q, animate) {
    if (!heroList) return;
    var results = search(q).slice(0, 3);
    if (!q.trim()) results = ["leaver", "bitlocker", "disable"].map(function (id) { return byId(id); });
    if (!results.length) {
      heroList.innerHTML = '<li class="console-empty">Nothing matches that yet. Try “password”, “group” or “wipe”.</li>';
      return;
    }
    heroList.innerHTML = results.map(function (it) {
      return '<li' + (animate ? ' class="enter"' : "") + '><button type="button" data-id="' + it.id + '">' +
        '<span class="r-title">' + esc(it.title) + "</span>" +
        '<span class="r-meta">' + metaHTML(it) + "</span></button></li>";
    }).join("");
    if (animate) {
      $$("li.enter", heroList).forEach(function (li, i) {
        setTimeout(function () { li.classList.remove("enter"); }, 60 + i * 90);
      });
    }
  }
  function byId(id) { for (var i = 0; i < TOOLKIT.length; i++) if (TOOLKIT[i].id === id) return TOOLKIT[i]; }
  if (heroQ) {
    renderHero("", false);
    heroQ.addEventListener("input", function () { typing = false; renderHero(heroQ.value, false); });
    heroList.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-id]");
      if (b) openInExplorer(b.getAttribute("data-id"));
    });
    // The page's one orchestrated moment: type a real search, once.
    var typing = !reduceMotion;
    if (typing) {
      var demo = "leaver", i = 0;
      setTimeout(function step() {
        if (!typing || document.activeElement === heroQ) return;
        heroQ.value = demo.slice(0, ++i);
        renderHero(heroQ.value, i === demo.length);
        if (i < demo.length) setTimeout(step, 95);
      }, 900);
    }
  }

  /* ---------- before / after ---------- */
  var JOBS = {
    starter: {
      img: "after-starter",
      alt: "EntraPlus new starter form: first name, surname, generated username, domain picker, job title, licence with free count, and a ready-to-copy temporary password",
      before: "One module to install, 14 lines to get right, and one typo in the sign-in name means starting again.",
      after: "One form. The sign-in name is built for you, the licence shows how many are left, and the password is ready to copy.",
      code: [
        "# Install and connect (first time on this PC)",
        "Install-Module Microsoft.Graph -Scope CurrentUser",
        'Connect-MgGraph -Scopes "User.ReadWrite.All","Organization.Read.All"',
        "",
        "# Create the account",
        '$pw = @{ Password = "Kx7#mPq2!vRt"; ForceChangePasswordNextSignIn = $true }',
        '$user = New-MgUser -DisplayName "Priya Shah" -GivenName "Priya" -Surname "Shah" `',
        '  -UserPrincipalName "priya.shah@hartwell.school" -MailNickname "priya.shah" `',
        '  -JobTitle "Teacher of Chemistry" -Department "Science" `',
        '  -UsageLocation "GB" -AccountEnabled -PasswordProfile $pw',
        "",
        "# Find the licence, then assign it",
        '$sku = Get-MgSubscribedSku | Where-Object SkuPartNumber -eq "M365EDU_A3_FACULTY"',
        "Set-MgUserLicense -UserId $user.Id -AddLicenses @{ SkuId = $sku.SkuId } -RemoveLicenses @()"
      ]
    },
    leaver: {
      img: "after-leaver",
      alt: "EntraPlus leaver window for Jane Smith listing each step with a green tick: mailbox converted to shared, sign-in blocked, signed out everywhere, password reset, removed from groups, licences removed",
      before: "Two modules, two sign-ins, and a loop that stops at the first group it can't change.",
      after: "Tick the steps and run them. Each one reports its own result, and the mailbox is converted before the licence is removed.",
      code: [
        'Connect-MgGraph -Scopes "User.ReadWrite.All","Group.ReadWrite.All"',
        "Connect-ExchangeOnline -UserPrincipalName admin@hartwell.school",
        "",
        '$id = (Get-MgUser -UserId "jane.smith@hartwell.school").Id',
        "Update-MgUser -UserId $id -AccountEnabled:$false",
        "Revoke-MgUserSignInSession -UserId $id",
        'Update-MgUser -UserId $id -PasswordProfile @{ Password = "Lv9!" + (New-Guid) }',
        "",
        "Get-MgUserMemberOf -UserId $id -All | ForEach-Object {",
        "  Remove-MgGroupMemberByRef -GroupId $_.Id -DirectoryObjectId $id",
        "}",
        'Set-Mailbox -Identity "jane.smith@hartwell.school" -Type Shared',
        "$skus = (Get-MgUserLicenseDetail -UserId $id).SkuId",
        "Set-MgUserLicense -UserId $id -AddLicenses @() -RemoveLicenses $skus"
      ]
    },
    bitlocker: {
      img: "after-bitlocker",
      alt: "EntraPlus BitLocker recovery key window showing the key ID and the 48-digit recovery key with a copy button",
      before: "A teacher waiting at the recovery screen while you look up the right module, filter and property.",
      after: "Pick the laptop and press BitLocker key. Match the key ID, read it out, done.",
      code: [
        'Connect-MgGraph -Scopes "BitlockerKey.Read.All","DeviceManagementManagedDevices.Read.All"',
        "",
        "$device = Get-MgDeviceManagementManagedDevice -Filter \"deviceName eq 'HWS-LT-2042'\"",
        "$keys = Get-MgInformationProtectionBitlockerRecoveryKey `",
        "          -Filter \"deviceId eq '$($device.AzureAdDeviceId)'\"",
        "",
        "foreach ($k in $keys) {",
        "  (Get-MgInformationProtectionBitlockerRecoveryKey `",
        "     -BitlockerRecoveryKeyId $k.Id -Property key).Key",
        "}",
        "",
        "# Or: Intune admin centre > Devices > Windows > HWS-LT-2042",
        "#     > Recovery keys > Show recovery key"
      ]
    }
  };
  var compare = $(".compare");
  if (compare) {
    var range = $(".compare-range", compare);
    var img = $("#compare-img"), code = $("#compare-code");
    var setPos = function (v) { compare.style.setProperty("--pos", v + "%"); };
    range.addEventListener("input", function () { setPos(range.value); });
    function showJob(key) {
      var job = JOBS[key];
      code.innerHTML = highlight(job.code.join("\n"));
      img.src = "/assets/img/shots/" + job.img + "-1600.webp";
      img.srcset = "/assets/img/shots/" + job.img + "-960.webp 960w, /assets/img/shots/" + job.img + "-1600.webp 1600w";
      img.alt = job.alt;
      $("#fact-before").textContent = job.before;
      $("#fact-after").textContent = job.after;
    }
    showJob("starter");
    setupTabs($('#compare [role="tablist"]'), function (tab) { showJob(tab.getAttribute("data-job")); });

    // A single gentle sweep the first time the slider is seen, to show it can be dragged.
    if (!reduceMotion && "IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        var keys = [[0, 50], [700, 78], [1500, 28], [2200, 50]], start = null;
        function frame(ts) {
          if (start === null) start = ts;
          var t = ts - start, k = 1;
          while (k < keys.length && keys[k][0] < t) k++;
          if (k >= keys.length) { setPos(50); range.value = 50; return; }
          var a = keys[k - 1], b = keys[k], p = (t - a[0]) / (b[0] - a[0]);
          var eased = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          var v = a[1] + (b[1] - a[1]) * eased;
          setPos(v); range.value = Math.round(v);
          requestAnimationFrame(frame);
        }
        setTimeout(function () { requestAnimationFrame(frame); }, 300);
      }, { threshold: .55 });
      io.observe(compare);
    }
  }

  /* ---------- toolkit explorer ---------- */
  var body = $("#tk-body");
  var state = { q: "", area: "All", plan: [], risk: [], method: [], sort: null, dir: 1, open: {} };
  var RISK_ORDER = { low: 0, medium: 1, high: 2 };
  var AREAS = ["All", "Users", "Groups", "Devices", "Policies", "Hybrid AD", "Exchange"];

  function renderAreas() {
    var list = $("#tk-areas");
    if (!list) return;
    list.innerHTML = AREAS.map(function (a) {
      var n = a === "All" ? TOOLKIT.length : TOOLKIT.filter(function (i) { return i.area === a; }).length;
      return '<li><button type="button" data-area="' + a + '"' + (state.area === a ? ' aria-current="true"' : "") +
        ">" + a + '<span class="n">' + n + "</span></button></li>";
    }).join("");
  }
  function filtered() {
    var items = state.q.trim() ? search(state.q) : TOOLKIT.slice();
    items = items.filter(function (i) {
      return (state.area === "All" || i.area === state.area) &&
        (!state.plan.length || state.plan.indexOf(i.plan) !== -1) &&
        (!state.risk.length || state.risk.indexOf(i.risk) !== -1) &&
        (!state.method.length || state.method.indexOf(i.method) !== -1);
    });
    if (state.sort) {
      items.sort(function (a, b) {
        var x = state.sort === "risk" ? RISK_ORDER[a.risk] : a[state.sort];
        var y = state.sort === "risk" ? RISK_ORDER[b.risk] : b[state.sort];
        return (x > y ? 1 : x < y ? -1 : 0) * state.dir;
      });
    }
    return items;
  }
  function detailHTML(it) {
    var notGraph = it.method === "PS";
    var parts = ['<div class="detail-grid"><p>' + esc(it.summary) + "</p>"];
    if (it.guard) parts.push('<p class="guard"><strong>Safety check</strong><span>' + esc(it.guard) + "</span></p>");
    if (notGraph) {
      parts.push('<p class="guard"><strong>Microsoft Graph</strong><span>' + esc(it.http.replace(/^\(|\)$/g, "")) + "</span></p>");
    } else {
      parts.push('<div class="cmd"><div class="cmd-head"><span class="label">Microsoft Graph</span>' +
        '<button type="button" class="copy" data-copy-target="http-' + it.id + '">Copy</button></div>' +
        '<pre class="code"><code id="http-' + it.id + '">' + highlight(it.http) + "</code></pre></div>");
    }
    parts.push('<div class="cmd"' + (notGraph ? ' style="grid-column: 1 / -1"' : "") + '><div class="cmd-head"><span class="label">PowerShell</span>' +
      '<button type="button" class="copy" data-copy-target="ps-' + it.id + '">Copy</button></div>' +
      '<pre class="code"><code id="ps-' + it.id + '">' + highlight(it.ps) + "</code></pre></div></div>");
    return parts.join("");
  }
  function renderTable() {
    if (!body) return;
    var items = filtered();
    body.innerHTML = items.map(function (it) {
      var open = !!state.open[it.id];
      return '<tr data-id="' + it.id + '"' + (open ? ' class="is-open"' : "") + ">" +
        '<td><button type="button" class="row-toggle" aria-expanded="' + open + '" aria-controls="d-' + it.id + '">' +
          markText(it.title, state.q) + "</button></td>" +
        '<td><span class="pbadge" data-p="' + it.platform + '">' + it.platform + "</span></td>" +
        '<td><span class="call"><span class="mbadge" data-m="' + it.method + '">' + it.method + "</span>" +
          '<code title="' + esc(it.call) + '">' + esc(it.call) + "</code></span></td>" +
        '<td><span class="risk" data-r="' + it.risk + '"><i></i>' + cap(it.risk) + "</span></td>" +
        '<td><span class="plan-badge" data-plan="' + it.plan + '">' + it.plan + "</span></td></tr>" +
        '<tr class="detail" id="d-' + it.id + '"' + (open ? "" : " hidden") + '><td colspan="5">' +
          (open ? detailHTML(it) : "") + "</td></tr>";
    }).join("");
    var n = items.length;
    $("#tk-count").textContent = n === TOOLKIT.length ? "Showing all " + n + " actions" :
      "Showing " + n + " of " + TOOLKIT.length + " actions";
    $("#tk-empty").hidden = n > 0;
  }
  function toggleRow(id, force) {
    var open = force === undefined ? !state.open[id] : force;
    state.open[id] = open;
    var tr = body.querySelector('tr[data-id="' + id + '"]');
    if (!tr) return;
    var detail = tr.nextElementSibling, it = byId(id);
    tr.classList.toggle("is-open", open);
    $(".row-toggle", tr).setAttribute("aria-expanded", String(open));
    detail.hidden = !open;
    $("td", detail).innerHTML = open ? detailHTML(it) : "";
  }
  function openInExplorer(id) {
    state.q = ""; state.area = "All"; state.plan = []; state.risk = []; state.method = [];
    $("#tk-q").value = "";
    $$(".chip").forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
    state.open = {}; state.open[id] = true;
    renderAreas(); renderTable();
    var row = body.querySelector('tr[data-id="' + id + '"]');
    if (row) {
      row.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      setTimeout(function () { $(".row-toggle", row).focus({ preventScroll: true }); }, reduceMotion ? 0 : 500);
    }
  }
  if (body) {
    renderAreas();
    renderTable();
    var qTimer;
    $("#tk-q").addEventListener("input", function (e) {
      clearTimeout(qTimer);
      qTimer = setTimeout(function () { state.q = e.target.value; renderTable(); }, 120);
    });
    $("#tk-areas").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-area]");
      if (!b) return;
      state.area = b.getAttribute("data-area");
      renderAreas(); renderTable();
    });
    $$(".chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var key = chip.getAttribute("data-filter"), val = chip.getAttribute("data-value");
        var list = state[key], at = list.indexOf(val);
        if (at === -1) list.push(val); else list.splice(at, 1);
        chip.setAttribute("aria-pressed", String(at === -1));
        renderTable();
      });
    });
    $$(".tk .sort").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-sort");
        state.dir = state.sort === key ? -state.dir : 1;
        state.sort = key;
        $$(".tk .sort").forEach(function (b) {
          b.removeAttribute("data-dir");
          b.closest("th").removeAttribute("aria-sort");
        });
        btn.setAttribute("data-dir", state.dir === 1 ? "asc" : "desc");
        btn.closest("th").setAttribute("aria-sort", state.dir === 1 ? "ascending" : "descending");
        renderTable();
      });
    });
    body.addEventListener("click", function (e) {
      var b = e.target.closest(".row-toggle");
      if (b) toggleRow(b.closest("tr").getAttribute("data-id"));
    });
    $("#tk-clear").addEventListener("click", function () {
      state.q = ""; state.area = "All"; state.plan = []; state.risk = []; state.method = [];
      $("#tk-q").value = "";
      $$(".chip").forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
      renderAreas(); renderTable();
    });
  }

  /* ---------- screens gallery ---------- */
  var shotList = $('#screens [role="tablist"]');
  if (shotList) {
    setupTabs(shotList, function (tab) {
      var img = $("#shot-img"), name = tab.getAttribute("data-shot");
      img.src = "/assets/img/shots/" + name + "-1600.webp";
      img.srcset = "/assets/img/shots/" + name + "-960.webp 960w, /assets/img/shots/" + name + "-1600.webp 1600w";
      img.alt = tab.getAttribute("data-alt");
    });
  }

  /* ---------- pricing toggle ---------- */
  var cta = $("#pro-cta");
  $$('input[name="billing"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var period = r.value;
      $$(".plan-pro [data-" + period + "]").forEach(function (el) { el.textContent = el.getAttribute("data-" + period); });
      if (cta) {
        cta.href = "/register.html?plan=" + period;
        cta.textContent = period === "yearly" ? "Get Pro yearly" : "Get Pro monthly";
      }
    });
  });

  /* ---------- analytics: only after consent ---------- */
  function loadAnalytics(id) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("consent", "default", { analytics_storage: "granted", ad_storage: "denied",
                                        ad_user_data: "denied", ad_personalization: "denied" });
    window.gtag("js", new Date());
    window.gtag("config", id);
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
    document.head.appendChild(s);
  }
  var banner = $("#consent");
  if (CONFIG.gaId) {
    var choice = null;
    try { choice = localStorage.getItem("ep-consent"); } catch (e) {}
    if (choice === "granted") loadAnalytics(CONFIG.gaId);
    else if (!choice && banner) banner.hidden = false;
    if (banner) {
      banner.addEventListener("click", function (e) {
        var b = e.target.closest("[data-consent]");
        if (!b) return;
        var value = b.getAttribute("data-consent");
        try { localStorage.setItem("ep-consent", value); } catch (err) {}
        banner.hidden = true;
        if (value === "granted") loadAnalytics(CONFIG.gaId);
      });
    }
  }
  window.epResetConsent = function () {
    try { localStorage.removeItem("ep-consent"); } catch (e) {}
    location.reload();
  };

  window.epHighlight = highlight;
})();
