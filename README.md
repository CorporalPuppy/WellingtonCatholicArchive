# Choir Website

A website for a choir that sings at several parishes. It has a calendar of
where the choir is singing, what it will sing at each Mass (with sheet music
and YouTube links anyone can open), daily readings, a music library and a
PowerPoint archive. It runs on Cloudflare for free (apart from the yearly
domain fee).

- **Everyone** can see the calendar, each event's set list with its sheet
  music and YouTube links, and the daily readings. Share an event's page so
  people know what the choir will sing.
- **Choir members** can also see the music library (recordings too), the
  PowerPoint archive, rosters and members-only events like rehearsals.
- **Admins** log in to add parishes, events, set lists, songs, files,
  PowerPoints and member accounts.

Right now everything is open to everyone. To make the music library,
PowerPoints, rosters and members-only events need a login, change
`EVERYTHING_PUBLIC` to `"no"` (see Part 2). Set lists, sheet music and
chord charts stay public either way.

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
                 │      ├── D1 database   parishes, events, songs, users  (like SQLite)
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
choir-site/
├── README.md               ← you are here
├── package.json            list of libraries (like requirements.txt)
├── wrangler.jsonc          Cloudflare settings: database, storage, choir name
├── tsconfig.json           TypeScript settings (you can ignore this)
├── .dev.vars.example       example secrets for running on your own computer
│
├── migrations/             SQL that creates the database tables
│   ├── 0001_auth.sql       login tables (used by Better Auth)
│   ├── 0002_choir.sql      parishes, events, songs, files, rosters, set lists
│   ├── 0003_powerpoints_and_readings.sql
│   ├── 0004_musescore_files.sql   adds MuseScore as a kind of song file
│   ├── 0005_song_file_labels.sql  adds lyrics, slides, and a key and version per file
│   └── 0006_song_file_fingerprint.sql  lets the import spot edited files
│
├── tools/
│   └── import_music.py     bulk import of your music folders (see "Importing your music library")
│
├── public/                 plain files sent as-is
│   ├── styles.css          colours and layout (change colours at the top)
│   ├── theme.js            the light / dark mode button
│   ├── readings.js         loads the daily readings from Universalis
│   └── icon.svg, *.png     the site icon
│
└── src/                    the code
    ├── index.tsx           START HERE: sets up the app and lists every area
    ├── auth.ts             login settings (Better Auth)
    ├── password.ts         how passwords are scrambled before saving
    ├── middleware.ts       "must be logged in" / "must be admin" checks
    ├── database.ts         every SQL query, one plain function each
    ├── files.ts            sends files from R2 to the browser
    ├── reading-parts.ts    the parts of each day's readings (Reading 1, Psalm, ...)
    ├── helpers.ts          small tools: dates, file sizes, form reading
    ├── types.ts            the shape of each table row and setting
    ├── pages/
    │   ├── layout.tsx      header, menu and footer around every page
    │   ├── event-list.tsx  a list of events as cards
    │   └── render.tsx      shortcut to show a page inside the layout
    └── routes/             one file per area of the site
        ├── public-pages.tsx   home page, one event with its set list
        ├── calendar.tsx       the calendar: "Upcoming" list and "Month" grid
        ├── login.tsx          log in, log out, first-time setup
        ├── account.tsx        change your own password
        ├── music.tsx          music library and file downloads
        ├── powerpoints.tsx    PowerPoint archive
        ├── readings.tsx       readings for each day
        ├── admin-home.tsx     admin dashboard
        ├── admin-events.tsx   add/edit events, set lists, rosters
        ├── admin-parishes.tsx the parishes the choir sings at
        ├── admin-songs.tsx    add/edit songs, upload files
        ├── admin-users.tsx    create and manage member accounts
        ├── admin-powerpoints.tsx  upload and delete PowerPoints
        ├── admin-readings.tsx     enter each day's readings
        └── import-api.ts          where import_music.py sends files
