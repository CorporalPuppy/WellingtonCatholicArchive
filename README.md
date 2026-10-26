# Church Website

A website for the church's events, volunteer rosters, set lists and music
files. It runs on Cloudflare for free (apart from the yearly domain fee).

- **Everyone** can see the home page and public events.
- **Members** log in to see private events, rosters, set lists and the music library.
- **Admins** add events, songs, music files and member accounts.

Nobody can sign themselves up. An admin creates each account.

---

## Part 1: How it all works

You know Python, C#, C++ and Godot, so here is the web version of things
you already know.

### The big picture

```
 Visitor's browser
       │  asks for a page, e.g. GET /events
       ▼
 Cloudflare (all over the world)
       │
       ├── Is it a plain file in /public (like styles.css)?
       │      yes → send it straight back (free, very fast)
       │
       └── no → run our code (the "Worker")
                 │
                 ├── src/index.tsx        works out who is logged in,
                 │                        then picks the right page
                 ├── src/routes/*.tsx     builds the page
                 │      ├── D1 database   events, songs, users  (like SQLite)
                 │      └── R2 storage    the actual music files (like a folder)
                 ▼
          HTML page sent back to the browser
```

There is no server you have to look after. Cloudflare runs the code only
when someone visits, and you never have to install or update an operating
system.

### The pieces

| Piece | What it is | If you know... it's like |
| --- | --- | --- |
| **TypeScript** | The language. JavaScript with types added. | C# syntax, Python's ease. `let x: number = 5` is like C#'s `int x = 5`. |
| **Node.js / npm** | Node runs JavaScript on your computer. npm downloads libraries. | npm is `pip`. `package.json` is `requirements.txt`. `node_modules/` is a virtual env folder. |
| **Cloudflare Workers** | Where the code runs, on Cloudflare's computers. | A Python function that gets called once per web request. |
| **Wrangler** | Cloudflare's command-line tool to run, test and upload the site. | Like `dotnet` CLI or `flask run`. |
| **Hono** | A small library that maps web addresses to code. | Python's **Flask**. `routes.get("/events", ...)` is `@app.route("/events")`. |
| **JSX (`.tsx` files)** | Lets you write HTML inside TypeScript to build pages. | Flask's Jinja templates, but inside the code. |
| **D1** | Cloudflare's database. It is real **SQLite**. | Python's `sqlite3`. You write normal SQL. |
| **R2** | Cloudflare's file storage, for music files. | A big folder on a server. You `put` and `get` files by name. |
| **Better Auth** | A library that handles logins, passwords and sessions. | ASP.NET Identity, or Flask-Login. |

### A few TypeScript things that look odd at first

- `async` / `await`: talking to the database takes time, so those functions
  are `async` and you put `await` in front when calling them. Same idea as
  Python's `async`/`await` and C#'s `async`/`await`.
- `c`: every page function gets `c` (the "context"). It holds the request
  (`c.req`), the settings and database (`c.env`), and lets you reply
  (`c.html(...)`, `c.redirect(...)`).
- `{x && <p>...</p>}` inside a page means "show this only if x is true".
- `{list.map((item) => <li>{item.title}</li>)}` means "make one `<li>` per
  item", like a `for` loop in a Jinja template.
- `export` makes something usable from other files, and `import` brings it in,
  like Python's `import`.

### Where everything is

```
church-site/
├── README.md               ← you are here
├── package.json            list of libraries (like requirements.txt)
├── wrangler.jsonc          Cloudflare settings: database, storage, church name
├── tsconfig.json           TypeScript settings (you can ignore this)
├── .dev.vars.example       example secrets for running on your own computer
│
├── migrations/             SQL that creates the database tables
│   ├── 0001_auth.sql       login tables (used by Better Auth)
│   └── 0002_church.sql     events, songs, files, rosters, set lists
│
├── public/                 plain files sent as-is
│   └── styles.css          colours and layout (change colours at the top)
│
└── src/                    the code
    ├── index.tsx           START HERE: sets up the app and lists every area
    ├── auth.ts             login settings (Better Auth)
    ├── password.ts         how passwords are scrambled before saving
    ├── middleware.ts       "must be logged in" / "must be admin" checks
    ├── database.ts         every SQL query, one plain function each
    ├── helpers.ts          small tools: dates, file sizes, form reading
    ├── types.ts            the shape of each table row and setting
    ├── pages/
    │   ├── layout.tsx      header, menu and footer around every page
    │   └── render.tsx      shortcut to show a page inside the layout
    └── routes/             one file per area of the site
        ├── public-pages.tsx   home page, events list, one event
        ├── login.tsx          log in, log out, first-time setup
        ├── account.tsx        change your own password
        ├── music.tsx          music library and file downloads
        ├── admin-home.tsx     admin dashboard
        ├── admin-events.tsx   add/edit events, rosters, set lists
        ├── admin-songs.tsx    add/edit songs, upload files
        └── admin-users.tsx    create and manage member accounts
```

### Following one request through the code

Say a member opens `https://yourchurch.nz/events/5`:

1. `src/index.tsx` runs. `loadUser` (in `middleware.ts`) reads their login
   cookie and asks Better Auth who they are.
2. Hono sees the address matches `routes.get("/events/:id", ...)` in
   `src/routes/public-pages.tsx` and calls that function.
3. That function calls `getEvent`, `getRoster` and `getSetlist` from
   `database.ts`, which run SQL on D1.
