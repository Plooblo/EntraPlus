/* Sign-in, registration and the account dashboard. Uses window.EPAuth only. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var auth = window.EPAuth, CONFIG = window.EP_CONFIG || {};
  var page = document.body.getAttribute("data-page");
  var params = new URLSearchParams(location.search);
  var toast = window.epToast || function () {};
  var ROLES = { manager: "Manager", senior: "Senior technician", technician: "Technician" };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function showError(box, message) {
    if (!box) return;
    box.textContent = message || "";
    box.hidden = !message;
    if (message) box.focus();
  }
  function money(pence, currency) {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: (currency || "gbp").toUpperCase() })
      .format((pence || 0) / 100);
  }
  function fmtDate(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }
  if (auth.mode === "demo") $$("[id=demo-note]").forEach(function (n) { n.hidden = false; });
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  /* ---------------------------------------------------------------- sign in / register */
  if (page === "login" || page === "register") {
    var plan = params.get("plan");
    if (page === "register" && plan && $("#plan-note")) {
      $("#plan-note").textContent = "After signing in you'll set up your organisation, then choose the " +
        (plan === "monthly" ? "monthly" : "yearly") + " plan and how many technician seats you need.";
      $("#plan-note").hidden = false;
    }
    if (auth.mode === "demo") $("#demo-signin").hidden = false;
    auth.currentUser().then(function (u) { if (u) location.replace("/account.html"); });
    var btn = $("#ms-signin"), err = $("#signin-form .form-error");
    btn.addEventListener("click", function () {
      showError(err, "");
      btn.disabled = true;
      auth.signInWithMicrosoft(auth.mode === "demo" ? $("#demo-email").value : undefined).then(function () {
        if (auth.mode === "demo") location.href = "/account.html";
        // supabase mode: the browser is already on its way to Microsoft
      }).catch(function (e) { btn.disabled = false; showError(err, e.message); });
    });
    return;
  }

  if (page !== "account") return;

  /* ---------------------------------------------------------------- account dashboard */
  var user = null, state = null, subInfo = null;

  function section(id, show) { $(id).hidden = !show; }
  function fail(e) { showError($("#page-error"), e.message || String(e)); }

  function start() {
    auth.currentUser().then(function (u) {
      if (!u) { location.replace("/login.html"); return; }
      user = u;
      if (auth.cacheProfilePhoto) auth.cacheProfilePhoto();
      $("#hello").textContent = u.name ? "Hello, " + u.name.split(" ")[0] : "Your account";
      $("#sign-out").onclick = function () { auth.signOut().then(function () { location.href = "/"; }); };
      return refresh();
    }).catch(fail);
  }

  function refresh() {
    return auth.state().then(function (s) {
      // Someone from a tenant that's already on EntraPlus joins automatically, as "waiting for approval".
      if (!s.member && s.org) return auth.joinOrganisation().then(function () { return auth.state(); });
      return s;
    }).then(function (s) {
      state = s;
      $("#loading").hidden = true;
      $("#account-main").hidden = false;
      $("#org-line").textContent = s.org ? s.org.name : (user.email || "");
      section("#setup", !s.member);
      section("#pending", !!s.member && s.member.status === "pending");
      section("#dashboard", !!s.member && s.member.status === "active");
      if (!s.member) return setupView();
      if (s.member.status === "pending") return pendingView();
      return dashboardView();
    }).catch(fail);
  }

  function setupView() {
    var form = $("#setup-form"), input = $("#org-name");
    if (!input.value && user.email) {
      var domain = user.email.split("@")[1] || "";
      input.value = domain.split(".")[0].replace(/^\w/, function (c) { return c.toUpperCase(); });
    }
    form.onsubmit = function (e) {
      e.preventDefault();
      var err = $(".form-error", form);
      showError(err, "");
      if (input.value.trim().length < 2) { showError(err, "Enter your organisation's name."); return; }
      auth.createOrganisation(input.value.trim()).then(function () {
        toast("Organisation set up. You're its manager.");
        return refresh();
      }).catch(function (e2) { showError(err, e2.message); });
    };
  }

  function pendingView() {
    var names = state.managers || [];
    $("#pending-text").textContent = "You've joined " + state.org.name + " on EntraPlus. " +
      (names.length ? "Ask " + names.join(" or ") + " to approve you" : "Ask your EntraPlus manager to approve you") +
      " from their dashboard. Once they have, you'll see your licence here.";
    $("#pending-refresh").onclick = refresh;
  }

  function dashboardView() {
    var m = state.member, isManager = m.role === "manager";
    $("#role-badge").textContent = ROLES[m.role] || m.role;
    $("#role-badge").setAttribute("data-plan", m.seat ? "Pro" : "Free");
    $$(".manager-only").forEach(function (el) { el.hidden = !isManager; });
    var dl = (CONFIG.downloads || {}).installer;
    if (dl) $("#download-app").href = dl;
    renderSeat();
    loadPcs();
    if (isManager) {
      loadSubscription();
      loadPeople();
      loadHistory();
      if (auth.mode === "demo") demoTools();
    }
    if (params.get("billing")) {
      toast(params.get("billing") === "cancelled"
        ? "Subscription cancelled. Pro keeps working until the end of the paid period."
        : "Billing updated. Changes can take a few seconds to appear.");
      history.replaceState(null, "", "/account.html");
      setTimeout(refresh, 3000);
    }
    if (params.get("paid")) {
      toast("Thank you! Your subscription can take a few seconds to appear.");
      history.replaceState(null, "", "/account.html");
      var tries = 0, poll = setInterval(function () {
        tries += 1;
        auth.subscription(state.org.id).then(function (s) {
          if (s.status === "active" || tries > 8) { clearInterval(poll); refresh(); }
        });
      }, 2500);
    }
  }

  function renderSeat() {
    var m = state.member;
    $("#seat-line").textContent = m.seat ? "You have a Pro seat." : "You don't have a Pro seat.";
    $("#seat-text").textContent = m.seat
      ? "Sign in to the EntraPlus app with this account and Pro switches on automatically. There's nothing to copy or paste."
      : m.role === "manager"
        ? "Choose a plan, then give yourself a seat under People. Pro switches on in the app automatically."
        : "EntraPlus works on the Free plan without one. Ask your manager for a Pro seat; it switches on in the app automatically.";
  }

  /* ---------------- PCs signed in to the desktop app */
  function loadPcs() {
    auth.appSessions().then(function (rows) {
      $("#pcs").hidden = !rows.length;
      $("#pcs-list").innerHTML = rows.map(function (r) {
        return '<li><span><strong>' + esc(r.device || "A PC") + '</strong><br><span class="hint">Last used ' +
          esc(fmtDate(r.last_seen)) + '</span></span><button type="button" class="btn btn-small" data-pc="' + esc(r.id) +
          '" aria-label="Sign out ' + esc(r.device || "this PC") + '">Sign out</button></li>';
      }).join("");
    }).catch(function () { $("#pcs").hidden = true; });
  }
  $("#pcs-list").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-pc]");
    if (!b || !confirm("Sign this PC out of EntraPlus? It will use the Free plan until someone signs in again.")) return;
    auth.endAppSession(b.getAttribute("data-pc")).then(function () { toast("PC signed out"); loadPcs(); }, fail);
  });

  /* ---------------- manager: subscription */
  function link(base, extra) {
    if (!base) return "";
    return base + (base.indexOf("?") === -1 ? "?" : "&") + extra;
  }

  function loadSubscription() {
    auth.subscription(state.org.id).then(function (s) {
      subInfo = s;
      var expired = !!s.current_period_end && new Date(s.current_period_end) < new Date();
      var active = s.status === "active" && !expired;
      var granted = s.source === "trial" || s.source === "manual";
      var badge = $("#sub-badge");
      badge.textContent = expired && s.status === "active" ? (s.source === "trial" ? "Trial ended" : "Ended")
        : active && s.source === "trial" ? "Trial"
        : { active: "Pro", past_due: "Payment due", cancelled: "Cancelled", none: "Free" }[s.status] || s.status;
      badge.setAttribute("data-plan", active ? "Pro" : "Free");
      $("#sub-plan").textContent = active && s.source === "trial"
        ? "Free trial of EntraPlus Pro for " + s.seats + " technician" + (s.seats === 1 ? "" : "s") + ". Choose a plan below to keep Pro afterwards."
        : active && s.source === "manual"
        ? "EntraPlus Pro for " + s.seats + " technician" + (s.seats === 1 ? "" : "s") + ", arranged with EntraPlus" + (s.note ? " (" + s.note + ")" : "") + "."
        : expired && granted ? "Your " + (s.source === "trial" ? "trial" : "licence") + " has ended. Choose a plan to carry on with Pro."
        : active
        ? "EntraPlus Pro, " + (s.period === "yearly" ? "yearly" : "monthly") + " for " + s.seats + " technician" + (s.seats === 1 ? "" : "s")
        : s.status === "past_due" ? "The last payment didn't go through. Update your card to keep Pro."
        : "No paid plan yet. Everyone in your organisation can use the Free plan.";
      var facts = [];
      if (s.unit_amount) {
        facts.push(["Price", money(s.unit_amount, s.currency) + " per technician " + (s.period === "yearly" ? "a year" : "a month")]);
        facts.push(["Total", money(s.unit_amount * s.seats, s.currency) + (s.period === "yearly" ? " a year" : " a month") + " plus any VAT"]);
      }
      if (s.current_period_end) {
        facts.push([s.cancel_at_period_end || s.status === "cancelled" || granted || expired ? (expired ? "Ended" : "Ends") : "Renews",
                    fmtDate(s.current_period_end)]);
      }
      $("#sub-facts").innerHTML = facts.map(function (f) {
        return "<div><dt>" + esc(f[0]) + "</dt><dd>" + esc(f[1]) + "</dd></div>";
      }).join("");
      var stripe = CONFIG.stripe || {};
      var ref = "client_reference_id=" + encodeURIComponent(state.org.id) + "&prefilled_email=" + encodeURIComponent(user.email || "");
      $("#buy").hidden = (active && !granted) || s.status === "past_due";
      [["#buy-monthly", stripe.monthly], ["#buy-yearly", stripe.yearly]].forEach(function (b) {
        var a = $(b[0]);
        if (b[1]) { a.href = link(b[1], ref); a.removeAttribute("aria-disabled"); }
        else { a.removeAttribute("href"); a.setAttribute("aria-disabled", "true"); }
      });
      $("#buy-unavailable").hidden = !!(stripe.monthly || stripe.yearly) || auth.mode === "demo";
      var hasBilling = s.status !== "none" && s.status !== "cancelled" && !granted;
      var ending = active && s.cancel_at_period_end;
      $("#manage-row").hidden = !hasBilling;
      $("#manage-hint").hidden = !hasBilling;
      $("#btn-seats").hidden = !active || ending;
      $("#btn-cancel").hidden = !active || ending;
      $("#btn-manage").textContent = ending ? "Keep my subscription" : s.status === "past_due" ? "Update payment details" : "Billing details and invoices";
      $("#btn-manage").classList.toggle("btn-primary", ending || s.status === "past_due");
      $("#cancel-note").hidden = !ending;
      if (ending) {
        $("#cancel-note").textContent = "Your subscription is cancelled and ends on " + fmtDate(s.current_period_end) +
          ". Pro seats keep working until then. Changed your mind? Keep your subscription below.";
      }
    }).catch(fail);
  }

  $("#manage-row").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-billing]");
    if (!b) return;
    b.disabled = true;
    auth.billingPortal(state.org.id, b.getAttribute("data-billing")).then(function (r) {
      location.href = r.url;
    }).catch(function (err) { b.disabled = false; fail(err); });
  });

  /* ---------------- manager: people */
  function loadPeople() {
    auth.members(state.org.id).then(function (rows) {
      var seats = subInfo && subInfo.status === "active" ? subInfo.seats : 0;
      var used = rows.filter(function (r) { return r.seat && r.status === "active"; }).length;
      $("#seat-count").textContent = used + " of " + seats + " Pro seat" + (seats === 1 ? "" : "s") + " in use";
      $("#people-body").innerHTML = rows.map(function (r) {
        var me = r.user_id === user.id, pending = r.status === "pending";
        var roleSelect = '<select data-act="role" aria-label="Role for ' + esc(r.name || r.email) + '"' + (pending ? " disabled" : "") + ">" +
          Object.keys(ROLES).map(function (k) {
            return '<option value="' + k + '"' + (k === r.role ? " selected" : "") + ">" + ROLES[k] + "</option>";
          }).join("") + "</select>";
        var seat = '<label class="switch"><input type="checkbox" data-act="seat"' + (r.seat ? " checked" : "") +
          (pending ? " disabled" : "") + ' aria-label="Pro seat for ' + esc(r.name || r.email) + '"><span></span></label>';
        var status = pending ? '<span class="pill pill-amber">Waiting for you</span>' : '<span class="pill pill-green">Active</span>';
        var actions = pending
          ? '<button type="button" class="btn btn-small btn-primary" data-act="approve">Approve</button> ' +
            '<button type="button" class="btn btn-small" data-act="decline">Decline</button>'
          : (me ? "" : '<button type="button" class="btn btn-small" data-act="remove">Remove</button>');
        return '<tr data-user="' + esc(r.user_id) + '"><td><strong>' + esc(r.name || r.email) + "</strong>" + (me ? " (you)" : "") +
          '<br><span class="hint">' + esc(r.email) + "</span></td><td>" + roleSelect + "</td><td>" + seat + "</td><td>" +
          status + "</td><td class=\"row-actions\">" + actions + "</td></tr>";
      }).join("");
    }).catch(fail);
  }

  function changeMember(userId, patch, done) {
    return auth.updateMember(state.org.id, userId, patch).then(function () {
      if (done) toast(done);
      return refresh();
    }).catch(function (e) { toast(e.message); fail(e); loadPeople(); });
  }

  $("#people-body").addEventListener("change", function (e) {
    var row = e.target.closest("tr"), act = e.target.getAttribute("data-act");
    if (!row) return;
    var id = row.getAttribute("data-user");
    if (act === "role") changeMember(id, { role: e.target.value }, "Role updated");
    if (act === "seat") changeMember(id, { seat: e.target.checked }, e.target.checked ? "Pro seat given" : "Pro seat removed");
  });
  $("#people-body").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]");
    if (!b) return;
    var row = b.closest("tr"), id = row.getAttribute("data-user"), act = b.getAttribute("data-act");
    var name = row.querySelector("strong").textContent;
    if (act === "approve") changeMember(id, { status: "active" }, name + " approved");
    if (act === "decline" && confirm("Decline " + name + "? They can sign in again to ask later.")) {
      changeMember(id, { status: "removed" }, name + " declined");
    }
    if (act === "remove" && confirm("Remove " + name + " from your organisation? Their Pro seat becomes free.")) {
      changeMember(id, { status: "removed" }, name + " removed");
    }
  });

  /* ---------------- manager: purchase history */
  function loadHistory() {
    auth.invoices(state.org.id).then(function (rows) {
      $("#history-empty").hidden = rows.length > 0;
      $("#history-body").innerHTML = rows.map(function (inv) {
        var number = inv.hosted_url ? '<a href="' + esc(inv.hosted_url) + '" target="_blank" rel="noopener">' + esc(inv.number || "View") + "</a>"
                                    : esc(inv.number || "");
        var pdf = inv.pdf_url ? ' <a href="' + esc(inv.pdf_url) + '" target="_blank" rel="noopener">PDF</a>' : "";
        return "<tr><td>" + esc(fmtDate(inv.created)) + "</td><td>" + number + pdf + "</td><td>" +
          esc((inv.seats || "") + (inv.seats ? " × " : "") + (inv.period === "yearly" ? "yearly" : "monthly")) + "</td><td>" +
          esc(money(inv.amount, inv.currency)) + '</td><td><span class="pill ' + (inv.status === "paid" ? "pill-green" : "pill-amber") +
          '">' + esc(inv.status === "paid" ? "Paid" : inv.status === "open" ? "Unpaid" : inv.status) + "</span></td></tr>";
      }).join("");
    }).catch(fail);
  }

  function demoTools() {
    $("#demo-tools").hidden = false;
    function buy(period) {
      var seats = Math.max(1, Math.min(100, parseInt($("#demo-seats").value, 10) || 1));
      auth.simulatePurchase(state.org.id, period, seats).then(function () { toast("Demo purchase done"); refresh(); });
    }
    $("#demo-monthly").onclick = function () { buy("monthly"); };
    $("#demo-yearly").onclick = function () { buy("yearly"); };
  }

  start();
})();
