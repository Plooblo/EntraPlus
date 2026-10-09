/* Log in, register and account pages. Uses window.EPAuth only. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var auth = window.EPAuth, CONFIG = window.EP_CONFIG || {};
  var page = document.body.getAttribute("data-page");
  var params = new URLSearchParams(location.search);
  var toast = window.epToast || function () {};

  if (auth.mode === "demo") {
    var demo = $("#demo-note");
    if (demo) demo.hidden = false;
  }

  function showError(form, message) {
    var box = $(".form-error", form);
    box.textContent = message;
    box.hidden = !message;
    if (message) box.focus();
  }
  function busy(form, on, text) {
    var b = $('button[type="submit"]', form);
    if (!b.dataset.label) b.dataset.label = b.textContent;
    b.disabled = on;
    b.textContent = on ? text : b.dataset.label;
  }
  function planName(period) { return period === "monthly" ? "Pro monthly (£15 a month)" : "Pro yearly (£120 a year)"; }
  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }

  /* ---------- log in ---------- */
  if (page === "login") {
    auth.currentUser().then(function (u) { if (u) location.replace("/account.html"); });
    var form = $("#login-form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      showError(form, "");
      busy(form, true, "Logging in…");
      auth.signIn(form.email.value, form.password.value).then(function () {
        location.href = "/account.html" + (params.get("plan") ? "?plan=" + encodeURIComponent(params.get("plan")) : "");
      }).catch(function (err) { busy(form, false); showError(form, err.message); });
    });
    $("#forgot").addEventListener("click", function () {
      if (!form.email.value) { showError(form, "Enter your email address first, then choose Forgotten your password."); form.email.focus(); return; }
      auth.resetPassword(form.email.value).then(function () {
        showError(form, "");
        toast("If there's an account for that email, a reset link is on its way.");
      }).catch(function (err) { showError(form, err.message); });
    });
  }

  /* ---------- register ---------- */
  if (page === "register") {
    var plan = params.get("plan");
    var planNote = $("#plan-note");
    if (plan && planNote) {
      planNote.textContent = "After creating your account you'll go straight to payment for " + planName(plan) + ".";
      planNote.hidden = false;
    }
    var rform = $("#register-form");
    rform.addEventListener("submit", function (e) {
      e.preventDefault();
      showError(rform, "");
      if (rform.password.value.length < 10) { showError(rform, "Use a password of at least 10 characters."); rform.password.focus(); return; }
      busy(rform, true, "Creating your account…");
      auth.signUp({ name: rform.name.value, organisation: rform.organisation.value, email: rform.email.value,
                    password: rform.password.value }).then(function (res) {
        if (res.needsConfirmation) {
          rform.hidden = true;
          $("#check-email").hidden = false;
          $("#check-email-address").textContent = rform.email.value;
          $("#check-email").focus();
        } else {
          location.href = "/account.html" + (plan ? "?plan=" + encodeURIComponent(plan) : "");
        }
      }).catch(function (err) { busy(rform, false); showError(rform, err.message); });
    });
  }

  /* ---------- account ---------- */
  if (page === "account") {
    auth.currentUser().then(function (user) {
      if (!user) { location.replace("/login.html"); return; }
      $("#account-main").hidden = false;
      $("#hello").textContent = user.name ? "Hello, " + user.name.split(" ")[0] : "Your account";

      var pform = $("#profile-form");
      pform.name.value = user.name;
      pform.organisation.value = user.organisation;
      pform.email.value = user.email;
      pform.addEventListener("submit", function (e) {
        e.preventDefault();
        showError(pform, "");
        busy(pform, true, "Saving…");
        auth.updateProfile({ name: pform.name.value, organisation: pform.organisation.value }).then(function () {
          busy(pform, false); toast("Profile saved");
        }).catch(function (err) { busy(pform, false); showError(pform, err.message); });
      });

      $("#sign-out").addEventListener("click", function () {
        auth.signOut().then(function () { location.href = "/"; });
      });

      function checkoutUrl(period) {
        var base = (CONFIG.stripe || {})[period];
        if (!base) return "";
        var sep = base.indexOf("?") === -1 ? "?" : "&";
        return base + sep + "client_reference_id=" + encodeURIComponent(user.id) +
               "&prefilled_email=" + encodeURIComponent(user.email);
      }

      function renderPlan(sub) {
        var pro = sub.plan === "pro" && sub.status === "active";
        $("#plan-free").hidden = pro;
        $("#plan-pro").hidden = !pro;
        if (!pro) {
          ["monthly", "yearly"].forEach(function (p) {
            var a = $("#buy-" + p), url = checkoutUrl(p);
            if (url) { a.href = url; a.removeAttribute("aria-disabled"); }
            else { a.setAttribute("aria-disabled", "true"); a.removeAttribute("href"); }
          });
          $("#buy-unavailable").hidden = !!(checkoutUrl("monthly") || checkoutUrl("yearly")) || auth.mode === "demo";
          var wanted = params.get("plan");
          if (wanted && checkoutUrl(wanted) && !sessionStorage.getItem("ep-sent-to-checkout")) {
            sessionStorage.setItem("ep-sent-to-checkout", "1");
            location.href = checkoutUrl(wanted);
          }
          return;
        }
        $("#pro-period").textContent = planName(sub.period);
        $("#pro-renews").textContent = sub.renews ? "Paid up to " + fmtDate(sub.renews) + ". Renews automatically." : "";
        var key = sub.licenceKey || "";
        var field = $("#licence-key"), reveal = $("#reveal-key"), copy = $("#copy-key");
        var masked = "•".repeat(32);
        field.textContent = masked;
        reveal.setAttribute("aria-pressed", "false");
        reveal.onclick = function () {
          var show = reveal.getAttribute("aria-pressed") !== "true";
          reveal.setAttribute("aria-pressed", String(show));
          reveal.textContent = show ? "Hide" : "Reveal";
          field.textContent = show ? key : masked;
          field.classList.toggle("is-revealed", show);
        };
        copy.onclick = function () {
          navigator.clipboard.writeText(key).then(function () { toast("Licence key copied"); },
                                                function () { toast("Reveal the key, then select and copy it"); });
        };
        var portal = (CONFIG.stripe || {}).portal;
        var manage = $("#manage-billing");
        if (portal) { manage.href = portal + (portal.indexOf("?") === -1 ? "?" : "&") + "prefilled_email=" + encodeURIComponent(user.email); manage.hidden = false; }
        else { manage.hidden = true; }
        var dl = (CONFIG.downloads || {}).installer;
        if (dl) $("#download-app").href = dl;
      }

      auth.subscription().then(renderPlan).catch(function (err) {
        $("#plan-error").textContent = "Couldn't load your subscription: " + err.message;
        $("#plan-error").hidden = false;
      });

      if (auth.mode === "demo") {
        $("#demo-tools").hidden = false;
        $("#demo-monthly").onclick = function () { auth.simulatePro("monthly").then(renderPlan); };
        $("#demo-yearly").onclick = function () { auth.simulatePro("yearly").then(renderPlan); };
        $("#demo-free").onclick = function () { auth.clearSubscription().then(function () { return auth.subscription(); }).then(renderPlan); };
      }
    });
  }
})();