```

### Following one request through the code

Say a member opens `https://ourchoir.nz/events/5`:

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
| `CHOIR_NAME` | Shown in the header, footer and page titles. |
| `EVERYTHING_PUBLIC` | `"yes"` (now): everyone can see the music library, recordings, PowerPoints, rosters and members-only events. `"no"`: only logged-in members can. Set lists, sheet music and chord charts are always public. Admin pages always need an admin login. |
| `TIMEZONE` | Used to decide which events are "upcoming". `Pacific/Auckland` for New Zealand. |

Other things to personalise:

- **Colours:** the top of `public/styles.css` has one block for light mode
  and one for dark mode. Visitors switch with the half-circle button in the
  menu.
- **Icon:** `public/icon.svg` (browser tab). `public/icon-192.png` and
  `public/apple-touch-icon.png` are the same picture for phones; replace
  them with PNGs of your own icon at 192x192 and 180x180.
- **Welcome text:** `src/routes/public-pages.tsx`
  (look for the `TODO` comments).
- **Readings page:** laid out like the USCCB daily readings. The readings
  fill in by themselves from [Universalis](https://universalis.com/n-jsonp.htm):
  the visitor's browser loads them (`public/readings.js`), and Universalis's
  copyright notice and a link back are shown, as they ask. Universalis
  officially supports today's and next Sunday's readings; other days may
  only show the link. To replace a day's readings with your own, use
  **Admin → Daily readings**.
- **Readings calendar:** `UNIVERSALIS_CALENDAR` in `wrangler.jsonc` picks
  Universalis's local calendar (so local feast days match). Leave it `""`
  for the General Roman Calendar.
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
npx wrangler d1 create choir-db
```

It prints a block that includes a line like:

```
"database_id": "a1b2c3d4-...."
```

Copy that id into `wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

### 6. Create the music storage bucket

```
npx wrangler r2 bucket create choir-music
```

### 7. Create the tables

```
npm run db:migrate:remote
```

Type `y` if it asks to confirm. This runs the SQL files in `migrations/`.

### 8. Upload the site

```
npm run deploy
```

It prints the address, like `https://choir-site.yourname.workers.dev`.
**Run this again any time you change the code.**

Nobody can log in yet. That needs the secret keys in the next step.

### 9. Set the secret keys

Secrets are kept by Cloudflare, never in the code. Run each command and
paste the value when asked. (If Wrangler says there is no Worker called
`choir-site`, step 8 hasn't finished yet: run `npm run deploy` first.)

```
npx wrangler secret put BETTER_AUTH_SECRET
```
A long random string. You can make one with:
`node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"`

```
npx wrangler secret put BETTER_AUTH_URL
```
The site's address. Use your real domain, e.g. `https://ourchoir.nz`.
(If you are trying it on the free `*.workers.dev` address from step 8
first, use that, and set this again once your domain is attached.)

```
npx wrangler secret put SETUP_TOKEN
```
A one-time code you make up. You will type it on the setup page in step 11.

### 10. Attach your domain

In the Cloudflare dashboard: **Workers & Pages** → **choir-site** →
**Settings** → **Domains & Routes** → **Add** → **Custom domain**, and enter
your domain (e.g. `ourchoir.nz` or `www.ourchoir.nz`). Because the domain
is already on Cloudflare, DNS and HTTPS are set up for you.

Make sure `BETTER_AUTH_URL` (step 9) matches this address exactly.

### 11. Create your admin account

Visit `https://ourchoir.nz/setup`, enter the `SETUP_TOKEN` code, your
name, email and a password. This page switches itself off once any account
exists.

Then log in, open **Admin**, and add your parishes first, then songs
(with their YouTube links and sheet music), events and member accounts.

### Song resources

Each song can hold as many files as you like. On a song's admin page you
can pick several files at once, and the site sorts them by their names:

| File | Goes under | On the song page |
| --- | --- | --- |
| `.pdf` | Sheet music | Preview, Open, Download |
| `.docx`, `.doc`, `.txt`, or "chord" in the name | Chord charts | Preview (Word files only once the site is online), Download |
| `.mscz` | MuseScore files | Download (open in the free MuseScore app) |
| `.docx` with "lyric" in the name | Lyrics | Download |
| `.pptx`, `.ppt` | Lyrics slides | Download |
| `.mp3`, `.m4a`, `.wav` | Recordings | Player, Download |

Every file can also have a **key** (e.g. `D`, `Am`) and a **version** (e.g.
`with intro`, `v2`, `Capo 3`, `Page 2`, `Sacred Heart style`), so a song can
hold several copies in different keys or styles. They show as a small label
next to the file.

Sheet music, chord charts and MuseScore files are always public, because
set lists link to them. Lyrics, slides and recordings follow `EVERYTHING_PUBLIC`.

### Importing your music library

`tools/import_music.py` uploads a whole music folder at once. It expects
the folders to be split by type (`Music Chords`, `Music Sheets`, `Scores`,
`Music Lyrics PPT`, ...); the list is `FOLDERS` at the top of the script, so
add a line there for a new folder. It only uses Python's built-in
libraries.

1. Make up a long random import code and give it to the site (once):
   `npx wrangler secret put IMPORT_TOKEN`
2. Scan your folder. This only reads file names and writes `import_plan.csv`:
   `python tools/import_music.py scan "C:\Users\Elijah\Documents\Music"`
3. Open `import_plan.csv` in Excel. Each row is one file, with the song it
   belongs to, its kind, key and version. Rows marked `check` say why in the
   `note` column: fix the title, key or version, then change `check` to `ok`
   (or `skip`). Save it as **CSV UTF-8** so letters like ō survive.
4. Upload every `ok` row:
   `python tools/import_music.py upload --site https://your-site`
   It asks for the import code. Songs that don't exist yet are created.

Running either step again is safe: `scan` keeps what you changed in the
spreadsheet, and `upload` skips files the site already has. If you've
edited a file on your computer since it was uploaded, `upload` replaces the
site's copy with the new one (it compares a "fingerprint" of each file's
contents). So to update the site after changing your music, just run
`scan` and `upload` again.

To change a single file by hand, use **Replace** under that file on the
song's admin page. It keeps the file's kind, key and version. Your music
folder is the master copy, though: if that file came from the import, the
next `upload` puts your computer's copy back, so edit it there too.

The import is built to stay inside Cloudflare's free plan. Unchanged
files are never sent again (the script compares fingerprints on your
computer first). A replaced file's old copy is deleted from R2 straight
away, so storage doesn't pile up. Each file is one small request. A full
import of about 1,000 files uses around 1,000 of the 100,000 Worker
requests allowed per day, and 1,000 of the million R2 writes allowed per
month. Keep an eye on R2's 10 GB storage limit if you add lots of
recordings, since audio is much bigger than sheet music. If you don't
want the import switched on, delete the secret afterwards with
`npx wrangler secret delete IMPORT_TOKEN`.

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

- **Copyright:** uploaded sheet music and chord charts are linked from the
  public set lists, so anyone can download them. Only upload sheets you are
  allowed to share publicly (for example public-domain hymns, or ones your
  licence covers). For other songs, use the "Sheet music link" box to point
  to where the publisher sells or shares it. While `EVERYTHING_PUBLIC` is
  `"yes"`, recordings and PowerPoints are public too. The same goes for
  typing the full text of the readings: Bible translations are copyrighted.
- **Privacy:** rosters contain people's names, which is personal information
  under the NZ Privacy Act 2020. While `EVERYTHING_PUBLIC` is `"yes"`,
  anyone can see them.
- **Free limits:** D1 allows 5 million reads and 100,000 writes a day on the
  free plan, and R2 allows 10 GB. A choir site is far below this.
- **Passwords** are stored scrambled (PBKDF2 hashing in `src/password.ts`),
  never as plain text.
