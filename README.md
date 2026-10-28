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
│   ├── 0006_song_file_fingerprint.sql  lets the import spot edited files
│   ├── 0007_slides_and_prayers.sql  slides per event, and Prayers and services
│   ├── ...
│   └── 0011_powerpoint_occasions.sql  PowerPoints filed by occasion and Year
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
    ├── liturgy.ts          the Sundays and feasts PowerPoints are filed under
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
| `.pptx`, `.ppt` | Slides | Download |
| `.mp3`, `.m4a`, `.wav` | Recordings | Player, Download |

Every file can also have a **key** (e.g. `D`, `Am`) and a **version** (e.g.
`with intro`, `v2`, `Capo 3`, `Page 2`, `Sacred Heart style`), so a song can
hold several copies in different keys or styles. They show as a small label
next to the file.

Sheet music, chord charts and MuseScore files are always public, because
set lists link to them. Lyrics, slides and recordings follow `EVERYTHING_PUBLIC`.

### Slides for each Sunday, and Prayers and services

- **Slides for a Mass or service:** open the event under Admin > Events and
  use **Slides** to upload its PowerPoint. It shows on the event's page (for
  members). PowerPoints uploaded in the archive with a date are filed under
  that day's Sunday or feast, and show on every event of that day. Each
  song's own slides are also linked from the set list.
- **Prayers and services** (`/prayers`): the Creeds, the Prayer of St
  Francis, rosaries, special services. They're kept like songs (with
  slides, words and any other files), but listed on their own page. Pick
  "Prayers and services" in a song's **Show it under** menu, or use **Add a
  prayer or service**. They can go in a set list too (e.g. the Creed).

### Importing your music library

`tools/import_music.py` uploads a whole music folder at once. It expects
the folders to be split by type (`Music Chords`, `Music Sheets`, `Scores`,
`Music Lyrics PPT`, ...); the list is `FOLDERS` at the top of the script, so
add a line there for a new folder. Folders named in `PRAYERS_FOLDERS`
go under Prayers and services instead of the music library. It only uses
Python's built-in libraries.

1. Make up a long random import code and give it to the site (once):
   `npx wrangler secret put IMPORT_TOKEN`
2. Scan your folder. This only reads file names:
   `python tools/import_music.py scan "C:\Users\Elijah\Documents\Music"`
   The first time, it writes **`song_list.csv`**, your list of songs, as
   well as `import_plan.csv`.
3. Tidy `song_list.csv` in Excel. It has one row per song: `title` is the
   proper name and `other_spellings` lists other ways file names write it
   (put `;` between several). Where two rows are the same song (the `note`
   column points out likely ones, such as "Let My Tounge Be Silenced" and
   "Let My Tongue Be Silenced"), keep one, add the other spelling to it and
   delete the other row. `found_in` shows which kinds of file each song
   has (just for your information: a song with only chords is fine). The script never changes this file again, so your fixes stick.
   The `tags` column takes tags for each song, with commas between them
   (e.g. `Marian, Easter, Communion`). They show on the Music page, which
   can be filtered by tag. A song list made before tags existed gets an
   empty `tags` column on the next scan. Tags can also be set on a song's
   admin page.

   To have tags suggested, scan with `--suggest-tags`. Each song on the
   list is looked up on hymnary.org, which records how hymnals file it
   (Mary, Easter, Communion...). Answers are kept in `hymnary_cache.json`,
   so each song is looked up once, with a 3 second pause between requests
   (the first run takes about 45 minutes for 450 songs and can be stopped
   with Ctrl+C and carried on later). Suggestions go in
   `tag_suggestions.csv`: put `yes` in its `approve` column for the ones
   you want (edit the tags first if you like), or `no` to turn one down.
   `upload` adds approved tags to the song's tags on the site, and
   `song_list.csv` isn't changed. Modern worship songs usually aren't on
   hymnary.org, and it has no style tags (pop, rock), so those stay yours
   to add. The words that map hymnal subjects to tags are in `TAG_WORDS`
   at the top of that part of the script. Delete `hymnary_cache.json` to
   look everything up again.
4. Scan again. Now every file is checked against your song list, and any
   file that doesn't match a song on it is marked `check`. New songs later
   just need a row in the list.
5. Open `import_plan.csv` in Excel. Each row is one file, with the song it
   belongs to, its kind, key, version and which kinds its song has. Rows
   marked `check` say why in the `note` column: fix the song list or the
   row, then change `check` to `ok` (or `skip`). Save both files as
   **CSV UTF-8** so letters like ō survive.
6. Upload every `ok` row:
   `python tools/import_music.py upload --site https://your-site`
   It asks for the import code. Songs that don't exist yet are created.

**Naming new files.** Keep each file in the folder for its type, and name
it `Song Title - Key of X - Version`, leaving out the parts you don't
need. For example: `Amazing Grace - Key of G.pdf`,
`Amazing Grace - Key of A - with intro.mscz`, `Silent Night - Page 2.jpg`,
`Psalm 23 - The Lord Is My Shepherd - Key of D.docx`. Spell the title
exactly as in `song_list.csv`, and give each copy its own version
(`v2`, `Capo 3`, `Page 2`) rather than Windows' "(2)" or "- Copy".

