/* "Sign in to the EntraPlus app": hands a website sign-in to the desktop app on this PC.

   The app opens  /app-signin.html?port=NNNNN&state=…&challenge=…  and listens on 127.0.0.1:NNNNN.
   We only ever send the browser back to http://127.0.0.1:<that port>/callback, never to any other address,
   and only after the person presses Continue, so a link someone else sends can't silently sign them in.
   The details are kept in sessionStorage so they survive the trip to Microsoft and back. */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var auth = window.EPAuth, KEY = "ep-app-signin";
  var ROLES = { manager: "Manager", senior: "Senior technician", technician: "Technician" };

  function show(id) {
    ["#step-signin", "#step-confirm", "#step-done"].forEach(function (s) { $(s).hidden = s !== id; });
  }
  function error(msg) { var e = $("#app-error"); e.textContent = msg; e.hidden = !msg; if (msg) e.focus(); }

  // --- what the app asked for (from the address, or saved before the Microsoft round trip)
  var q = new URLSearchParams(location.search), req = null;
  if (q.get("port")) {
    req = { port: q.get("port"), state: q.get("state") || "", challenge: q.get("challenge") || "", mode: q.get("mode") || "" };
    sessionStorage.setItem(KEY, JSON.stringify(req));
    history.replaceState(null, "", "/app-signin.html");       // keep the details out of history and screenshots
  } else {
    try { req = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { req = null; }
  }
  var port = req ? parseInt(req.port, 10) : NaN;
  var valid = req && port >= 1024 && port <= 65535 && String(port) === String(req.port) &&
              /^[A-Za-z0-9_-]{16,128}$/.test(req.state) && /^[A-Za-z0-9_-]{43,128}$/.test(req.challenge);
  if (!valid) {
    $("#app-sub").textContent = "This page is opened by the EntraPlus app.";
    error("Open EntraPlus on your PC and choose Sign in there. This link didn't come from the app, or it has already been used.");
    return;
  }
  if (auth.mode === "demo") $("#demo-note").hidden = false;
  if (req.mode === "register") {
    document.querySelector("h1").textContent = "Create your EntraPlus account";
    $("#app-sub").textContent = "There's no new password: you use the Microsoft work account you already have. " +
      "If you're the first from your organisation, you'll set it up and become its manager.";
  }

  $("#ms-signin").onclick = function () {
    $("#ms-signin").disabled = true;
    auth.signInWithMicrosoft(undefined, "/app-signin.html").catch(function (e) {
      $("#ms-signin").disabled = false; error(e.message);
    });
  };

  auth.currentUser().then(function (user) {
    if (!user) { show("#step-signin"); return; }
    // Same as the account page: someone from a tenant that's already on EntraPlus joins it (pending approval).
    return auth.state().then(function (s) {
      return !s.member && s.org ? auth.joinOrganisation().then(function () { return auth.state(); }) : s;
    }).then(function (s) {
      var name = user.name || user.email;
      $("#who-avatar").textContent = name.split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join("").toUpperCase();
      $("#who-name").textContent = name;
      $("#who-email").textContent = user.email;
      $("#who-org").textContent = s.org ? s.org.name + (s.member ? " · " + (ROLES[s.member.role] || s.member.role) : "") : "";
      var m = s.member;
      $("#who-note").textContent =
        !m ? "You're the first from your organisation. After continuing, set it up from your account page at entraplus.co.uk to buy Pro seats. Until then the app uses the Free plan."
        : m.status === "pending" ? "Your manager hasn't approved you yet. The app will use the Free plan until they do."
        : m.seat ? "Your Pro seat will switch on in the app automatically."
        : "You don't have a Pro seat yet, so the app will use the Free plan until your manager gives you one.";
      show("#step-confirm");
      $("#continue").focus();
    });
  }).catch(function (e) { error(e.message); });

  $("#switch").onclick = function () {
    auth.signOut().then(function () { show("#step-signin"); });
  };

  $("#continue").onclick = function () {
    $("#continue").disabled = true;
    error("");
    auth.createAppCode(req.challenge).then(function (r) {
      sessionStorage.removeItem(KEY);                          // single use
      show("#step-done");
      location.href = "http://127.0.0.1:" + port + "/callback?code=" + encodeURIComponent(r.code) +
                      "&state=" + encodeURIComponent(req.state);
    }).catch(function (e) { $("#continue").disabled = false; error(e.message); });
  };
})();
