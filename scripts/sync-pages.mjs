// Keeps DinoTree's "dinos that have a page" list (TOTALDINO_PAGES in index.html) in step with your totaldino.com sitemap.
// It only ever ADDS names, never removes any, and never touches the answer list (TARGET_POOL), which stays hand-picked.
// Run by the GitHub workflow every night, or by hand from the repo's Actions tab.
import fs from 'node:fs';

const SITEMAP = process.env.SITEMAP_URL || 'https://www.totaldino.com/sitemap.xml';
const FILE = process.env.GAME_FILE || 'index.html';

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'dinotree-page-sync' } });
  if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
  return r.text();
}
const locs = xml => [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));

const html = fs.readFileSync(FILE, 'utf8');
const pagesRe = /const TOTALDINO_PAGES = new Set\((\[.*?\])\)/s;
const pages = JSON.parse(html.match(pagesRe)[1]);
const genera = Object.keys(JSON.parse(html.match(/const GENUS_PARENT = (\{.*?\});\n/s)[1]));
const byLower = new Map(genera.map(g => [g.toLowerCase(), g]));

// 1. every URL in the sitemap (following a sitemap index into its child sitemaps)
let root;
try { root = await get(SITEMAP); } catch (e) { console.error('Could not read the sitemap, so nothing was changed:', e.message); process.exit(1); }
let urls = [];
if (/<sitemapindex/i.test(root)) {
  for (const child of locs(root)) { try { urls.push(...locs(await get(child))); } catch (e) { console.warn('Skipped', child, '-', e.message); } }
} else urls = locs(root);
urls = [...new Set(urls)];
if (!urls.length) { console.error('No URLs found in the sitemap, so nothing was changed.'); process.exit(1); }

// 2. a URL counts as a dinosaur page when its last path piece is exactly a genus in the game's family tree
const pathOf = u => { try { return new URL(u).pathname.split('/').filter(Boolean).map(x => decodeURIComponent(x).toLowerCase()); } catch { return []; } };
const slugOf = u => pathOf(u).slice(-1)[0] || '';
const dirOf = u => '/' + pathOf(u).slice(0, -1).join('/');
const exact = new Set(), possible = new Map(), dirVotes = {};
for (const u of urls) {
  const slug = slugOf(u); if (!slug) continue;
  if (byLower.has(slug)) { exact.add(byLower.get(slug)); dirVotes[dirOf(u)] = (dirVotes[dirOf(u)] || 0) + 1; continue; }
  for (const tok of slug.split('-')) if (tok.length > 3 && byLower.has(tok)) possible.set(u, byLower.get(tok)); // reported only, never added
}
// Wix won't allow page addresses of 4 letters or fewer, so dinos like Zuul or Tawa need a longer address (e.g. /zuul-something).
// For those short names, accept a page that sits in the same folder as the other dinosaur pages and has the name as one
// hyphen-separated word of its address. (Pages elsewhere, such as blog posts, are ignored.)
const shortFound = new Map();
const dinoDir = Object.entries(dirVotes).sort((x, y) => y[1] - x[1])[0]?.[0];
if (dinoDir !== undefined) for (const u of urls) {
  const slug = slugOf(u); if (!slug || byLower.has(slug) || dirOf(u) !== dinoDir) continue;
  for (const tok of slug.split('-')) { const g = byLower.get(tok); if (g && g.length <= 4 && !shortFound.has(g)) { shortFound.set(g, u); exact.add(g); possible.delete(u); } }
}

// 3. add the new ones
const have = new Set(pages), added = [...exact].filter(g => !have.has(g)).sort(), unseen = pages.filter(g => !exact.has(g));
console.log(`Sitemap URLs read: ${urls.length}`);
console.log(`Dinosaur pages recognised (exact name match): ${exact.size}`);
console.log(`Already on the game's page list: ${pages.length}`);
console.log(`Added now: ${added.length ? added.join(', ') : 'none'}`);
if (shortFound.size) console.log(`Short-named dinosaurs recognised from longer page addresses: ` + [...shortFound].map(([g, u]) => `${g} <- ${u}`).join('; '));
if (unseen.length) console.log(`On the game's list but not found in the sitemap (${unseen.length}, left alone): ${unseen.join(', ')}`);
if (possible.size) console.log(`Possible dinosaur pages with longer addresses (NOT added; check them):\n  ` + [...possible].map(([u, g]) => `${g}  <-  ${u}`).join('\n  '));
if (!exact.size) console.log('No exact matches at all: your page addresses probably look different from /genus-name. Sample addresses:\n  ' + urls.slice(0, 12).join('\n  '));
if (added.length) fs.writeFileSync(FILE, html.replace(pagesRe, () => 'const TOTALDINO_PAGES = new Set(' + JSON.stringify(pages.concat(added)) + ')'));