Running either step again is safe. After any change to your music, just run
`scan` then `upload` again, and `upload` makes the site match your folders:

- unchanged files are skipped
- edited files replace the site's copy (it compares a "fingerprint" of each
  file's contents)
- renamed or moved files are moved on the site without being sent again
- a changed song title, key or version (in either spreadsheet) is updated
- tags from `song_list.csv` are set on their songs, including songs uploaded
  before (no files are sent again for that)
- files gone from your folders, or marked `skip`, are listed, and removed
  from the site once you type `yes`

Songs left with no files are kept, in case they're in a set list. They show
under **Resolve now** at the top of the admin songs page, together with
songs whose titles differ only in capitals or punctuation.

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

### Importing Sunday and service PowerPoints

`tools/import_slides.py` does the same for the PowerPoints from Masses and
services. They're filed by **occasion and Year**, not by date: a deck for
the 15th Sunday in Ordinary Time in the Year A folder shows on the page
under Year A > Ordinary Time > 15th Sunday in Ordinary Time, and on every
event that falls on that Sunday in a Year A (2026, 2029, ...). Decks for
anything else (ordinations, retreats, rosaries...) go under **Other
services**. It reads the folders in `SLIDES_FOLDERS` at the top of the
script (`Sunday Mass Presentations`, with everything inside it) and any
PowerPoints sitting loose in the folder you give it. It uses the same
import code as the music.

1. Scan: `python tools/import_slides.py scan "C:\Users\Elijah\Documents\Music"`
   This writes `slides_plan.csv`, one row per file.
2. Open it in Excel if you like. The script fills in:
   - `year`: A, B or C, from the folder (`Year A - 2026`) or the name (`Yr A`).
     Empty = shows in every Year.
   - `occasion`: the Sunday or feast in the name, e.g. `15th Sunday in
     Ordinary Time`, `Palm Sunday`, `3rd Day of Simbang Gabi`. It knows the
     Sundays of Advent, Lent, Easter and Ordinary Time, the big feasts and
     short forms like `15th Sun OT` or `Corpus Christi`. Empty = Other
     services. The full list is `OCCASIONS` in the script (and in
     `src/liturgy.ts` on the site; keep the two the same).
   - `date`: only if the name has one (`20260531`, `July 24 2026`). A deck
     with a date but no occasion is filed under the Sunday or feast of that
     date. Most decks don't need one.

   You can change any of them, or the title or church. Rows marked `check`
   have an occasion the site doesn't know: fix it, empty it, or mark it
   `skip`.
3. Upload: `python tools/import_slides.py upload --site https://your-site`

As with the music, run `scan` then `upload` again after any change: edited
files replace the site's copy, moved ones are moved, a new title, Year,
occasion or church is updated, and removed ones are taken off once you type
`yes`. Decks uploaded before occasions existed are refiled by the next
upload. A new year's folder just needs to be called `Year B - 2027` and so
on.

`upload` also sends the words on each deck's slides (song titles, lyrics,
readings), and the `church` column is filled in from the name (the list
is `CHURCHES` at the top of the script). On the PowerPoints page:

- the **search** finds words in titles and on the slides, in any order,
  best match first, with the matching words highlighted. "teresas" finds
  "St Teresa's" and "maori" finds "Māori". Old `.ppt` files are found by
  title only, since their words can't be read without extra software.
- **filters** narrow it to Year A, B or C, a season (or Other services)
  and a church.

The search uses SQLite's built-in full-text search (FTS5). One catch:
`wrangler d1 export` can't export a database with a search index in it.
To back up, drop the index first and put it back afterwards (see
`migrations/0009_powerpoint_search.sql`).

PowerPoints you use again and again, like the Holy Rosary or the Stations
of the Cross, belong on the Prayers and services page instead: put them in
the music library's prayers folder and import them with `import_music.py`.

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
- **Staying free:** the whole site is built to fit Cloudflare's free plans.

  | Free limit | What it means here |
  | --- | --- |
  | Workers: 100,000 requests a day | Page visits. CSS, the icon and other files in `public/` don't count. |
  | Workers: 10 ms of CPU per request | Why passwords use 10,000 PBKDF2 rounds (see `src/password.ts`). |
  | Workers: 100 MB per upload, 128 MB memory | Upload music in batches under 100 MB. The import script skips files over 95 MB. |
  | D1: 5 million rows read and 100,000 written a day, 5 GB | Far more than a choir needs. |
  | R2: 10 GB of files, 1 million uploads and 10 million downloads a month | The site stops uploads at 9.5 GB. **Admin** shows how much is used. |

  Nothing here uses a paid feature. R2 asks for a card when you turn it on,
  but it only charges if you go over the free amounts, and the 9.5 GB stop
  is there so you don't.
- **Passwords** are stored scrambled (PBKDF2 hashing in `src/password.ts`),
  never as plain text.
