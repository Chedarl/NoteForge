import { chromium } from "playwright-core";

/**
 * Does every page hang off the same left edge as the navigation?
 *
 * The desktop bug this was written for was not a broken layout — nothing
 * overflowed, nothing overlapped, and every check in the repository stayed
 * green. The portal pages simply re-centred a phone-width column inside the
 * already-centred shell, so the heading sat two hundred pixels right of the
 * logo above it. On a phone every cap is wider than the screen, so all of it
 * collapses to full width and looks correct, which is why it only ever showed
 * up on a laptop.
 *
 * So this measures the one thing that was wrong: the gap between the left edge
 * of the navigation bar's content and the left edge of the page's own content.
 * A tolerance rather than an equality, because a card with a border and a
 * shadow legitimately sits a pixel or two off.
 */
const BASE = process.env.BASE ?? "http://localhost:3006";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TOLERANCE = 4;

const SUITES = [
  { who: "caseworker@noteforge.test", paths: ["/t", "/t/write", "/t/new", "/t/clients", "/t/team", "/t/profile", "/t/upload"] },
  { who: "specialist@noteforge.test", paths: ["/s", "/s/clients", "/s/export", "/s/insights", "/s/audit"] },
];

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
let failures = 0;

for (const width of [1280, 1440]) {
  for (const suite of SUITES) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    // `networkidle`, not `domcontentloaded`: the sign-in form is a server action
    // and clicking it before the page has hydrated posts into nothing.
    await page.goto(`${BASE}/dev-signin`, { waitUntil: "networkidle" });
    // Wait for the URL to actually leave the sign-in page rather than for a
    // load state. A server action posts and then redirects, and "networkidle"
    // can settle on the sign-in page itself between the two.
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith("/dev-signin"), { timeout: 20000 }),
      page.locator("form", { hasText: suite.who }).locator("button").first().click(),
    ]);

    for (const path of suite.paths) {
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      const r = await page.evaluate(() => {
        const navInner = document.querySelector("header a[aria-label='NoteForge']");
        const main = document.querySelector("main");
        const first = main?.firstElementChild;
        if (!navInner || !first) return null;
        return {
          nav: Math.round(navInner.getBoundingClientRect().left),
          content: Math.round(first.getBoundingClientRect().left),
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
        };
      });
      if (!r) {
        // A page that cannot be measured is a failure, never a pass. The first
        // version of this script skipped them and then printed "every page
        // lines up" having measured nothing at all — a green that meant the
        // sign-in had silently failed.
        failures++;
        const url = page.url().replace(BASE, "");
        console.log(`  FAIL ${width} ${path.padEnd(12)} nothing to measure (landed on ${url})`);
        continue;
      }
      const drift = Math.abs(r.nav - r.content);
      const overflows = r.scrollW > r.clientW + 1;
      const bad = drift > TOLERANCE || overflows;
      if (bad) failures++;
      console.log(
        `  ${bad ? "FAIL" : "ok  "} ${width} ${path.padEnd(12)} nav=${r.nav} content=${r.content} drift=${drift}${overflows ? ` OVERFLOW ${r.scrollW}>${r.clientW}` : ""}`
      );
    }
    await ctx.close();
  }
}
await browser.close();
if (failures > 0) {
  console.error(`\n${failures} page(s) do not line up with the navigation.`);
  process.exit(1);
}
console.log("\nEvery page lines up with the navigation, at both widths.");
