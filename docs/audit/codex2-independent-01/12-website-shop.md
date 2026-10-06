# 12 — Website shop, POS, online orders and support

Read-only review of current `main`, commit `4e22ef53d9a549aa7d227b9b2e1711da260c4d92`, including merged PR #274. Reviewed 6 October 2026 (Manila). No application code changed. Severity: **blocker** prevents internet launch; **major** requires correction; **minor** is a limited defect. `confirmed` means supported by source or an isolated test; `suspected` means an external deployment condition remains unverified.

**Do not put the accounting server directly on the internet.** Public shop access needs a deliberately restricted gateway or a separate public service, trusted HTTPS, bounded public workloads, and the privacy and order-accounting corrections below. This review does not establish that the PC is currently internet-accessible.

This public report contains weaknesses and fixes only. Reproduction scripts and detailed confirmation material remain in a private directory outside the repository. Any PC copy belongs outside the checkout under `%USERPROFILE%`. No customer records, personal identities, payloads or misuse instructions are included.

## Findings

### W12-01 — Payment destination changes for existing orders

- **Label / severity:** confirmed / major.
- **File:line:** `apps/server/src/modules/SHP/orders.ts:153`, `apps/server/src/modules/SHP/orders.ts:250`, `apps/server/src/modules/SHP/orders.ts:347`, `apps/server/src/modules/SHP/orders.ts:359`.
- **Expected:** the QR and receiving cash/bank account are bound to the payment instructions applicable to that order; staff reconcile the account that actually received the transfer.
- **Actual:** the order stores neither payment-settings version nor receiving account. Its page shows the latest QR/settings, and confirmation posts the collection to the latest `cashPlaceId`. An account change between placement/payment and confirmation can therefore credit the wrong bank balance. The settings editor checks that the chosen account is active, but cannot verify that the uploaded QR belongs to it.
- **Fix:** snapshot the immutable payment-settings version and receiving account on the order; show those instructions consistently. Confirm against that account, with an audited reconciliation workflow for money received elsewhere. Require staff to verify the QR/account mapping. An isolated test confirmed account drift.

### W12-02 — Confirmed orders lack a linked cancellation/return/refund lifecycle

- **Label / severity:** confirmed / major.
- **File:line:** `apps/server/src/modules/SHP/orders.ts:291`, `apps/server/src/modules/SHP/orders.ts:378`, `apps/server/src/modules/SHP/orders.ts:395`, `apps/server/src/modules/QS/routes.ts:98`, `apps/server/src/modules/COL/doctypes/refund.ts:24`, `apps/server/src/modules/COL/doctypes/credit-memo.ts:126`.
- **Expected:** a confirmed order's financial correction, refund, returned pieces and customer-visible status agree, with immutable journals and an audit trail. A correction of a mistaken record and an actual customer refund must each have an explicit accounting treatment.
- **Actual:** public cancellation stops at `awaiting_payment`; staff rejection also stops before confirmation. There is no SHP post-confirm cancellation/refund action. QS cancellation mirrors the collection and sale, reducing recorded cash, sales and VAT and restoring stock, but SHP retains its confirmed/ready/completed status and original sale link. SHP can subsequently move that order forward. QS reissue likewise does not replace the SHP link. The existing COL refund targets JO deposits or unapplied customer money, with no direct quick-sale/order target. Existing COL credit memos do support paid QS returns: they debit sales returns and output VAT and credit an unapplied customer deposit; a COL refund can then debit that deposit and credit cash. Those journals correct the money, but the original QS remains posted, so SHP stock and order status do not reflect the return. A fully paid QS sale alone creates no refundable deposit.
- **Fix:** add an order-aware, permission-checked correction/return/refund contract using the document engine. Link original and replacement/reversal/refund records; update SHP status/events in the same transaction; block fulfilment and reviews for reversed orders. Record actual cash returned once and restore only pieces actually returned, including partial returns. Isolated tests confirmed that cancelling both QS documents restores stock and balances while the website still reports `confirmed`, and that the existing credit-memo/refund flow corrects money without restoring returned stock or changing the website status.

