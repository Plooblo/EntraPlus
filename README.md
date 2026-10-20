# entraplus.co.uk

The EntraPlus website: a one-page product site plus log-in, registration and account pages. It's plain HTML, CSS and JavaScript with no build step and no frameworks, so it's fast, cheap to host and easy to edit.

```
index.html                  the landing page
login.html, register.html   accounts (demo mode until the backend is set up)
account.html                profile, plan and licence key
privacy.html, 404.html
assets/js/config.js         <- the only file you need to edit to go live
assets/js/toolkit-data.js   every app action shown in the toolkit explorer and hero search
assets/js/site.js           page behaviour
assets/js/auth.js           accounts: demo now, Supabase later
assets/css/site.css         all styling, light and dark
assets/img/brand/           logo files (SVG master + PNG)
assets/img/shots/           app screenshots (WebP)
backend/                    Supabase table and Stripe webhook (see backend/README.md)
CNAME                       tells GitHub Pages the domain
```

## Try it on your PC

From this folder:

```
python -m http.server 8000
```

Then open http://localhost:8000. It needs a local server rather than double-clicking the file, because the pages use absolute paths like `/assets/...`, just as they will on the live domain.

## Put it online with GitHub Pages

1. Create a GitHub repository, e.g. `entraplus-site`, and upload everything in this folder. The `CNAME` and `.nojekyll` files must sit at the top level.
2. **Settings > Pages:** set Source to "Deploy from a branch", branch `main`, folder `/ (root)`.
3. **Custom domain:** enter `entraplus.co.uk`. The CNAME file already says this.
4. At your domain registrar, set these DNS records. Remove any old A records for the bare domain first.

   | Type | Name | Value |
   |---|---|---|
   | A | @ | 185.199.108.153 |
   | A | @ | 185.199.109.153 |
   | A | @ | 185.199.110.153 |
   | A | @ | 185.199.111.153 |
   | AAAA | @ | 2606:50c0:8000::153 |
   | AAAA | @ | 2606:50c0:8001::153 |
   | AAAA | @ | 2606:50c0:8002::153 |
   | AAAA | @ | 2606:50c0:8003::153 |
   | CNAME | www | YOURGITHUBNAME.github.io |

5. Once GitHub shows the DNS check as passed, tick **Enforce HTTPS**. It can take up to an hour for the certificate to appear.
6. Optional but recommended: in your GitHub account settings, under Pages, verify the domain so nobody else can claim it on GitHub.

## Download buttons

Upload `EntraPlus-Setup-x.y.z.exe` and the portable zip to a **GitHub Release**, either in this repository or a separate app repository. Then put the links in `config.js`. Use the `latest/download/` form so the buttons always point at the newest version:

```
https://github.com/YOURNAME/entraplus/releases/latest/download/EntraPlus-Setup.exe
```

(Name the release files without the version number for that to work, or update `config.js` each release.)

## Google Analytics

1. Create a GA4 property at analytics.google.com, add a web data stream for `https://entraplus.co.uk`, and copy the measurement ID (`G-…`).
2. Paste it into `gaId` in `config.js`.

Visitors then see a small banner. Analytics only loads if they choose "Allow analytics", which is what UK law (PECR and UK GDPR) requires for analytics cookies. It also means Google's script doesn't slow the first page load. People can change their mind from the privacy page.

## Being found on Google

Already done in the pages:
- Descriptive titles and meta descriptions, canonical URLs, and Open Graph and Twitter preview cards (`og-image.png`).
- Structured data: Organization, SoftwareApplication with Free and Pro pricing, and FAQPage. These can show richer results in Google.
- `sitemap.xml` and `robots.txt`. The log-in and account pages are kept out of search results.
- Fast loading: two subset fonts, WebP images that load as you scroll, about 20 KB of JavaScript, and no tracking until consent.
- Accessibility: proper headings, labels, alt text, keyboard support and visible focus. Checked with axe-core on every page, with zero issues found.

What actually moves rankings from here:
1. **Google Search Console.** Add `entraplus.co.uk` as a Domain property (verify with a DNS TXT record), submit the sitemap, and watch which searches you appear for.
2. **Helpful pages for real searches.** For example "how to find a BitLocker recovery key in Intune", "bulk create users in Entra from CSV" or "convert a mailbox to shared for a leaver". Short how-to pages that end with "or do it in one click with EntraPlus" are how small tools win search traffic. The toolkit data already has the PowerShell for each.
3. **Links from other sites.** School IT forums, the EduGeek community, LinkedIn posts, a GitHub README, and listings on software directories.

Nobody can guarantee the top spot. These steps are what give you the best chance.

## Running Lighthouse yourself

In Chrome, open the live site, press F12, go to the Lighthouse tab, and run Mobile and Desktop. Test the live HTTPS site rather than a local file. If performance dips, the usual cause is a large image; re-export it smaller as WebP.

## Editing content

- **Text:** edit `index.html` directly.
- **Toolkit table and hero search:** `assets/js/toolkit-data.js`. One line per action, in the same order as the comment at the top.
- **Prices:** search for "£" in `index.html` and `account-pages.js`, and update the structured data `offers` in `index.html`.
- **Colours:** the variables at the top of `site.css`, for dark and light separately.
- **Screenshots:** replace files in `assets/img/shots/` with the same names and size (1600 and 960 pixels wide, WebP).
