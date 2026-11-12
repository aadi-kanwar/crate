# Crate (by Livoza)

Kitchen purchases: groceries, fruits & vegetables, dairy, kitchen supplies
and LPG. For every item Crate answers two questions: **how much did we
buy (and use) over time**, and **what has it cost**. There are no payments,
dues, budgets or vendor ledgers.

Built on the same stack, tooling and design system as the **Staff** app and
**MealSync** (Dine): Next.js 16, Convex (database, functions, auth) on **its
own Convex project**, Tailwind 4 with MealSync's tokens and components
(copied verbatim), Vitest + convex-test. Times are India time
(Asia/Kolkata); money is stored as whole paise.

## Organisation and properties (as in the Staff app)

- Crate runs **one organisation** with one or more **properties** (PGs). The
  first admin names the organisation and its first property at their first
  sign-in; that also creates the starting categories (Grocery, Fruits &
  Vegetables, Dairy, Kitchen Supplies, Utility (LPG)). Properties are added
  and renamed in **Settings**.
- With more than one property, the admin header has a picker: **All
  properties** or one property, remembered on that device.

## Who can do what

| Role | Can do |
| --- | --- |
| **Admin** | Everything: every property, all entries, lists, users, properties, history pages, export, audit log. |
| **Manager / Warden** | Add, see and edit entries for the properties assigned to them. |
| **Kitchen Staff** | The same as Manager / Warden. |

- Sign in with mobile number (India +91 by default) and password. No
  sign-up: an admin creates every account (**Users**) with a temporary
  password, which must be changed at first sign-in. 5 wrong passwords lock
  that number for 15 minutes.
- Only admins reset passwords and switch accounts off. You can't change your
  own role or switch yourself off, and there is always at least one admin.
- Managers and kitchen staff can be assigned several properties; they get a
  property switcher at the top of their screens.
- Every permission is checked in the backend, not just on screen.

## Master lists (organisation-wide; **Lists** screen)

- **Categories:** start with Grocery, Fruits & Vegetables, Dairy, Kitchen
  Supplies, Utility (LPG). Admins add, rename, reorder and archive them.
- **Items:** name, category, the unit it's counted in (kg, litre, piece,
  dozen, cylinder; fixed once bought), other names in any language (search
  matches them: "tamatar" finds Tomato), optional pack sizes ("500 ml
  packet" = 0.5 litre) and variants ("Toned", "Aashirvaad").
- **Shops:** name, type (Wholesaler, Kirana, Mandi / Vendor, Dairy, LPG
  agency, Other) and an optional area or note.
- Managers and kitchen staff can add an item or shop while entering; it is
  **unverified** and waits under **To check**, where an admin verifies, edits
  or **merges** it into the item/shop it duplicates (every purchase moves
  over, the duplicate's name becomes an "other name", then it is removed).
- Archived items and shops are hidden when entering but keep their history.

## Purchase entries

- An entry is one trip to one shop with one or more items. It's for a
  property (the one chosen at the top) or, when ticked, **Shared** (bought
  for the whole organisation; never split across properties).
- Each line: item, optional variant, quantity (directly, or as "4 × 500 ml
  packet"), and the total paid. Crate works out and stores the price per
  unit.
- **Price check:** before saving, each line's price per unit is compared
  with the median of that item's last 5 purchases (same variant if chosen).
  More than double or under half shows "Did you mean…?"; the person must
  tick "Yes, this price is right" or go back and fix it. The backend refuses
  unconfirmed unusual prices too.
- The date and time are set when saving. Only an admin can change them.
- Managers and kitchen staff see entries for their properties (and their
  own Shared entries), and can edit or delete them for **24 hours**; after
  that they are locked and only an admin can change them. Deleting keeps
  the record (admins still see it).
- Every create, edit and delete is in the **Audit log** with before and
  after values.

## History (admins only)

Everything is per property by default, with **Shared** as its own bucket and
**All (organisation)**; Shared purchases are never split across properties.

- **Entries** (`/admin`): filter by property / Shared / All, dates, category,
  shop, item and who entered it; totals for what matches (with an item,
  category or shop filter, only the matching items count). Open an entry to
  change anything, including its date. **Download CSV**: one row per item
  bought, for the same filters (recorded in the audit log).
- **Items** (`/admin/items`): each item's last price and last 30 days. The
  item page shows quantity bought per week and per month (chart and table),
  the **approximate usage** for each property and Shared (what one purchase
  bought ÷ the days until the next purchase, averaged over the latest 5 gaps,
  e.g. "≈1.1 kg/day" or "1 cylinder lasts ≈9 days"; "not enough data" until
  there are purchases on two different days), and the **price history** with
  each purchase's shop and variant, filterable by variant and shop.

## Security rules in the code

- Every backend function is built from the permission wrappers in
  `convex/lib/functions.ts` (`adminQuery/Mutation/Action`, `memberQuery/Mutation`,
  …; checked by ESLint and `convex/tests/enforcement.test.ts`).
- The audit log is append-only. No keys or passwords in code, git, logs or
  the browser.

## Setup (one time)

1. Create a Convex project (`crate`) and give the session its deploy key as
   `CRATE_CONVEX_DEPLOY_KEY` (never paste it in a chat).
2. On the Convex deployment set `SEED_ADMIN_NAME`, `SEED_ADMIN_PHONE` and
   `SEED_ADMIN_PASSWORD`. The Vercel build creates the first admin from them
   (or run `npm run seed`). Remove `SEED_ADMIN_PASSWORD` afterwards.

## Admin Hub sign-in

Master admins open Crate from the Admin Hub without a second login (copied
from the Staff app): `/sso` takes the hub's one-time ticket from the address
fragment, checks it (`HUB_SSO_PUBLIC_KEY`, issuer `HUB_ORIGIN`, audience
`crate`, role `master_admin`, unexpired, never used before) and opens a
12-hour Admin login. A manager / kitchen staff number gets Admin added (their
properties are kept); "Revoke in all apps" (`/sso/revoke`, audience
`crate-revoke`) ends hub logins and gives back their previous role. Before
the organisation exists, a master admin signing in is asked to set it up.

## Going live (production)

As in the Staff app: Vercel hosts the website and, on every deploy,
`scripts/vercel-build.mjs` prepares Crate's production Convex deployment
(login keys, `SITE_URL`, latest backend, the first admin from
`SEED_ADMIN_*`). One time:

1. Convex → project **crate** → **Production** → Settings → URL & Deploy Key →
   Generate Production Deploy Key.
2. Convex, Production → Environment Variables: `SEED_ADMIN_NAME`,
   `SEED_ADMIN_PHONE`, `SEED_ADMIN_PASSWORD`, `HUB_SSO_PUBLIC_KEY` (the
   same value as on Staff's production deployment) and `HUB_ORIGIN`
   (`https://admin.livoza.org`).
3. Vercel → Add New → Project → import **crate** → Environment Variables:
   `CONVEX_DEPLOY_KEY` = the production key (Production only) → Deploy.
4. Vercel → Settings → Domains → `crate.livoza.org`, then redeploy so
   `SITE_URL` follows.
5. In the Admin Hub's `tools.config.ts`, Crate's `revokeUrl` is
   `https://<production deployment>.convex.site/sso/revoke`.
6. Remove `SEED_ADMIN_PASSWORD` once the first admin exists.

## Commands

```bash
npm run dev           # website
npx convex dev        # backend (keeps convex/_generated fresh)
npm run lint
npm run typecheck
npm test              # backend tests (no deployment needed)
npm run codegen:offline
```