### W12-03 — Stock checks are warnings at the posting boundary

- **Label / severity:** confirmed / major.
- **File:line:** `apps/server/src/modules/SHP/public.ts:63`, `apps/server/src/modules/SHP/orders.ts:345`, `apps/server/src/modules/QS/doctypes/sale.ts:84`, `apps/web/src/modules/SHP/Pos.tsx:94`.
- **Expected:** POS and online confirmation enforce available stock atomically when posting, accounting for the confirming order's own reservation. A staff stock override needs a separate permission, reason and audit event.
- **Actual:** public placement checks stock, but confirmation rechecks only orders classified as expired. QS emits stock/item warnings, which do not stop posting. The POS stops shortages in its browser preview, leaving a preview-to-post race. A later count correction or sale can leave insufficient stock at confirmation; an isolated test confirmed a posted online sale with negative on-hand stock. Availability is clamped to zero, concealing the negative balance on the public catalogue.
- **Fix:** enforce the product/variant and aggregate quantity checks inside the final transaction for the POS/order contract. Preserve any legitimate generic-QS stock override as an explicit audited action, rather than treating every shortage as an advisory warning.

### W12-04 — Number-only tracking publishes internal job-order descriptions

- **Label / severity:** confirmed / major.
- **File:line:** `apps/server/src/modules/SHP/track.ts:45`, `apps/server/src/modules/SHP/track.ts:54`, `apps/server/src/modules/JO/public.ts:378`.
- **Expected:** unauthenticated tracking exposes only deliberately public status data; private descriptions and customer-specific order details require a buyer credential.
- **Actual:** number-only tracking excludes dedicated customer name, phone, address, amount and balance fields. However, it returns raw ERP job-line descriptions, quantities and dates. Free-form descriptions can contain customer identifiers or contact details. Online tracking also shows sizes, colours, quantities, fulfilment and delivery-area name without the order token. An isolated test confirmed that customer contact text embedded in a JO description is returned unchanged. A per-IP lookup limit is not ownership verification.
- **Fix:** require an unguessable tracking credential for detailed tracking, including JOs. For number-only responses, return a minimal status and explicitly public labels; never return raw staff-authored descriptions or location/order details.

### W12-05 — Payment-submitted reservations have no expiry

- **Label / severity:** confirmed / major.
- **File:line:** `apps/server/src/modules/SHP/public.ts:19`, `apps/server/src/modules/SHP/orders.ts:275`, `apps/server/src/modules/SHP/orders.ts:291`.
- **Expected:** unverified reservations have a bounded lifetime and an overdue reconciliation process, including a safe path for a buyer whose payment really arrived.
- **Actual:** the 24-hour expiry applies only to `awaiting_payment`. `payment_sent` holds pieces indefinitely, without bank verification, and the customer can no longer cancel it. Only a staff decision releases the hold. An isolated test confirmed that the hold remains after 48 hours. Hourly placement caps do not bound cumulative outstanding reservations.
- **Fix:** add a staff verification deadline, limits on outstanding held pieces/orders, overdue alerts and an audited timeout/reconciliation state. Never silently discard a real payment; route late or unresolved payments into a refund/reconciliation workflow.

### W12-06 — Public workloads have no cumulative resource budget

