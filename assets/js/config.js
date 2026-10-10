/* Site settings. This is the only file you need to edit to go live. */
window.EP_CONFIG = {
  // Google Analytics 4 measurement ID, e.g. "G-ABC123XYZ". Blank = no analytics and no cookie banner.
  gaId: "",

  // Where the download buttons point, e.g. your GitHub release assets:
  // "https://github.com/YOURNAME/entraplus/releases/latest/download/EntraPlus-Setup.exe"
  downloads: {
    installer: "",
    portable: ""
  },

  // Accounts. "demo" keeps everything in this browser only (for building and testing pages).
  // Switch to "supabase" once your Supabase project is set up (see backend/README.md).
  auth: {
    mode: "demo",
    supabaseUrl: "",
    supabaseAnonKey: ""
  },

  // Stripe Payment Links for each plan, and the customer portal link for "Change seats or plan".
  // These are TEST-MODE links from the "EntraPlus sandbox" account: no real money moves.
  // Swap them for live-mode links when you go live (see backend/README.md, "Going live").
  stripe: {
    monthly: "https://buy.stripe.com/test_bJeaEXeoh2gi9BWg0w7Vm00",
    yearly: "https://buy.stripe.com/test_3cI00j4NHf34cO801y7Vm01",
    portal: "https://billing.stripe.com/p/login/test_bJeaEXeoh2gi9BWg0w7Vm00"
  }
};