4. It builds the page with JSX and `renderPage` wraps it in the layout.
5. The HTML goes back to the browser.

---

## Part 2: Settings you can change

All in **`wrangler.jsonc`**, under `"vars"`:

| Setting | What it does |
| --- | --- |
| `CHURCH_NAME` | Shown in the header, footer and page titles. |
| `MUSIC_ACCESS` | `"members"` (default): only logged-in members can see music. `"public"`: anyone can. |
| `TIMEZONE` | Used to decide which events are "upcoming". `Pacific/Auckland` for New Zealand. |

Other things to personalise:

- **Colours:** top of `public/styles.css`.
- **Welcome text, address, service times:** `src/routes/public-pages.tsx`
  (look for the `TODO` comments).
- **Logo:** put an image in `public/` (e.g. `public/logo.png`) and add
  `<img src="/logo.png" alt="" height="40" />` in `src/pages/layout.tsx`.

After changing anything, deploy again (step 9 below).

---

## Part 3: Putting the site online, step by step

You only do steps 1 to 10 once. After that, updating the site is just step 9.

Commands go in a terminal: **Terminal** on Mac, **PowerShell** on Windows.
Run them from inside the project folder (use `cd` to get there, e.g.
`cd Documents\WellingtonCatholicArchive`).

### 1. Install Node.js

Download the **LTS** version from <https://nodejs.org> and install it with
the default options. Then check it worked:

```
node --version
```

You should see something like `v22.x.x`.

### 2. Get the code and install the libraries

```
git clone https://github.com/CorporalPuppy/WellingtonCatholicArchive.git
cd WellingtonCatholicArchive
npm install
```

`npm install` reads `package.json` and downloads everything into
`node_modules/` (like `pip install -r requirements.txt`).

### 3. Log in to Cloudflare

```
npx wrangler login
```

A browser window opens. Log in and click **Allow**.
(`npx` runs a tool from `node_modules`, so you don't install Wrangler separately.)

### 4. Turn on R2

R2 needs a payment method on file, even though you won't be charged within
the free allowance (10 GB). In the Cloudflare dashboard go to
**R2 Object Storage** and follow the steps to enable it.

### 5. Create the database

```
npx wrangler d1 create church-db
```

It prints a block that includes a line like:

```
"database_id": "a1b2c3d4-...."
```

Copy that id into `wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

### 6. Create the music storage bucket

```
npx wrangler r2 bucket create church-music
```

### 7. Create the tables

```
npm run db:migrate:remote
```

Type `y` if it asks to confirm. This runs the SQL files in `migrations/`.

### 8. Set the secret keys

Secrets are kept by Cloudflare, never in the code. Run each command and
paste the value when asked:

```
npx wrangler secret put BETTER_AUTH_SECRET
```
A long random string. You can make one with:
`node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"`

```
npx wrangler secret put BETTER_AUTH_URL
```
The site's address. Use your real domain, e.g. `https://yourchurch.nz`.
(If you are trying it on the free `*.workers.dev` address first, use that,
and set this again once your domain is attached.)

```
npx wrangler secret put SETUP_TOKEN
```
A one-time code you make up. You will type it on the setup page in step 11.

### 9. Upload the site

```
npm run deploy
```

It prints the address, like `https://church-site.yourname.workers.dev`.
**Run this again any time you change the code.**

### 10. Attach your domain

In the Cloudflare dashboard: **Workers & Pages** → **church-site** →
**Settings** → **Domains & Routes** → **Add** → **Custom domain**, and enter
your domain (e.g. `yourchurch.nz` or `www.yourchurch.nz`). Because the domain
is already on Cloudflare, DNS and HTTPS are set up for you.

Make sure `BETTER_AUTH_URL` (step 8) matches this address exactly.

### 11. Create your admin account

Visit `https://yourchurch.nz/setup`, enter the `SETUP_TOKEN` code, your
name, email and a password. This page switches itself off once any account
exists.

Then log in, open **Admin**, and add events, songs and member accounts.

---

## Running it on your own computer (optional)

Good for trying changes before putting them online. Nothing here touches the
real site.

```
cp .dev.vars.example .dev.vars        (Windows: copy .dev.vars.example .dev.vars)
npm run db:migrate:local
npm run dev
```

Open <http://localhost:8787>, go to `/setup`, and use the code
`local-setup-code`. Wrangler stores the local database and files in a hidden
`.wrangler/` folder. Press `Ctrl+C` to stop.

To check the code for type mistakes (like a compiler would): `npm run typecheck`.

---

## Changing the database later

Never edit an old migration file once it has been run. Instead add a new file
like `migrations/0003_add_something.sql` with the change (e.g.
`ALTER TABLE songs ADD COLUMN tempo TEXT;`), then run
`npm run db:migrate:local` and `npm run db:migrate:remote`.

## Things to keep in mind

- **Copyright:** a church copyright licence usually covers sharing within the
  congregation, not posting publicly. Keep `MUSIC_ACCESS` as `"members"` for
  copyrighted songs, and check what your licence covers.
- **Privacy:** rosters and member details are personal information under the
  NZ Privacy Act 2020. They are only shown to logged-in members.
- **Free limits:** D1 allows 5 million reads and 100,000 writes a day on the
  free plan, and R2 allows 10 GB. A church site is far below this.
- **Passwords** are stored scrambled (PBKDF2 hashing in `src/password.ts`),
  never as plain text.
