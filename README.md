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
