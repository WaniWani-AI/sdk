---
name: claude-submission
description: Prepare and submit an MCP server / MCP App to the Claude Connectors Directory. Use when porting an MCP app to claude.ai, getting its widgets to render in Claude, auditing it against Claude's review criteria, assembling the directory listing, or walking the submission portal/form. Captures hard-won gotchas (the ui.domain render check, behavioral tool-description rejections, the Google Form traps).
user-invocable: true
license: MIT
metadata:
  author: WaniWani
---

# Claude Connectors Directory — submission skill

Distilled from `claude.com/docs/connectors/building/submission.md` +
`/review-criteria.md` **plus** what we hit shipping real MCP apps (built on
`@waniwani/sdk` + the skybridge template). This is a living doc — when a
submission teaches you something, edit it here.

> The same MCP server can list in both the **Claude** and **OpenAI/ChatGPT**
> directories, but the two hosts differ in render mechanics, review rules, and
> paperwork. Don't assume an OpenAI-passing app passes Claude — see § Render and § Review.

## How to run this — YOU drive it end-to-end via Claude for Chrome

This skill is **executed by you, the agent** — you fill and drive the submission
form yourself; you do not hand the steps to the user as a to-do list. The public
submission is a Google Form, and the reliable way to drive it is **Claude for
Chrome** (claude.ai is behind Cloudflare Turnstile, so `agent-browser`/headless
can't reach it — Claude for Chrome drives the user's real, logged-in session).