- **Label / severity:** confirmed / major.
- **File:line:** `apps/server/src/modules/SUP/routes.ts:65`, `apps/server/src/modules/SUP/routes.ts:70`, `apps/server/src/modules/SUP/routes.ts:82`, `apps/server/src/modules/SUP/routes.ts:93`, `apps/server/src/modules/SHP/orders.ts:269`, `apps/server/src/modules/SHP/track.ts:26`.
- **Expected:** anonymous traffic cannot exhaust the CPU, memory, disk or backup capacity needed for accounting. Limits apply before expensive work and include outstanding and lifetime byte budgets.
- **Actual:** support permits five 4 MiB pictures per message and retains their BLOBs in the accounting database. Its hourly limits bound accepted message counts, but not cumulative storage; closed messages retain files. JSON parsing, base64 decoding and hashing occur before the handler's sender/count limits. Payment pictures also live in this database. Tracking's per-IP map never removes inactive sender entries. Public product reads have no pagination or request limit and perform stock/list queries for the full catalogue. Public reads and rejected submissions have no shared resource limiter.
- **Fix:** enforce gateway request/concurrency/time/byte limits before body processing, a bounded expiring rate-limit store, database/disk reserve thresholds, and per-submission plus cumulative storage budgets. Put public media in a separately budgeted store with immutable audit references and an approved retention policy. Paginate catalogue reads. Configure trusted proxy IP handling narrowly; current Fastify construction does not enable proxy trust, so a gateway otherwise becomes a single sender for all buyers.

### W12-07 — Picture validation checks signatures, not valid images

- **Label / severity:** confirmed / major.
- **File:line:** `apps/server/src/engine/attachments.ts:35`, `apps/server/src/modules/SUP/routes.ts:71`, `apps/server/src/modules/SHP/orders.ts:89`, `apps/server/src/modules/SHP/routes.ts:177`.
- **Expected:** accepted pictures are decodable JPEG, PNG or WebP images with bounded dimensions, pixel count and processing cost; unnecessary embedded metadata is removed.
- **Actual:** the shared sniffer inspects a short header only. Size and claimed type are bounded, but image completeness, dimensions, decoded size and metadata are not validated. An isolated SUP test confirmed acceptance of an incomplete image. No script execution was demonstrated: image responses have explicit types, `nosniff` and a sandbox CSP, which are useful existing protections.
- **Fix:** validate/decode with a maintained image library under strict resource limits, enforce dimensions/pixels, and create a normalized image for display. Where original payment/support evidence must be retained, store it privately and separately from the display derivative.

### W12-08 — Buyer credentials persist in browser storage without revocation

- **Label / severity:** confirmed / major.
- **File:line:** `apps/web/src/shop/Checkout.tsx:21`, `apps/web/src/shop/Checkout.tsx:28`, `apps/server/src/modules/SHP/orders.ts:127`, `apps/server/src/modules/SHP/orders.ts:265`.
- **Expected:** access to buyer details has a defined lifetime, a revocation mechanism and suitable browser/cache protections, consistent with PLAN B1's browser-storage rule.
- **Actual:** up to ten order numbers and bearer tokens persist in localStorage without expiry or a clear/remove control. The token authorizes access to the buyer's name, delivery address, payment reference, amounts, items and event notes, and authorizes permitted order actions. The server stores a hash and uses a strong random token and constant-time comparison, but provides no expiry/rotation/revocation. Sensitive order JSON does not set `Cache-Control: private, no-store`; the token also remains in the page/query URL. Thus the stored value is an access credential even though the browser does not store the full order record.
- **Fix:** prefer an expiring HttpOnly buyer session, or a deliberately short-lived/revocable link with explicit device opt-in and a forget control. Remove credentials from URLs after exchange; redact logs/referrers and prevent sensitive response caching. Agree any exception to the browser-storage rule before launch.

### W12-09 — Internet exposure boundary is unverified

- **Label / severity:** suspected / blocker for internet launch.
- **File:line:** `apps/server/src/main.ts:75`, `apps/server/src/app.ts:159`, `apps/server/src/app.ts:198`, `apps/server/src/engine/security/routes.ts:47`.
- **Expected:** only approved public website routes are reachable from the internet; accounting, staff authentication, setup, device enrolment and practice services remain on the LAN/VPN.
- **Actual:** the HTTPS listener serves shop, accounting and setup in the same process/database. Route permissions protect private APIs, but do not create a network boundary. First-owner setup is intentionally unauthenticated until a user exists. The separate HTTP listener exposes device enrolment. No deployment gateway allowlist was established by this source review, and no live internet exposure was tested. A direct publication of the listener would extend the accounting attack surface beyond the LAN/VPN architecture in PLAN C1/C7.
- **Fix:** establish and verify the restricted public gateway or separate service described below, complete setup privately, and test reachability from outside before making the shop public. Do not treat robots rules or hidden menu items as access controls.

