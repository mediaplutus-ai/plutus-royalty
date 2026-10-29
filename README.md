# Plutus Media — Royalty Dashboard

Role-based royalty dashboard for publishers, labels, authors and composers.
It keeps **publisher royalties** (Plutus collects, deducts commission, pays out) clearly apart from
**admin-only royalties** (the society pays the rights holder directly; Plutus only tracks them, no commission).

## Folder structure

```
plutus-royalty/
├── supabase/
│   ├── SETUP_ALL_IN_ONE.sql      ← paste this once into Supabase SQL Editor
│   ├── migrations/               ← the same SQL split into 3 parts
│   │   ├── 0001_schema.sql         tables, enums, indexes
│   │   ├── 0002_logic.sql          commission maths, matching, statements, payments, audit, encryption
│   │   └── 0003_security_views.sql who-sees-what rules (RLS) + dashboard functions
│   └── tests/                    ← local-only automated checks (56 checks)
└── web/                          ← Next.js 16 website
    ├── src/app/(app)/            dashboard, royalties, catalog, statements, payments ...
    ├── src/app/login/            sign-in page
    ├── src/lib/data.ts           all database reads (demo data until Supabase keys are set)
    └── src/proxy.ts              sends signed-out visitors to /login
```

## Roles

| Role | Sees | Can change |
|---|---|---|
| Super Admin | everything, audit log, uploads | everything, approves payments |
| Label Admin | everything belonging to his/her label | artists, works and ownership of own label |
| Author / Composer | own earnings, own works (with all co-writer splits), own published statements, own invoices, own contracts | own name and phone only |

## Money rules (enforced inside the database)

- **Publisher royalty:** commission comes from the artist's own active contract; if none, the label-wide contract. `net = gross − commission`.
- **Admin-only royalty:** commission is always 0, `net = gross`, status `paid directly`.
- Each line is matched to a work by **ISWC → ISRC → title**. Unmatched lines raise a **data mismatch** alert.
- Report total vs. the total printed on the society statement: a difference above ₹1 is flagged.
- Ownership of a work cannot exceed 100% per territory.
- Invoices: `draft → pending approval → approved → paid`. Paid needs payment mode + transaction ID. GST/TDS optional.
- Paid royalty lines and paid invoices are locked.
- Bank account numbers are encrypted (only last 4 digits visible); every view/change is logged.

---

## Setup — hindi mein, step by step

### 1. Supabase (database)
1. Supabase project kholiye → left menu **SQL Editor** → **New query**.
2. `supabase/SETUP_ALL_IN_ONE.sql` ka poora text paste karke **Run** dabaiye. "Success" aana chahiye.
3. Bank details encrypt karne ki chaabi: naya query chalaiye (apna lamba random text daaliye):
   ```sql
   select vault.create_secret('YAHAN-KOI-LAMBA-RANDOM-TEXT-40-AKSHAR', 'payout_key');
   ```
4. Pehla Super Admin: **Authentication → Users → Add user** se apna email/password banaiye, phir:
   ```sql
   update profiles set role = 'super_admin' where email = 'aapka@email.com';
   ```

### 2. Website keys
Supabase → **Project Settings → API** se `Project URL` aur `anon / publishable key` copy karke
hosting (Netlify) ke **Environment variables** mein daaliye:
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```
`service_role` key kabhi yahan ya chat mein mat daaliye.

Jab tak keys nahi daali jaatin, website **demo mode** mein chalti hai (sample data, upar "View as" se role badal kar dekh sakte hain).

### 3. Local par chalana (optional)
```bash
cd web
npm install
npm run dev     # http://localhost:3000
```

### 4. Database checks (developer ke liye)
```bash
./supabase/tests/run_tests.sh   # local Postgres 15+ chahiye
```

## Build plan

| Session | Scope | Status |
|---|---|---|
| 1 | Database (12 tables), role security, commission/matching/payment logic, app shell, login, dashboard, royalties, catalog | ✅ done |
| 2 | People & access (invite users, link artists), works/ownership editing, contracts screen | next |
| 3 | Royalty sheet upload + importer for IPRS / PRS / MCPS / platform files | needs sample files |
| 4 | Statements: generate, publish, PDF + Excel download | |
| 5 | Payments & invoices (GST/TDS), email notifications | |
| 6 | Audit log screen, 2FA, IP restriction, go-live on GoDaddy domain | |
