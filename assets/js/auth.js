/* EntraPlus accounts.
   The pages only ever call window.EPAuth, so switching from "demo" to "supabase" in
   config.js is the only change needed when the backend is ready.

   Interface (all return Promises):
     signUp({ name, organisation, email, password }) -> { user, needsConfirmation }
     signIn(email, password)                         -> user
     signOut()
     currentUser()                                   -> user or null
     updateProfile({ name, organisation })           -> user
     resetPassword(email)
     subscription()  -> { plan: "free"|"pro", period, status, renews, licenceKey }
   user = { id, email, name, organisation } */
(function () {
  "use strict";
  var cfg = ((window.EP_CONFIG || {}).auth) || { mode: "demo" };

  function fail(message) { return Promise.reject(new Error(message)); }

  /* ---------- demo: everything stays in this browser ---------- */
  var USERS = "ep-demo-users", SESSION = "ep-demo-session";
  function load() { try { return JSON.parse(localStorage.getItem(USERS)) || {}; } catch (e) { return {}; } }
  function save(users) { localStorage.setItem(USERS, JSON.stringify(users)); }
  function hash(text) {
    if (window.crypto && crypto.subtle && window.isSecureContext) {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      });
    }
    return Promise.resolve("plain:" + text.length);
  }
  function publicUser(u) { return u ? { id: u.id, email: u.email, name: u.name, organisation: u.organisation } : null; }

  var Demo = {
    mode: "demo",
    signUp: function (d) {
      var users = load(), email = d.email.trim().toLowerCase();
      if (users[email]) return fail("There's already an account for that email. Log in instead.");
      return hash(d.password).then(function (h) {
        users[email] = { id: "demo-" + Math.random().toString(36).slice(2, 10), email: email, name: d.name.trim(),
                         organisation: (d.organisation || "").trim(), pw: h, sub: null };
        save(users);
        localStorage.setItem(SESSION, email);
        return { user: publicUser(users[email]), needsConfirmation: false };
      });
    },
    signIn: function (email, password) {
      var users = load(), u = users[email.trim().toLowerCase()];
      return hash(password).then(function (h) {
        if (!u || u.pw !== h) throw new Error("That email and password don't match an account.");
        localStorage.setItem(SESSION, u.email);
        return publicUser(u);
      });
    },
    signOut: function () { localStorage.removeItem(SESSION); return Promise.resolve(); },
    currentUser: function () { return Promise.resolve(publicUser(load()[localStorage.getItem(SESSION)])); },
    updateProfile: function (d) {
      var users = load(), u = users[localStorage.getItem(SESSION)];
      if (!u) return fail("You're signed out. Log in again.");
      u.name = d.name.trim(); u.organisation = (d.organisation || "").trim();
      save(users);
      return Promise.resolve(publicUser(u));
    },
    resetPassword: function () { return Promise.resolve(); },
    subscription: function () {
      var u = load()[localStorage.getItem(SESSION)];
      return Promise.resolve(u && u.sub ? u.sub : { plan: "free", status: "none" });
    },
    /* demo only: pretend a payment went through, to preview the Pro account page */
    simulatePro: function (period) {
      var users = load(), u = users[localStorage.getItem(SESSION)];
      var renews = new Date(); renews.setMonth(renews.getMonth() + (period === "yearly" ? 12 : 1));
      u.sub = { plan: "pro", period: period, status: "active", renews: renews.toISOString().slice(0, 10),
                licenceKey: "DEMO-ONLY.this-is-not-a-real-licence-key-" + Math.random().toString(36).slice(2) };
      save(users);
      return Promise.resolve(u.sub);
    },
    clearSubscription: function () {
      var users = load(), u = users[localStorage.getItem(SESSION)];
      if (u) { u.sub = null; save(users); }
      return Promise.resolve();
    }
  };

  /* ---------- Supabase: real accounts (see backend/README.md) ---------- */
  var clientPromise = null;
  function sb() {
    if (!clientPromise) {
      clientPromise = import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm").then(function (m) {
        return m.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      });
    }
    return clientPromise;
  }
  function mapUser(u) {
    if (!u) return null;
    var m = u.user_metadata || {};
    return { id: u.id, email: u.email, name: m.name || "", organisation: m.organisation || "" };
  }
  function check(res) { if (res.error) throw new Error(res.error.message); return res.data; }

  var Supa = {
    mode: "supabase",
    signUp: function (d) {
      return sb().then(function (c) {
        return c.auth.signUp({ email: d.email.trim(), password: d.password, options: {
          data: { name: d.name.trim(), organisation: (d.organisation || "").trim() },
          emailRedirectTo: location.origin + "/account.html" } });
      }).then(check).then(function (data) {
        return { user: mapUser(data.user), needsConfirmation: !data.session };
      });
    },
    signIn: function (email, password) {
      return sb().then(function (c) { return c.auth.signInWithPassword({ email: email.trim(), password: password }); })
        .then(check).then(function (data) { return mapUser(data.user); });
    },
    signOut: function () { return sb().then(function (c) { return c.auth.signOut(); }); },
    currentUser: function () {
      return sb().then(function (c) { return c.auth.getUser(); })
        .then(function (res) { return res.error ? null : mapUser(res.data.user); });
    },
    updateProfile: function (d) {
      return sb().then(function (c) {
        return c.auth.updateUser({ data: { name: d.name.trim(), organisation: (d.organisation || "").trim() } });
      }).then(check).then(function (data) { return mapUser(data.user); });
    },
    resetPassword: function (email) {
      return sb().then(function (c) {
        return c.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + "/account.html" });
      }).then(check);
    },
    subscription: function () {
      return sb().then(function (c) {
        return c.from("licences").select("plan, period, status, expires, licence_key").maybeSingle();
      }).then(check).then(function (row) {
        if (!row) return { plan: "free", status: "none" };
        return { plan: row.plan, period: row.period, status: row.status, renews: row.expires,
                 licenceKey: row.status === "active" ? row.licence_key : null };
      });
    }
  };

  window.EPAuth = cfg.mode === "supabase" && cfg.supabaseUrl && cfg.supabaseAnonKey ? Supa : Demo;
})();
