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

## Commands

```bash
npm run dev           # website
npx convex dev        # backend (keeps convex/_generated fresh)
npm run lint
npm run typecheck
npm test              # backend tests (no deployment needed)
npm run codegen:offline
```