### W12-10 — Hidden products retain publicly readable current photos

- **Label / severity:** confirmed / minor.
- **File:line:** `apps/server/src/modules/SHP/routes.ts:103`, `apps/server/src/modules/SHP/routes.ts:155`.
- **Expected:** hiding a product removes its photo from fresh public responses, with a documented cache lifetime.
- **Actual:** the photo route checks the current photo association but not product activity. Hiding removes the product from the public catalogue while leaving its current picture publicly readable; the response also permits one day of public caching. This concerns shop pictures, not private payment/support files.
- **Fix:** require an active product on public photo reads and define cache invalidation or a shorter policy when staff withdraw public content.

## Money checks and limits of the result

| Check | Observed behaviour |
|---|---|
| VAT split | `QS/doctypes/sale.ts:64` calls JO `invoiceAmounts` with the effective VAT rate for the server's business date. `JO/doctypes/invoice-record.ts:51` computes VAT from the document's gross integer centavos and allocates net sales by class with rounding. QS posts AR, sales and output VAT; COL collects against that sale. No separate SHP VAT arithmetic or unbalanced-journal defect was found. |
| Delivery fee | `SHP/orders.ts:218` derives the fee from server settings and the delivery city/province. Placement snapshots the fee. `SHP/orders.ts:355` adds it as one VAT-inclusive service line, without a stock item, so its net belongs to service income and its VAT to output VAT. This implements a taxable delivery service, not a tax-free pass-through; the accountant must approve that business treatment. |
| Receiving account | `SHP/orders.ts:359` supplies the configured cash-place ID; `COL/doctypes/collection.ts:269` debits that account and credits the sale's AR. No fixed cash account is hard-coded. Existing-order account drift is W12-01. Bank reconciliation is manual, not verified by the screenshot. |
| Public prices | `SHP/orders.ts:31` accepts identifiers/quantities, not prices/totals. `SHP/orders.ts:231` reads `price_cents` from the server and stores immutable priced lines. `regular_price_cents` is the crossed-out display price; `price_cents` is the sale price actually charged. Browser totals cannot set the online order price. |
| POS prices | `Pos.tsx:81` sends price/description in generic QS input. QS recalculates arithmetic/VAT but does not resolve an item's price from the catalogue. That endpoint supports authorized staff-entered prices for generic quick sales. If POS prices must be fixed to the shop catalogue, add a server POS contract and an explicit price-override permission; the online-order protection should not be assumed to cover POS. |
| Stock and cancellation | `SHP/public.ts:26` derives on-hand pieces from stock moves minus posted QS pieces; holds reduce availability. Pre-payment cancellation, rejection and expiry release holds without journals because no sale has posted. `QS/public.ts:65` excludes cancelled QS sales, restoring their stock. Post-confirm mismatches are W12-02/W12-03. Periodic inventory means no new cost-of-sales journal per piece; inventory valuation remains in INV. |
| Double confirmation | `SHP/orders.ts:340` wraps the status/version guard, QS sale, COL payment and order link in one transaction. A failed post rolls everything back. A repeated stale request conflicts on version; a request using the new version is rejected by status. This prevents a second sale, although it does not replay the original response like the generic QS Idempotency-Key mechanism. The existing SHP test checks repeated confirmation. |

## Every route reachable without sign-in

The exact application route inventory is `apps/server/test/role-matrix.test.ts:172`: **20 route patterns**. Public means no staff session, not unrestricted buyer access. Unlisted accounting APIs require authentication and exact permission checks (`app.ts:159`). Default JSON body limit is 1 MiB (`app.ts:117`); the two public picture-upload routes override it as noted below. Limits count string characters unless bytes are specified.

