/* Signed in? Replace "Log in" with your photo (or initials), name and licence status, linking to your dashboard.
   Reads the saved sign-in directly and asks the database for your status with one small request, so it doesn't
   load the Supabase library on every page. The photo is fetched from Microsoft once at sign-in and kept locally. */
(function () {
  "use strict";
  var cfg = ((window.EP_CONFIG || {}).auth) || {};
  var ROLES = { manager: "Manager", senior: "Senior technician", technician: "Technician" };

  function session() {
    try {
      if (cfg.mode === "supabase" && cfg.supabaseUrl) {
        var ref = cfg.supabaseUrl.replace(/^https?:\/\//, "").split(".")[0];
        var saved = JSON.parse(localStorage.getItem("sb-" + ref + "-auth-token") || "null");
        var u = saved && (saved.user || (saved.currentSession || {}).user);
        if (!u) return null;
        var m = u.user_metadata || {};
        return { id: u.id, name: m.full_name || m.name || "", email: u.email || "", token: saved.access_token,
                 expires: (saved.expires_at || 0) * 1000 };
      }
      var email = localStorage.getItem("ep-demo-session");
      if (!email) return null;
      var dbs = JSON.parse(localStorage.getItem("ep-demo-db") || "{}");
      var user = (dbs.users || {})[email] || {};
      return { id: user.id, name: user.name || "", email: email, demo: dbs };
    } catch (e) { return null; }
  }

  function initials(p) {
    var parts = (p.name || p.email.split("@")[0]).trim().split(/[\s._-]+/).filter(Boolean);
    return ((parts[0] || "?").charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : "")).toUpperCase();
  }

  function describe(state) {
    if (!state) return "";
    var m = state.member;
    if (!m) return state.org ? "Joining " + state.org.name : "Set up your organisation";
    if (m.status === "pending") return "Waiting for approval";
    var role = ROLES[m.role] || "";
    if (m.pro) return "Pro · " + role;
    if (m.seat) return "Licence ended · " + role;
    return "Free · " + role;
  }

  function demoState(p) {
    var d = p.demo || {}, m = (d.members || []).filter(function (x) { return x.user_id === p.id && x.status !== "removed"; })[0];
    if (!m) return { member: null, org: null };
    var sub = (d.subs || {})[m.org_id] || {};
    var live = sub.status === "active" && (!sub.current_period_end || new Date(sub.current_period_end) > new Date());
    return { org: d.orgs[m.org_id], member: { role: m.role, status: m.status, seat: m.seat, pro: m.seat && m.status === "active" && live } };
  }

  function fetchState(p) {
    if (p.demo) return Promise.resolve(demoState(p));
    if (!p.token || p.expires < Date.now()) return Promise.resolve(null);      // the account page refreshes it
    return fetch(cfg.supabaseUrl + "/rest/v1/rpc/account_state", {
      method: "POST", body: "{}",
      headers: { "Content-Type": "application/json", apikey: cfg.supabaseAnonKey, Authorization: "Bearer " + p.token }
    }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function apply() {
    var p = session(), actions = document.querySelector(".header-actions");
    if (!p || !actions || document.querySelector(".account-chip")) return;
    document.querySelectorAll('a[href="/login.html"]').forEach(function (a) { (a.closest("li") || a).hidden = true; });

    var a = document.createElement("a");
    a.className = "account-chip";
    a.href = "/account.html";
    a.title = (p.name ? p.name + "\n" : "") + p.email + "\nYour account and organisation";
    var avatar = document.createElement("span");
    avatar.className = "chip-avatar";
    avatar.setAttribute("aria-hidden", "true");
    var photo = p.id && localStorage.getItem("ep-avatar:" + p.id);
    if (photo && photo.indexOf("data:image/") === 0) {
      var img = document.createElement("img");
      img.src = photo; img.alt = "";
      avatar.appendChild(img);
    } else {
      avatar.textContent = initials(p);
    }
    var text = document.createElement("span");
    text.className = "chip-text";
    var name = document.createElement("span");
    name.className = "chip-name";
    name.textContent = p.name || p.email;
    var status = document.createElement("span");
    status.className = "chip-status";
    text.appendChild(name);
    text.appendChild(status);
    a.appendChild(avatar);
    a.appendChild(text);
    actions.insertBefore(a, actions.querySelector(".menu-btn") || null);

    fetchState(p).then(function (state) {
      var words = describe(state);
      status.textContent = words;
      a.classList.toggle("is-pro", /^Pro/.test(words));
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply); else apply();
})();