1. Get a Claude-for-Chrome / browser-control tool wired up (load its tools via
   ToolSearch if they're behind an MCP server).
2. Open a tab → `navigate` to `clau.de/mcp-directory-submission` → drive all 6
   pages: `read_page`/`find` for refs, `form_input` for text/textarea,
   **ref-click + screenshot-verify** for radios/checkboxes (§5), `Suivant` between
   pages. Fill from the Phase-0 cheat sheet.
3. **Stop before "Envoyer" (submit)** unless the user says go. The final-page legal
   attestations are the user's to authorize — ask before ticking (they may delegate).

**Inherent human-gated steps** (you can't do these — set them up with the user):
- User logged into **claude.ai** in that Chrome (real session, past Cloudflare).
- The org Google account is the browser's **default** — use a dedicated Chrome
  profile, or the form resets mid-way (account-revert trap, §5).
- **Google Drive upload + sharing** of the logo SVG + screenshots (you may not
  change sharing permissions) — user uploads and pastes the links.
- Final **review + Envoyer** click.

## 0. Fast path

0. **Audit the repo → draft the cheat sheet** (§0.5) — Claude's submission is a
   manual Google Form (no JSON upload like the ChatGPT path), so the artifact you
   generate is a **cheat sheet** of field values, not a file.
1. **Confirm widgets render** (§1) — for skybridge apps this is usually already
   correct; the job is to *verify*, not fix.
2. **Audit against review criteria** (§2) — esp. tool-description language + read/write split.
3. **Assemble the listing** (§3) and **screenshots** (§4).
4. **Submit** via the right path (§5) and clear the **pre-submission checklist** (§6).

## 0.5 Audit the repo → draft the cheat sheet (do this first)

There is no JSON upload — so inspect the repo and produce a **cheat sheet** (write
it somewhere scratch, e.g. `docs/plans/…`) that becomes the single copy-paste
source for the form (and lets you re-fill fast if the form resets). Pull, from the repo:

- **Prod URL + hash.** Find the production base URL (config, `baseUrl.ts`, the
  deploy domain). The form's Server URL = `<prod>/mcp`. Compute its required
  `ui.domain` hash (§1) and **curl the live server with the Claude UA** to confirm
  it's actually served (§Verify). Confirm the favicon exists + assets are absolute.
- **Tools.** Read the server's tool definitions (+ widgets). For each tool: `name`,
  `title`, `readOnlyHint`/`destructiveHint`, and a one-line human description. →
  feeds "List of tools" (`name (Human Name)`), "Tool Titles & Annotations", Read/Write.
- **Resources / prompts.** List widget resources (`name (Human name)`) and any MCP prompts.
- **Behavioral-copy grep.** Grep tool descriptions **and** any runtime response
  injection for "MANDATORY / never / you MUST / always call" → soften per §2 before submitting.
- **Listing fields.** Name, tagline (≤55), description (50–100 words), 1 category,
  doc URL, privacy/terms/support URLs, icon (SVG for Server Logo). Reuse any existing
  OpenAI-submission / client-onboarding notes if present — most fields carry over.
- **Scope/attestation facts.** Auth type, transport, money/transactions? cross-service?
  PII/analytics? GA? surfaces tested? → pre-answers pages 4 & 6.

Output = a filled cheat sheet covering every field in §5's page map. Then drive
the form from it.

## 1. Render: the `ui.domain` check (MCP Apps)

Claude rehosts widget HTML in a sandboxed iframe and **validates
`Resource._meta.ui.domain`** against a deterministic value. Wrong value → the
widget silently never mounts (error: *"Invalid ui.domain format: expected
{hash}.claudemcpcontent.com"*).

```
ui.domain = sha256(<full server URL incl. /mcp, no trailing slash>).hex.slice(0,32) + ".claudemcpcontent.com"
```
```bash
node -e 'console.log(require("crypto").createHash("sha256").update("https://example.com/mcp").digest("hex").slice(0,32)+".claudemcpcontent.com")'
# https://example.com/mcp -> c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com   (Anthropic's own example — use as a known-answer test)
```

- It's per-server-URL, so **staging and prod hash to different hosts** — never hardcode.

### If you built on the skybridge template (`registerWidget`) — likely already correct

**skybridge (≥0.35.x) emits the right `ui.domain` for you.** Its widget read
handler detects Claude via `user-agent: Claude-User` and serves
`sha256(serverUrl + /mcp).claudemcpcontent.com` on the `text/html;profile=mcp-app`
variant automatically. **There is nothing to fix — just verify** (§Verify).

> ⚠️ **Footgun: a plain curl shows the *deploy host*, not the hash — and that is NOT a bug.**
> skybridge only emits the hash when the request carries `user-agent: Claude-User`.
> Without that header it falls back to the deploy host (`https://your-app…`). So a
> naive `curl … resources/read` looks "broken" when the app is actually fine. **Always
> send `-H 'user-agent: Claude-User'` when verifying** (§Verify). The pixels-level
> confirmation is still a human in claude.ai.

### If you built on the legacy `@waniwani/sdk` `createResource` (Next.js) path

`createResource` does **not** emit `ui.domain` on the mcp-app variant, so Claude
has nothing to validate and the widget won't mount. Fix app-local with a
post-register monkeypatch that wraps the mcp-app resource's `readCallback` and sets
`_meta.ui.domain` to the hash. **Only touch the `text/html;profile=mcp-app`
variant** — the `text/html+skybridge` variant is ChatGPT's; leave it on the deploy
host or you break the live ChatGPT app. Derive the host from your runtime base URL.
(New apps should prefer the skybridge template, which handles this for you.)

**Assets:** Claude's sandbox is a different origin, so root-relative `/_next/...`
chunks 404. Serve assets as **absolute URLs** (Next: `assetPrefix = baseURL`) and
list that host in `_meta.ui.csp.resourceDomains`. A `<base>` tag draws a cosmetic
"CSP off" badge under `base-uri 'self'` but doesn't break render if assets are absolute.

**CSP** (`_meta.ui.csp`): `connectDomains` (fetch/XHR/WS — include any analytics or
token-mint host the iframe calls, e.g. `app.waniwani.ai`), `resourceDomains`
(scripts/css/img/fonts), `frameDomains`, `redirectDomains`. The sandbox blocks
everything not listed. Debug via DevTools "Refused to…" errors.

**Render confirmation is visual** — `curl` proves the protocol; only a human (or
non-bot browser) in claude.ai proves the pixels. claude.ai is behind Cloudflare
Turnstile, so headless automation usually can't reach it — plan for a human eyeball.

## 2. Review criteria (rejection risks) — `/review-criteria.md`

Reviewers **functionally test every tool**. Audit the repo against:

- **Read/write split — hard reject.** "A single tool that accepts both safe
  (GET/HEAD/OPTIONS) and unsafe (POST/PUT/PATCH/DELETE) methods is rejected."
  Read-only and mutating ops must be **separate tools**. Set `readOnlyHint: true`
  on read tools, `destructiveHint: true` on delete/modify.
- **Tool names ≤ 64 chars.** `title` mandatory on every tool.
- **Descriptions must match behavior** and **describe function only, not Claude's
  behavior.** ⚠️ **Biggest portability trap.** These get a tool **rejected**:
  - instructing Claude to invoke other/external tools,
  - interfering with Claude's tool-calling ("you MUST call X", "always call this
    first", "never answer from memory"),
  - hidden/obfuscated directives, overriding system instructions, promoting
    unrelated services.
  Aggressive ChatGPT-tuned routing copy (e.g. "MANDATORY… never answer from your
  own knowledge", forced widget-chain directives) is exactly this. **Grep the tool
  descriptions and any runtime response that injects instructions** before
  submitting; soften or make host-aware for Claude.
  - **Prefer softening globally over host-aware** unless routing demonstrably
    depends on the aggressive copy. In practice, softening tool descriptions to
    function-only kept routing working on both hosts (the aggression had rarely
    helped ChatGPT). Accurate descriptions route fine on Claude.
  - **Runtime instruction injection is the gray area.** A response that rewrites
    `content[0].text` into "you MUST call tool X" (a widget-chain directive) is the
    same class of behavior in the *response* rather than the *descriptor*. The
    criteria text targets descriptions, but reviewers functionally test tools and
    may see it. If it's load-bearing (ChatGPT render), leaving it is a judgment
    call — flag it and watch the review.
- **Freeform-path tools** must link to the target API docs (fixed-endpoint tools exempt).
- **Functional quality:** valid calls return meaningful data; input validation with
  actionable errors; response size fits the task.
- **No conversation-data collection beyond functional necessity**; never query
  Claude memory / chat history / user files. (Disclose analytics in the privacy policy.)
- **First-party APIs only** / legitimately proxied; domain ownership aligned.
- **Unsupported categories:** money/crypto transfers, AI-generated image/video/audio.

## 3. Listing fields

| Field | Limit | Notes |
|-------|-------|-------|
| Server name | 100 | public title |
| Tagline | 55 | brief descriptor |
| Description | 2,000 | full overview |
| Categories | 1–5 | |
| Icon | — | required (reuse the OpenAI 512² if you have one) |
| Documentation URL | — | **public** setup/usage docs **required by publish date** — a product/help page works, but page-6 compliance wants "setup + tool descriptions + **troubleshooting**", so a purpose-built connector page (mirror the privacy page) with a troubleshooting section ticks that box cleanly. Reviewers may push back on a bare product page. |
| Privacy policy URL | — | HTTPS; missing/incomplete = **immediate reject** |
| Support contact | — | |
| URL slug | — | **permanent once published** |

## 4. Screenshots (MCP Apps)

PNG, **≥1000px wide**, **3–5** images, **cropped to the widget response only (no
prompt)**, any aspect ratio, with a **paired prompt** supplied per image. No
video/GIF. One batch covers desktop+mobile. (Figma template in Anthropic's MCP
Apps community file.)

## 5. Submission paths

- **Team/Enterprise org** → in-app portal `claude.ai/admin-settings/directory/submissions/new`
  (org Owner/Primary owner, or a delegated **Directory management** role).
- **No Team/Enterprise** → public form **`clau.de/mcp-directory-submission`**.
  This redirects to a **Google Form** ("MCP Directory Submission Form"). Notes:
  it records the **submitter's Google account email** — submit from the right org
  account (switch via the form's "Switch account" link before filling); page 6 has an
  explicit **"I have reviewed and agree to the Software Directory Policy"** checkbox
  the submitter must tick (a legal sign-off — leave it for the user); it
  states submission "does not guarantee inclusion"; for updates to an existing
  listing, email `mcp-review@anthropic.com`. It's the correct form for remotely
  hosted **MCP Apps** (not just plain servers).
- **Desktop ext (MCPB)** → `clau.de/desktop-extention-submission`.

**Filling the Google Form (Claude-for-Chrome notes).** It's a **6-page** form:
p1 intro · p2 Company + Server + Auth/Docs · p3 Test Account + tools/resources/prompts ·
p4 Launch readiness + logo/favicon/screenshots · p5 Skills & Plugins (optional) ·
p6 compliance checklist + Envoyer. The whole text body is fillable in one pass via
`form_input` (refs reset per page); the friction is all checkboxes + page advances.
Gotchas learned filling it:
- `form_input` by ref works reliably for text/textarea (incl. unicode €, accents),
  but **NOT for checkboxes/radios** — Forms renders them as DIVs, so `form_input`
  errors ("Element type DIV is not a supported form input"). (To *clear* a textarea,
  `form_input` won't accept `""` — triple-click + `cmd+a` + Delete instead.)
- **Tick checkboxes/radios with a ref-click (NOT a coordinate click),
  screenshot-verifying per group.** Ref-clicks auto-scroll the box into view and were
  reliable across ~18 boxes in one full run. **Coordinate clicks drift**: a
  `form_input` on a text field auto-scrolls the viewport, so a coordinate read from an
  earlier screenshot lands on the wrong element (cost several silent misses). Use
  `scroll_to {ref}` to reposition, then click the ref. Screenshot-verify either
  way. Required-but-empty questions show "Cette question est obligatoire" (FR locale).
- Switch to the correct **org Google account** via the form's "Switch account"
  before filling (account switch can leave a stale duplicate tab — use the one
  whose footer shows the right email).
- ⚠️ **Account-revert trap (can cost a full page of answers):** if the org account
  is NOT the browser's *default* Google account, clicking "Suivant"/Next can make
  Google Forms **revert to the default account and reset the form to page 1**,
  losing everything entered. Mitigations: make the org account the **default**
  Google account first (or use a Chrome profile where it is), keep the **cheat
  sheet** so re-filling is fast, and verify the footer email still shows the org
  account before each Next. Also: a long page advance can transiently drop the
  extension's host permission ("Extension manifest must request permission…") —
  re-grant on the tab and continue.
- **Data Handling checklist requires ≥3 options** ("Vous devez sélectionner au
  minimum 3 options"). Truthful set for a no-PII compute+retrieval app: "only
  accesses explicitly-requested data" + "encrypted (HTTPS/TLS)" + "GDPR compliant
  (if applicable)". Don't check "no data stored beyond session" if analytics/
  tracking persists events.
- The submitter's **Google account email ≠ the listing company.** Put the brand in
  the Company field (submitted "in the name of" by the operator); the submitter
  account/primary-contact email can be the operator.
- **Min-N selection traps** beyond Data Handling: "Confirm testing is complete in:"
  requires **≥2** surfaces (Claude.ai web, Desktop, Code, Cowork — note says Code/
  Cowork not required, but the field still forces 2). Pick only surfaces actually
  tested; Desktop shares the exact mcp-app render path as web.
- **Page 3 (Test Account Access + Server Technical Details):** Testing Account
  Credentials (required — for no-auth, say "no credentials, open server" + connect
  URL + test prompts); test server URL (blank if same); setup instructions; test-
  data checkboxes; **List of tools** (required, `tool_name (Human Name)` comma-sep);
  **Tool Titles & Annotations** (required — two checkboxes: titles + annotations);
  list of resources; list of prompts.
- **Page 4 (Launch Readiness & Listing Media) — media are URLs/links, NOT uploads:**
  GA date (blank if already GA); confirm-testing (≥2, above); **Server Logo**
  (required — an **SVG**, as a URL; *Google Drive link is accepted*); **Server Logo
  URL favicon checkbox** (required — the directory fetches the tool-call/listing
  logo via `google.com/s2/favicons?domain=<DOMAIN>&sz=64`; verify it shows the right
  logo before ticking — note the *brand* domain's favicon may be correct while the
  *server* domain's is blank — `curl` `s2/favicons?domain=<server>&sz=64` and
  md5-compare it to a no-favicon domain to detect the default globe). **Favicon fix:**
  the server domain is often blank because the framework serves `app/icon.png` at
  `/icon.png` but Google's s2 prioritizes `/favicon.ico` (which 404s) — add
  `public/favicon.ico` (multi-size, from the icon), deploy, then tick. The form's own
  help says "update the favicon **on the site** for your MCP URL", so once the site
  serves the right favicon you can tick "verified" even though s2's cache lags
  (Google's lag, not your incorrectness). Promotional Images (optional — a
  Drive/Dropbox link to screenshots, not a direct upload). **It's a single-line input —
  it strips newlines**, gluing pasted URLs to adjacent text; space-delimit each link.
  So logo SVG + screenshots need to live on Drive/a public URL first (the user uploads
  + shares — you can't set Drive perms; identify which link is which by `WebFetch`-ing
  each /view page's title).
- **Page 5 (Skills & Plugins) — optional, skip for a plain MCP submission.** All fields
  ("This is not required for MCP server submission"); leave blank unless co-submitting a Skill.
- **Page 6 (Submission Requirements Checklist) — four required checkbox groups, each with
  a minimum-N:** **Policy Compliance ≥5** (all 5 — incl. two legal attestations the user
  must personally tick: "agree to the Software Directory Policy" + "I work for the company
  that owns/controls the API endpoint" — the latter is fine to tick when submitting *as*
  the API-owning brand with their authorization). **Technical Requirements ≥5 of 6** —
  for a no-auth server, **skip OAuth and tick the other 5** (safety annotations, HTTPS,
  CORS, "IPs allowlisted (if applicable)", "tested on latest") = exactly 5. **Documentation
  Requirements (all 4)** — incl. "docs include setup + tool descriptions + **troubleshooting
  guide**", so the docs/guide page must have a troubleshooting section. **Testing
  Requirements (3)** — the two "(if relevant)" ones are tickable as satisfied/N-A for an
  open server. Then an **optional Additional Information** field — **leave it blank or
  neutral; do NOT name a competitor (ChatGPT/OpenAI) on Anthropic's form**, and keep
  reviewer guidance (test-data caveat) on page 3 where it belongs. Then **Envoyer**.
- Page 2 question map (as of 2026-06): Company name/URL, primary contact
  name/email/role, Anthropic POC; Server name (no "MCP"/"Server"), URL type
  (Universal vs Custom), universal URL, tagline (≤55), description (50–100 words),
  use cases (≥3 w/ example prompts), connection requirements, Read/Write radio,
  "Is this an MCP App?" (Yes), third-party connections checklist (N/A if none),
  data-handling checklist, personal-health-data, categories, sponsored-content,
  auth type, transport (Streamable HTTP), documentation link, privacy policy,
  support channel.
- Track status: `claude.ai/admin-settings/directory/submissions`. Escalate:
  `mcp-review@anthropic.com`.

Portal steps: Intro → Connection (HTTPS URL, streamable HTTP/SSE, user routing) →
Tools (auto-synced; fix titles/hints) → Listing → Use cases (+ prerequisites,
read/write/both) → Company → Authentication (OAuth/custom/none) → Data handling
(API ownership, health data, sponsored flags) → Test & launch (test-account
instructions) → Compliance (**7 acknowledgments**: directory guidelines, first-party
API, financial transactions, AI media, prompt injection, conversation data, public
docs) → Review.

## 6. Pre-submission checklist

- [ ] Widgets render in claude.ai (visual) — `ui.domain` correct on the **prod** URL
      (verify with the Claude UA, §Verify).
- [ ] Every tool: `title` + correct `readOnlyHint`/`destructiveHint`; name ≤64.
- [ ] No read+write-in-one tool; no behavioral/prompt-injection language in
      descriptions or injected responses (§2).
- [ ] All tools exercised (MCP Inspector or a custom connector); valid calls return good data.
- [ ] Privacy policy URL live + complete; public documentation URL live by publish date,
      **with a troubleshooting section** (page-6 Documentation box).
- [ ] `/favicon.ico` served at the **server domain root** (not just `app/icon.png`) so
      `s2/favicons?domain=<server>` returns your mark, not the default globe.
- [ ] Icon + 3–5 screenshots (≥1000px, cropped) + paired prompts ready, on a shared Drive link.
- [ ] Allowed Link URIs declared for any `ui/open-link` origin you own.
- [ ] Server URL is **prod** HTTPS; auth path decided.

## Verify snippets

```bash
# What ui.domain is the live server actually serving to CLAUDE? (proves the render is correct)
# The user-agent: Claude-User header is REQUIRED — without it, skybridge serves the deploy
# host (its non-Claude branch) and you'll get a false "it's broken" reading.
URL="https://your-app.example.com"   # prod base, no trailing slash
ID="your-widget"                     # the registerWidget name
curl -s -X POST "$URL/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'user-agent: Claude-User' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"resources/read\",\"params\":{\"uri\":\"ui://widgets/ext-apps/$ID.html\"}}" \
  | sed 's/^data: //' \
  | python3 -c 'import sys,json;[print(json.loads(l)["result"]["contents"][0]["_meta"]["ui"]["domain"]) for l in sys.stdin if l.strip().startswith("{")]'

# Expected: <hash>.claudemcpcontent.com  (matches the node known-answer command in §1)
# If you instead see your deploy host (https://your-app…), you forgot the Claude UA — not a bug.
```

> Some servers require an `initialize` handshake before `resources/read` returns
> contents. If the curl above returns an error about session/initialization, do an
> `initialize` POST first (same headers) and reuse any `mcp-session-id` response
> header on the read.

## Open / to-iterate

- Exact "quality warning" triggers in the portal's Review step (not documented).
- Whether SDK analytics counts as "conversation data collection" for review.
- Whether a forced widget-chain directive (runtime response injection) trips the
  behavioral-description rule when reviewers functionally test. Watch the review.