| Route | What it shows / returns | What it stores and limits |
|---|---|---|
| `GET /*` | Built static assets or SPA for non-API paths. Signed-out website pages: `/`, `/shop`, `/services`, `/about`, `/support`, `/checkout`, `/orders`, `/track`, `/order/:number`. Other SPA paths, including `/sign-in`, show sign-in; first-run setup takes precedence on an empty installation. | No server write. Cart/wishlist store product IDs, sizes, colours and quantities in localStorage; quantity cap 999 per cart line, no overall line/wishlist count cap. Checkout stores up to ten order-number/token pairs (W12-08). Forms and fetched details otherwise live in browser memory. Sources: `platform/web.ts:14`, `shop/Site.tsx:16`, `shop/store.tsx:19`, `App.tsx:47`. |
| `GET /api/health` | App version, server time, OK and optional practice flag. | No write or upload; no route-specific read-rate limit. `app.ts:195`. |
| `GET /api/setup/status` | Whether first owner is needed. | No write/upload. `security/routes.ts:42`. |
| `POST /api/setup/first-owner` | Initial user ID and CSRF token; sets Secure, HttpOnly, SameSite=Strict staff cookie. Refused after any user exists. | User, password hash, owner-role grant, audit event and session. Username 2–40, display label 1–80; password policy applies, but this route's password schema has no explicit length cap beyond the request-body ceiling. No pictures. Keep off the public gateway. `security/routes.ts:47`. |
| `POST /api/auth/login` | Success CSRF token/staff cookie or generic refusal. | Attempts, audit records and successful session. Username 1–40, password max 1000. Failed-login limits: 5 per user or 20 per IP in 15 minutes; no pictures. Keep staff login private. `security/routes.ts:66`, `security/sessions.ts:103`. |
| `GET /api/shp/products` | Active products, descriptions/features, current and regular prices, sizes, colours, photos and available stock; made-to-order terms. | No write. Entire active catalogue; no pagination/count/read-rate limit. Staff product schema bounds description 300, name 100, features 8 × 100, colours 12 × 30; sizes are distinct values from the fixed enum. `SHP/routes.ts:23`, `SHP/routes.ts:93`. |
| `GET /api/shp/photos/:photoId` | Current product photo bytes, typed and sandboxed; cached publicly for one day. | No write. Staff upload cap 4 MiB; JPEG/PNG/WebP signatures, one current photo per product, historic files retained. Photo lookup does not require that product be active (W12-10). `SHP/routes.ts:103`, `SHP/routes.ts:166`. |
| `GET /api/shp/payment` | Bank/account display labels and hint, instructions, QR URL and delivery areas/fees; excludes ledger cash-place ID. Null before setup. | No write. Staff settings bound labels to 60/100/40, instructions 500; up to 10 delivery areas, each with up to 200 place labels of 60. `SHP/orders.ts:59`, `SHP/orders.ts:191`. |
| `GET /api/shp/payment/qr/:version` | Requested saved QR image, including earlier versions; typed/sandboxed and publicly cached one day. | No write. Owner upload 4 MiB JPEG/PNG/WebP signature check. Versioned settings remain stored. Earlier versions remain publicly addressable; pin the order to its intended version as in W12-01. `SHP/orders.ts:202`. |
| `GET /api/shp/delivery-fee` | Whether delivery is available, area label and fee for city/province. | No write/pictures; query values truncated to 60 each; no route-specific rate limit. `SHP/orders.ts:196`. |
| `POST /api/shp/orders` | New order number, secret token, server total and hold deadline. | Buyer/contact/address/note, immutable items/prices, fee, token hash, IP/time, event/audit and optional email queue. Name 100, email 200, phone 40; address 200, city/province 60, note 500. Consent true; empty honeypot. 1–20 input rows; each quantity 1–100, product ID 64, size 4, colour 30; repeated variants aggregate. No pictures here. 5 orders/IP/hour and 60 overall/hour. `SHP/orders.ts:31`, `SHP/orders.ts:208`. |
| `GET /api/shp/orders/:number` | Requires matching secret token. Buyer name/address, totals/fee, lines, payment reference, status/sale number, event notes, reviewed products and payment settings. Does not return email/phone/IP/staff identities or proof bytes. | No write/pictures. No lookup limiter or token lifetime; sensitive response caching is W12-08. `SHP/orders.ts:127`, `SHP/orders.ts:152`, `SHP/orders.ts:265`. |
| `POST /api/shp/orders/:number/payment` | Token-protected updated order. | One proof BLOB/hash/type and reference, status/event/audit. Token 10–100, reference 4–60, filename max 200; one JPEG/PNG/WebP up to 4 MiB, base64 body cap approximately 5.35 MiB. Status prevents a second accepted proof. Decoding precedes token verification. `SHP/orders.ts:45`, `SHP/orders.ts:268`. |
| `POST /api/shp/orders/:number/cancel` | Token-protected updated order; allowed only while waiting for payment. | Cancellation status/event; no journal or picture. Strict token-only input, token 10–100. `SHP/orders.ts:286`. |
| `GET /api/shp/reviews` | Up to 500 newest unhidden reviews: product, rating, title/body, buyer display label and time. | No write/pictures. Display label derives from checkout name (first word and last initial; a one-word name is retained in full). Review text is public user-authored content; no pre-publication moderation. `SHP/reviews.ts:27`, `SHP/reviews.ts:40`. |
| `POST /api/shp/orders/:number/reviews` | Token-protected review ID and reviewed-product list. | Review and audit record. Completed order and purchased product required; once per product/order. Token 10–100, product ID 64, rating 1–5, title 80, body 10–1000; no pictures. The review form explicitly explains the public display label and has a “Post my review” action (`shop/Checkout.tsx:292`). `SHP/reviews.ts:16`, `SHP/reviews.ts:44`. |
| `POST /api/shp/track` | Number-only online/JO status, dates and item descriptions/quantities; online fulfilment/delivery-area and event times, JO due date and replacement number. Dedicated identity/money fields omitted, but W12-04 applies to free text. | No DB write; in-memory sender/timestamp entries. Number 3–30; 20 lookups/IP/10 minutes; no global limit/entry eviction. No pictures. `SHP/track.ts:14`, `SHP/track.ts:28`. |
| `POST /api/sup/messages` | Support reference number only; no public inbox/read/file route. | Name/email/phone, type/subject/message/order reference, IP/times, audit, and up to 5 original picture BLOBs/hashes/names. Name 100, email 200, phone 40, subject 150, message 5000, orderRef 40; consent true, empty honeypot. Filenames max 200, cleaned of path/control characters. Each JPEG/PNG/WebP up to 4 MiB; base64 body cap approximately 26.73 MiB. 5 messages/IP/hour, 60 overall/hour. Staff reading messages/files needs `sup.view`. `SUP/routes.ts:30`, `SUP/routes.ts:65`, `SUP/routes.ts:119`. |
| `GET /robots.txt` | Crawler directives and sitemap URL. | No write/upload/rate limit; directives do not enforce secrecy. `SHP/seo.ts:24`. |
| `GET /sitemap.xml` | Public home/services/about/support URLs and catalogue/review update date. | No write/upload/rate limit. Host/protocol derives partly from forwarded headers; gateway must replace those and enforce the canonical host. `SHP/seo.ts:15`, `SHP/seo.ts:35`. |

