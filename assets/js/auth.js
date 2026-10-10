/* EntraPlus accounts: Microsoft sign-in, organisations, members, seats and billing.

   Pages only ever call window.EPAuth. "demo" keeps everything in this browser so every screen can
   be tried before the backend exists; "supabase" is the real thing (see backend/README.md).

   EPAuth API (all return Promises unless noted)
     mode                                  "demo" | "supabase"
     signInWithMicrosoft(emailForDemo?)    starts Microsoft sign-in (redirects in supabase mode)
     signOut()
     currentUser()                         -> { id, email, name } | null
     state()                               -> { tenant, org: {id,name}|null,
                                                member: {role,status,seat}|null, managers: [names] }
     createOrganisation(name)              the first person from a tenant becomes its manager
     joinOrganisation()                    everyone else joins as "pending"
     members(orgId)                        managers: everyone; others: just themselves
     updateMember(orgId, userId, patch)    patch: { role?, status?, seat? }   (managers only)
     subscription(orgId)                   managers only
     invoices(orgId)                       managers only
     billingPortal(flow)                   -> { url } Stripe billing page for a manager ("manage" | "seats" | "cancel")
     createAppCode(challenge)              -> { code }   one-time code that signs the desktop app in
     appSessions()                         -> PCs where this person is signed in to the app
     endAppSession(id)                     signs one of those PCs out
*/
(function () {
  "use strict";
  var cfg = ((window.EP_CONFIG || {}).auth) || { mode: "demo" };

  function fail(message) { return Promise.reject(new Error(message)); }

  /* ======================================================== demo: everything in this browser */
  var DB_KEY = "ep-demo-db", SESSION = "ep-demo-session";
  function load() {
    try { return JSON.parse(localStorage.getItem(DB_KEY)) || null; } catch (e) { return null; }
  }
  function db() {
    return load() || { users: {}, orgs: {}, members: [], subs: {}, invoices: {} };
  }
  function save(d) { localStorage.setItem(DB_KEY, JSON.stringify(d)); }
  function uid() { return "demo-" + Math.random().toString(36).slice(2, 10); }
  function me(d) { return d.users[localStorage.getItem(SESSION)] || null; }
  function tenantOf(email) { return (email.split("@")[1] || "").toLowerCase(); }   // demo stand-in for the tid
  function seatsUsed(d, orgId, except) {
    return d.members.filter(function (m) {
      return m.org_id === orgId && m.seat && m.status === "active" && m.user_id !== except;
    }).length;
  }
  function membership(d, userId) {
    return d.members.filter(function (m) { return m.user_id === userId && m.status !== "removed"; })[0] || null;
  }
  function managerCheck(d, orgId) {
    var u = me(d), m = u && membership(d, u.id);
    if (!m || m.org_id !== orgId || m.role !== "manager" || m.status !== "active") throw new Error("Only managers can do that.");
  }
  function niceName(email) {
    return email.split("@")[0].split(/[._-]/).map(function (p) { return p.charAt(0).toUpperCase() + p.slice(1); }).join(" ");
  }

  var Demo = {
    mode: "demo",
    signInWithMicrosoft: function (email) {
      email = (email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("Enter a work email address to try the demo.");
      if (/@(outlook|hotmail|live|gmail)\./.test(email)) return fail("Use a work or school account, not a personal one.");
      var d = db();
      if (!d.users[email]) {
        // Demo colleagues added when an organisation is set up become real when they "sign in".
        var seeded = d.members.filter(function (m) { return m.email === email; })[0];
        d.users[email] = { id: seeded ? seeded.user_id : uid(), email: email, name: niceName(email) };
      }
      save(d);
      localStorage.setItem(SESSION, email);
      return Promise.resolve(d.users[email]);
    },
    signOut: function () { localStorage.removeItem(SESSION); return Promise.resolve(); },
    currentUser: function () { return Promise.resolve(me(db())); },
    state: function () {
      var d = db(), u = me(d);
      if (!u) return fail("Please sign in.");
      var m = membership(d, u.id), tenant = tenantOf(u.email), org = null;
      if (m) org = d.orgs[m.org_id];
      else Object.keys(d.orgs).forEach(function (k) { if (d.orgs[k].tenant === tenant) org = d.orgs[k]; });
      var managers = org ? d.members.filter(function (x) {
        return x.org_id === org.id && x.role === "manager" && x.status === "active";
      }).map(function (x) { return x.name || x.email; }) : [];
      return Promise.resolve({
        tenant: tenant, org: org ? { id: org.id, name: org.name } : null,
        member: m ? { role: m.role, status: m.status, seat: m.seat } : null, managers: managers
      });
    },
    createOrganisation: function (name) {
      var d = db(), u = me(d), tenant = tenantOf(u.email);
      if (membership(d, u.id)) return fail("You already belong to an organisation on EntraPlus.");
      if (Object.keys(d.orgs).some(function (k) { return d.orgs[k].tenant === tenant; })) {
        return fail("Your organisation is already on EntraPlus. Your manager can approve you from their dashboard.");
      }
      var id = uid();
      d.orgs[id] = { id: id, name: name.trim(), tenant: tenant };
      d.subs[id] = { status: "none", seats: 0 };
      d.members.push({ org_id: id, user_id: u.id, email: u.email, name: u.name, role: "manager", status: "active",
                       seat: false, joined_at: new Date().toISOString() });
      // Demo only: two colleagues from the same "tenant" waiting to be approved, so the manager screen has something in it.
      ["alex.morgan", "sam.patel"].forEach(function (p, i) {
        d.members.push({ org_id: id, user_id: uid(), email: p + "@" + tenant, name: niceName(p), role: "technician",
                         status: "pending", seat: false, joined_at: new Date(Date.now() + i + 1).toISOString() });
      });
      save(d);
      return Promise.resolve(id);
    },
    joinOrganisation: function () {
      var d = db(), u = me(d), tenant = tenantOf(u.email), org = null;
      Object.keys(d.orgs).forEach(function (k) { if (d.orgs[k].tenant === tenant) org = d.orgs[k]; });
      if (!org || membership(d, u.id)) return Promise.resolve(null);
      d.members.push({ org_id: org.id, user_id: u.id, email: u.email, name: u.name, role: "technician",
                       status: "pending", seat: false, joined_at: new Date().toISOString() });
      save(d);
      return Promise.resolve(org.name);
    },
    members: function (orgId) {
      var d = db(), u = me(d), m = membership(d, u.id);
      var all = d.members.filter(function (x) { return x.org_id === orgId && x.status !== "removed"; });
      return Promise.resolve(m && m.role === "manager" && m.status === "active" ? all
        : all.filter(function (x) { return x.user_id === u.id; }));
    },
    updateMember: function (orgId, userId, patch) {
      var d = db();
      try { managerCheck(d, orgId); } catch (e) { return fail(e.message); }
      var m = d.members.filter(function (x) { return x.org_id === orgId && x.user_id === userId; })[0];
      var next = Object.assign({}, m, patch);
      if (next.status !== "active") next.seat = false;
      var managers = d.members.filter(function (x) {
        return x.org_id === orgId && x.role === "manager" && x.status === "active" && x.user_id !== userId;
      }).length;
      if (m.role === "manager" && m.status === "active" && (next.role !== "manager" || next.status !== "active") && !managers) {
        return fail("Every organisation needs at least one manager.");
      }
      var sub = d.subs[orgId] || {}, allowed = sub.status === "active" ? sub.seats : 0;
      if (next.seat && !(m.seat && m.status === "active") && seatsUsed(d, orgId, userId) >= allowed) {
        return fail("All " + allowed + " Pro seats are in use. Add seats from Billing, or take a seat from someone else first.");
      }
      Object.assign(m, next);
      save(d);
      return Promise.resolve(m);
    },
    subscription: function (orgId) {
      var d = db();
      try { managerCheck(d, orgId); } catch (e) { return fail(e.message); }
      return Promise.resolve(d.subs[orgId] || { status: "none", seats: 0 });
    },
    invoices: function (orgId) {
      var d = db();
      try { managerCheck(d, orgId); } catch (e) { return fail(e.message); }
      return Promise.resolve((d.invoices[orgId] || []).slice().reverse());
    },
    billingPortal: function (orgId, flow) {
      var d = db(), sub = d.subs[orgId];
      if (flow === "cancel" && sub) { sub.cancel_at_period_end = true; save(d); }
      return Promise.resolve({ url: "/account.html?billing=" + (flow === "cancel" ? "cancelled" : "updated") });
    },
    createAppCode: function () {
      return fail("Signing in to the desktop app needs the live account system. It isn't available in preview mode.");
    },
    appSessions: function () { return Promise.resolve([]); },
    endAppSession: function () { return Promise.resolve(); },
    /* demo only: pretend Stripe took a payment */
    simulatePurchase: function (orgId, period, seats) {
      var d = db(), end = new Date();
      end.setMonth(end.getMonth() + (period === "yearly" ? 12 : 1));
      var unit = period === "yearly" ? 12000 : 1500;
      d.subs[orgId] = { status: "active", period: period, seats: seats, unit_amount: unit, currency: "gbp",
                        current_period_end: end.toISOString(), cancel_at_period_end: false };
      (d.invoices[orgId] = d.invoices[orgId] || []).push({
        id: uid(), number: "DEMO-" + String(1000 + d.invoices[orgId].length), status: "paid", amount: unit * seats,
        currency: "gbp", seats: seats, period: period, created: new Date().toISOString(), hosted_url: "", pdf_url: ""
      });
      var manager = d.members.filter(function (x) { return x.org_id === orgId && x.role === "manager" && x.status === "active"; })[0];
      if (manager && !manager.seat && seatsUsed(d, orgId) < seats) manager.seat = true;
      save(d);
      return Promise.resolve();
    },
    cacheProfilePhoto: function () { return Promise.resolve(); },
    resetDemo: function () { localStorage.removeItem(DB_KEY); localStorage.removeItem(SESSION); return Promise.resolve(); }
  };

  /* ======================================================== Supabase: the real thing */
  var clientPromise = null;
  function sb() {
    if (!clientPromise) {
      clientPromise = import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm").then(function (m) {
        return m.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { flowType: "pkce" } });
      });
    }
    return clientPromise;
  }
  function check(res) { if (res.error) throw new Error(res.error.message); return res.data; }
  // Server functions put a friendly message in { error } when they refuse; surface that, not "non-2xx status".
  function unwrap(res) {
    if (!res.error) return res.data;
    var ctx = res.error.context;
    if (ctx && typeof ctx.json === "function") {
      return ctx.json().then(function (b) { throw new Error((b && b.error) || res.error.message); });
    }
    throw new Error(res.error.message);
  }
  function mapUser(u) {
    if (!u) return null;
    var m = u.user_metadata || {};
    return { id: u.id, email: u.email, name: m.full_name || m.name || "" };
  }

  var Supa = {
    mode: "supabase",
    signInWithMicrosoft: function (_demoEmail, returnPath) {
      return sb().then(function (c) {
        return c.auth.signInWithOAuth({ provider: "azure", options: {
          scopes: "openid profile email User.Read",
          redirectTo: location.origin + (returnPath || "/account.html"),
          queryParams: { prompt: "select_account" } } });
      }).then(check);
    },
    signOut: function () { return sb().then(function (c) { return c.auth.signOut(); }); },
    currentUser: function () {
      return sb().then(function (c) { return c.auth.getUser(); })
        .then(function (res) { return res.error ? null : mapUser(res.data.user); });
    },
    /* Right after a Microsoft sign-in, Supabase briefly holds a Microsoft token: use it once to save a small copy of
       the person's profile photo in this browser for the header. Never sent anywhere else. */
    cacheProfilePhoto: function () {
      return sb().then(function (c) { return c.auth.getSession(); }).then(function (res) {
        var s = res.data && res.data.session;
        if (!s || !s.provider_token || !s.user) return;
        var key = "ep-avatar:" + s.user.id;
        return fetch("https://graph.microsoft.com/v1.0/me/photos/64x64/$value", { headers: { Authorization: "Bearer " + s.provider_token } })
          .then(function (r) { return r.ok ? r.blob() : null; })
          .then(function (blob) {
            if (!blob) { localStorage.setItem(key, "none"); return; }
            return new Promise(function (done) {
              var fr = new FileReader();
              fr.onload = function () { localStorage.setItem(key, fr.result); done(); };
              fr.readAsDataURL(blob);
            });
          });
      }).catch(function () { /* no photo is fine */ });
    },
    state: function () { return sb().then(function (c) { return c.rpc("account_state"); }).then(check); },
    createOrganisation: function (name) {
      return sb().then(function (c) { return c.rpc("create_organisation", { org_name: name }); }).then(check);
    },
    joinOrganisation: function () { return sb().then(function (c) { return c.rpc("join_organisation"); }).then(check); },
    members: function (orgId) {
      return sb().then(function (c) {
        return c.from("members").select("user_id, email, name, role, status, seat, joined_at")
          .eq("org_id", orgId).neq("status", "removed").order("joined_at");
      }).then(check);
    },
    updateMember: function (orgId, userId, patch) {
      return sb().then(function (c) {
        return c.from("members").update(patch).eq("org_id", orgId).eq("user_id", userId).select();
      }).then(check);
    },
    subscription: function (orgId) {
      return sb().then(function (c) { return c.from("subscriptions").select("*").eq("org_id", orgId).maybeSingle(); })
        .then(check).then(function (row) { return row || { status: "none", seats: 0 }; });
    },
    invoices: function (orgId) {
      return sb().then(function (c) {
        return c.from("invoices").select("*").eq("org_id", orgId).order("created", { ascending: false });
      }).then(check);
    },
    createAppCode: function (challenge) {
      return sb().then(function (c) {
        return c.functions.invoke("app-auth", { body: { action: "code", challenge: challenge } });
      }).then(unwrap);
    },
    appSessions: function () {
      return sb().then(function (c) {
        return c.from("app_sessions").select("id, device, created_at, last_seen").eq("revoked", false)
          .order("last_seen", { ascending: false });
      }).then(check);
    },
    endAppSession: function (id) {
      return sb().then(function (c) { return c.rpc("end_app_session", { session_id: id }); }).then(check);
    },
    billingPortal: function (_orgId, flow) {
      return sb().then(function (c) {
        return c.functions.invoke("billing-portal", { body: { flow: flow || "manage" } });
      }).then(unwrap);
    }
  };

  window.EPAuth = cfg.mode === "supabase" && cfg.supabaseUrl && cfg.supabaseAnonKey ? Supa : Demo;
})();
