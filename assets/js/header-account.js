/* Signed in? Swap "Log in" for a round badge with your initials that opens your dashboard.
   Reads the saved sign-in directly (no Supabase library needed), so it costs nothing on page load.
   The account page itself still checks the session properly. */
(function () {
  "use strict";
  var cfg = ((window.EP_CONFIG || {}).auth) || {};

  function who() {
    try {
      if (cfg.mode === "supabase" && cfg.supabaseUrl) {
        var ref = cfg.supabaseUrl.replace(/^https?:\/\//, "").split(".")[0];
        var saved = JSON.parse(localStorage.getItem("sb-" + ref + "-auth-token") || "null");
        var u = saved && (saved.user || (saved.currentSession || {}).user);
        if (!u) return null;
        var m = u.user_metadata || {};
        return { name: m.full_name || m.name || "", email: u.email || "" };
      }
      var email = localStorage.getItem("ep-demo-session");
      if (!email) return null;
      var dbs = JSON.parse(localStorage.getItem("ep-demo-db") || "{}");
      var user = (dbs.users || {})[email] || {};
      return { name: user.name || "", email: email };
    } catch (e) { return null; }
  }

  function initials(p) {
    var src = (p.name || p.email.split("@")[0]).trim();
    var parts = src.split(/[\s._-]+/).filter(Boolean);
    return ((parts[0] || "?").charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : "")).toUpperCase();
  }

  function apply() {
    var p = who(), actions = document.querySelector(".header-actions");
    if (!p || !actions || document.querySelector(".avatar-link")) return;
    document.querySelectorAll('a[href="/login.html"]').forEach(function (a) {
      var li = a.closest("li");
      (li || a).hidden = true;
    });
    var a = document.createElement("a");
    a.className = "avatar-link";
    a.href = "/account.html";
    a.title = (p.name ? p.name + "\n" : "") + p.email + "\nYour account and organisation";
    // Name comes from the content: the initials are visible, the words are for screen readers.
    a.innerHTML = '<span aria-hidden="true"></span><span class="sr-only"></span>';
    a.firstChild.textContent = initials(p);
    a.lastChild.textContent = "Your account" + (p.name ? ", " + p.name : "");
    var menu = actions.querySelector(".menu-btn");
    actions.insertBefore(a, menu || null);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply); else apply();
})();