Outside this Fastify inventory, the separate HTTP device-enrolment listener serves `/` (join instructions/public CA fingerprints), `/moonproject-ca.crt` (public certificate), and redirects other paths to HTTPS (`engine/security/tls/join.ts:49`, `main.ts:76`). It stores no visitor business data and must stay private. No CA private key is served.

## Requirements before internet publication

1. **Define the boundary.** Publish only approved shop/static routes and the needed SHP/SUP API methods through a deny-by-default gateway, or move public handling to an isolated service without direct accounting-database access. Keep staff login, setup, all other accounting APIs, device enrolment and the practice service on LAN/VPN. Block direct upstream reachability. Browser route guards and API permissions remain necessary inside that boundary.
2. **Use trusted public HTTPS.** Visitors must receive a certificate from a publicly trusted CA; they must not install the shop's local CA. Preserve authenticated encryption to the upstream. Enforce a canonical host, replace forwarded headers at the gateway, and trust only the gateway for client IPs. Verify secure-cookie/origin behaviour behind it; do not enable unrestricted proxy trust.
3. **Finish private setup first.** Establish the owner, strong staff credentials, recovery/backup configuration and QR/account reconciliation before public traffic. Ensure setup/enrolment and operational services stay inaccessible through the public gateway even after resets/restores.
4. **Bound public work and storage.** Resolve W12-05–W12-07, set request/concurrency/read/upload quotas and timeouts at the gateway, preserve accounting disk capacity, and monitor rejection rates, overdue reservations, database growth and backup duration. Keep encrypted off-machine backups and prove a restore including SHP/SUP files and order links.
5. **Protect buyer data and accounting.** Resolve W12-01–W12-04/W12-08; provide clear processing/retention and review-publication notices. Verify financial reversals/refunds and inventory together, then perform external reachability checks against the explicit allowed routes. Source review and passing module tests do not certify a deployment boundary.

These requirements extend the LAN/VPN design in frozen PLAN C1/C7; implementation should document that change for the plan owner rather than edit `docs/PLAN.md` in this audit.

## Permissions and POS menu change

Declarations: `apps/server/src/modules/SHP/index.ts:15`, `apps/server/src/modules/SUP/index.ts:9`.

| Key | Default roles |
|---|---|
| `shp.view` | encoder, accountant, owner |
| `shp.manage` | encoder, owner |
| `shp.stock` | encoder, owner |
| `shp.orders.view` | encoder, accountant, owner |
| `shp.orders.manage` | encoder, accountant, owner |
| `shp.pos` | encoder, owner |
| `shp.reviews.manage` | encoder, owner |
| `shp.payment.manage` | owner |
| `sup.view` | encoder, accountant, owner |
| `sup.manage` | encoder, owner |

Neither production nor TV receives any of these keys. Defaults apply only when a permission is first introduced; later sync preserves the owner's grants (`engine/security/permissions-sync.ts:15`). Review upgraded installations and customized grants, not only role names.

The POS menu and `/pos` page guard now require `shp.pos`, replacing `qs.post` (`apps/web/src/shell/menu.ts:38`). The accountant does not get that menu by default despite having generic QS posting rights. The POS UI additionally requires `shp.view`, `cus.view`, `qs.create` and `qs.post` (`Pos.tsx:36`), and the actual collection requires its COL permission through the engine. Generic `/api/qs/sales` still requires `qs.post`; it does not check `shp.pos`. Thus `shp.pos` controls the POS screen, while QS/COL permissions control financial posting. If it is intended to control the server POS operation too, define that operation explicitly.

Online confirmation requires `shp.orders.manage`, then `qs.post` and `col.post` through `recordQuickSale` and `postDocument`; it is not a SHP-only posting privilege. Reject/move need `shp.orders.manage` without financial posting. Support messages and pictures require `sup.view`; notes/status require `sup.manage`. No missing staff authentication/exact-route check was found in these handlers. Custom roles should include each operation's prerequisites without assuming that a view grant supplies posting rights.

## Validation

- Confirmed the exact audit title was absent across open/closed PRs before starting, and verified the reviewed commit is GitHub's current `main`.
- Seven isolated Vitest confirmations, kept outside the repository, passed: account drift, cancellation/status mismatch, paid-sale return/refund integration, stock enforcement, free-text tracking disclosure, reservation lifetime and image completeness. These tests assert the observed weaknesses; they are not fixes.
- Targeted SHP `stock-orders`/`track`, SUP `sup`, and QS `sale` tests: **4 files, 31 tests passed**. Used to confirm accounting/stock, repeated confirmation and public input controls. No whole-suite, browser, production-network or live customer-data tests were run.
- No application files or frozen plan were edited. This PR adds only this report; private scripts and logs are excluded.
