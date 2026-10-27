"""
Bulk import of the music library into the choir website.

It works in steps, so nothing is uploaded until you've checked it:

  1. SCAN: read your music folder and write two spreadsheets (CSV files):

         python import_music.py scan "C:\\Users\\Elijah\\Documents\\Music"

     song_list.csv   your list of songs: one row per song, with its proper
                     title and any other spellings used in file names.
                     Made the first time you scan; after that it's yours
                     to keep tidy, and the script never changes it.
     import_plan.csv one row per file: the song it belongs to, what kind
                     of file it is, its key and version, and a status.

  2. TIDY THE SONG LIST: open song_list.csv in Excel. Where two rows are
     the same song spelt differently, keep one, add the other spelling to
     its other_spellings column (several spellings: put ; between them),
     and delete the other row. The note column points out likely ones.
     Save, then run scan again. Every file is now checked against your
     list, and any file that doesn't match a song on it is marked "check".
     The tags column takes tags for the song, with commas between them
     (e.g. Marian, Easter). The site's Music page can be filtered by them.

  3. UPLOAD: open import_plan.csv in Excel, fix anything marked "check",
     save it, then upload every row marked "ok".

         python import_music.py upload --site https://your-choir-site

     It asks for the import token (the IMPORT_TOKEN secret on the site).

The status column:
  ok     the script is confident; this row will be uploaded
  check  the script isn't sure (the note says why). Fix the song title,
         key or version if needed, then change it to ok, or to skip.
  skip   not on the site (autosaves, backups, shortcuts, videos...). If
         it was uploaded before, "upload" offers to remove it.

"upload" makes the site match your folders, so after any change just run
"scan" then "upload" again. Files that haven't changed are skipped. Edited
files replace the site's copy. Renamed or moved files are moved on the site
without being sent again. A changed title, key or version is updated. Files
gone from your folders are listed, and removed once you type yes. Songs left
with no files are kept, and listed under "Resolve now" on the admin songs page.
Running "scan" again keeps the changes you made to rows in an existing
import_plan.csv (a key, a version, a "skip", or an "ok" on a row the
script had flagged), and adds any new files. New files are checked
against song_list.csv, so a new song needs a row there.

Only Python's built-in libraries are used, so there is nothing to install.
"""

import argparse
import csv
import difflib
import getpass
import hashlib
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

PLAN_FILE = "import_plan.csv"
SONG_LIST_FILE = "song_list.csv"

# Cloudflare's free plan takes at most 100 MB in one upload. We stop a
# little below that, at 95 MB, to leave room.
BIGGEST_FILE_BYTES = 95_000_000

COLUMNS = ["status", "song_title", "kind", "key", "version", "found_in", "note", "file"]
SONG_LIST_COLUMNS = ["title", "other_spellings", "tags", "found_in", "note"]

# ---------------------------------------------------------------------------
# Your folders. Each folder name (the first folder under the music folder)
# says what kind of file is inside, and can add a version label.
# Folders not listed here are ignored.
# ---------------------------------------------------------------------------
FOLDERS = {
    "Music Chords": ("chords", ""),
    "Music Sheets": ("sheet", ""),
    "Music Sheets - Scanned": ("sheet", "Scanned"),
    "Scores": ("musescore", ""),
    "Music Lyrics Docs": ("lyrics", ""),
    "Word Lyrics": ("lyrics", ""),
    "Music Lyrics PPT": ("slides", ""),
    "Music Lyrics PPT (Sacred Heart Cathedral Parish) Format": ("slides", "Sacred Heart style"),
    "Music Lyrics PPT (St. Thomas Moore)": ("slides", "St Thomas More style"),
}

# Folders of prayers, rosaries and special services. Files in these go
# under "Prayers and services" on the site instead of the music library.
# Put the exact folder name here (the same name as in FOLDERS above).
PRAYERS_FOLDERS = {"Prayers and Services PPT"}

# Some file types always mean the same kind, whatever folder they're in.
KIND_BY_ENDING = {
    ".mscz": "musescore",
    ".mscx": "musescore",
    ".ppt": "slides",
    ".pptx": "slides",
    ".odp": "slides",
    ".mp3": "recording",
    ".m4a": "recording",
    ".wav": "recording",
}

# File types the site can take. Anything else is marked "skip".
ALLOWED_ENDINGS = {
    ".pdf", ".doc", ".docx", ".odt", ".mscz", ".mscx", ".ppt", ".pptx", ".odp",
    ".jpg", ".jpeg", ".png", ".mp3", ".m4a", ".wav", ".cho", ".chordpro",
}

# When several files belong to one song, the song's title is taken from
# the first kind in this list that the song has (PowerPoint names tend to
# be the tidiest).
TITLE_PREFERENCE = ["slides", "sheet", "musescore", "chords", "lyrics", "recording"]


# ---------------------------------------------------------------------------
# Reading a file name
# ---------------------------------------------------------------------------

# A key: a letter A-G, maybe "b" or "#", maybe "m" for minor.
KEY = r"([A-G][b#]?m?)"

# Ways a key is written in your file names, e.g. "(Key of D)", "key of Ab",
# "Key Am", "Gkey", "Chanted key of D", "Lead Sheet (C)".
KEY_PATTERNS = [
    re.compile(r"\bkey\s*(?:of\s*)?" + KEY + r"(?![A-Za-z])", re.IGNORECASE),
    re.compile(r"\b" + KEY + r"\s*key\b", re.IGNORECASE),
    re.compile(r"\(" + KEY + r"(?:maj)?\)"),
]

# Words that describe the file, not the song. They're removed from the title.
FILE_WORDS = re.compile(
    r"\b(chords?|cords|lyrics?|lyrcis|music\s*sheet|musci\s*sheet|lead\s*sheet|piano)\b",
    re.IGNORECASE,
)


def read_file_name(stem):
    """
    Splits a file name (without its ending) into a song title, a key and a
    list of version labels. For example
        "Priestly People (Key of G) Chords"  ->  "Priestly People", "G", []
        "Amare Et Servire (with intro)"      ->  "Amare Et Servire", "", ["with intro"]
    """
    text = stem
    key = ""
    versions = []

    for pattern in KEY_PATTERNS:
        match = pattern.search(text)
        if match:
            key = fix_key_case(match.group(1))
            text = text[: match.start()] + " " + text[match.end() :]
            break

    # Labels we recognise. Each is (pattern, label to use).
    labels = [
        (r"\bwith\s+intro\b", "with intro"),
        (r"\bno\s+capo\b", "no capo"),
        (r"\bcapo\s*(\d+)", "Capo {0}"),
        (r"\bver(?:sion)?\.?\s*(\d+)\b", "v{0}"),
        (r"\bv(\d+)\b", "v{0}"),
        (r"\bchanted\b", "Chanted"),
        (r"\bacoustic\b", "Acoustic"),
        (r"\(\s*null[_ ]?(\d+)\s*\)", "Part {0}"),
        (r"\bpage\s*(\d+)\b", "Page {0}"),
        (r"\bpart\s*(\d+)\b", "Part {0}"),
        (r"\[([^\]]{2,})\]", "{0}"),  # anything in [square brackets], e.g. [Descant]
    ]
    for pattern, label in labels:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            versions.append(label.format(*match.groups()))
            text = text[: match.start()] + " " + text[match.end() :]

    text = FILE_WORDS.sub(" ", text)
    title = tidy_title(text)
    return title, key, versions


def fix_key_case(key):
    """ "ab" -> "Ab", "am" -> "Am", "F#" -> "F#" """
    return key[0].upper() + key[1:].lower()


def tidy_title(text):
    """Removes empty brackets, stray dashes and extra spaces."""
    text = text.replace("_", " ")
    previous = None
    while previous != text:
        previous = text
        text = re.sub(r"\(\s*[-,;]?\s*\)", " ", text)  # "( )" or "( - )"
        text = re.sub(r"\[\s*\w?\s*\]", " ", text)  #     "[M]" or "[ ]"
        text = re.sub(r"\s+", " ", text).strip()
        text = re.sub(r"(\s-)+\s", " - ", text)  #         "A - - B" -> "A - B"
        text = text.strip("-–,;:. ")
    return text


def match_key(title):
    """
    A simpler version of a title, used to spot the same song across folders:
    lower case, no punctuation, no accents on vowels (Mō -> mo).
    "Be Still (for the Presence of the Lord)" -> "be still for the presence of the lord"
    """
    plain = title.lower().replace("'", "").replace("’", "")
    for accented, letter in zip("āēīōūáéíóú", "aeiouaeiou"):
        plain = plain.replace(accented, letter)
    plain = re.sub(r"[^a-z0-9]+", " ", plain)
    return plain.strip()


# ---------------------------------------------------------------------------
# Step 1: scan
# ---------------------------------------------------------------------------

def scan(music_folder):
    rows = []
    for top_folder in sorted(os.listdir(music_folder)):
        if top_folder not in FOLDERS:
            continue
        folder_kind, folder_version = FOLDERS[top_folder]
        for dirpath, _, filenames in os.walk(os.path.join(music_folder, top_folder)):
            for filename in sorted(filenames):
                path = os.path.join(dirpath, filename)
                rows.append(make_row(path, filename, folder_kind, folder_version))

    group_songs(rows)

    # Cloudflare's free plan takes at most 100 MB in one upload.
    for row in rows:
        if row["status"] != "skip" and os.path.getsize(row["file"]) > BIGGEST_FILE_BYTES:
            row["status"] = "skip"
            row["note"] = "too big: Cloudflare's free plan takes files up to 95 MB"
    return rows


def make_row(path, filename, folder_kind, folder_version):
    row = {"status": "ok", "song_title": "", "kind": "", "key": "", "version": "", "found_in": "", "note": "", "file": path}

    # Word and PowerPoint leave hidden "~$" files behind while a file is open.
    if filename.startswith("~$") or filename.startswith("."):
        row["status"] = "skip"
        row["note"] = "a hidden temporary file"
        return row

    stem, ending = os.path.splitext(filename)
    ending = ending.lower()
    if ending not in ALLOWED_ENDINGS:
        row["status"] = "skip"
        row["note"] = "not a music file type the site takes (" + (ending or "no ending") + ")"
        return row

    # "Song.jpeg.jpeg" -> "Song"
    while os.path.splitext(stem)[1].lower() in ALLOWED_ENDINGS:
        stem = os.path.splitext(stem)[0]
    stem = stem.replace("_auto_x2", "")

    # Windows names a copied file "Song - Copy" (or "Song - コピー").
    copied = re.search(r"\s*-\s*(copy|コピー)\s*$", stem, re.IGNORECASE)
    if copied:
        stem = stem[: copied.start()]
        row["status"] = "check"
        row["note"] = "may be a duplicate (Windows adds - Copy to copies)"

    row["kind"] = KIND_BY_ENDING.get(ending, folder_kind)
    title, key, versions = read_file_name(stem)

    # A small number in brackets after a space, like "Song (2)".
    numbered = re.search(r"\s\(\s*(\d{1,2})\s*\)", " " + title)
    if numbered:
        title = tidy_title((" " + title)[: numbered.start()] + " " + (" " + title)[numbered.end() :])
        if ending in (".jpg", ".jpeg", ".png"):
            # Photos of sheet music: "(1)" and "(2)" are the pages.
            versions.append("Page " + numbered.group(1))
        else:
            versions.append("copy " + numbered.group(1))
            row["status"] = "check"
            row["note"] = "may be a duplicate (Windows adds (2) to copies)"

    if folder_version:
        versions.append(folder_version)

    row["song_title"] = title
    row["raw_title"] = title
    row["key"] = key
    row["version"] = ", ".join(versions)

    if not re.search(r"[A-Za-z]{3}", title):
        row["status"] = "check"
        row["note"] = "name too short to tell which song it is"
    return row


def group_songs(rows):
    """
    Gives every file of the same song the same title, and marks titles that
    are close to another song's title (likely a typo) as "check".
    """
    groups = {}
    for row in rows:
        if row["status"] != "skip":
            groups.setdefault(match_key(row["song_title"]), []).append(row)

    # One title per song: the way it's written most often, e.g. "Mō Maria"
    # (6 files) beats "Mo Maria" (1 file).
    for group in groups.values():
        best = max(group, key=lambda row: (count_title(group, row["song_title"]), -title_rank(row["kind"])))
        best_title = best["song_title"]
        found_in = describe_kinds(group)
        for row in group:
            row["song_title"] = best_title
            row["found_in"] = found_in

    # Look for near misses: titles only a letter or two apart, which is
    # usually a typo, e.g. "The Litte Drummer Boy" vs "The Little Drummer Boy".
    # Only the song with fewer files is marked, since it's probably the typo.
    all_keys = list(groups)
    for key, group in groups.items():
        for other in difflib.get_close_matches(key, all_keys, n=3, cutoff=0.8):
            if other == key or not is_probably_typo(key, other):
                continue
            if len(group) > len(groups[other]):
                continue
            other_title = groups[other][0]["song_title"]
            for row in group:
                if row["status"] == "ok":
                    row["status"] = "check"
                    row["note"] = 'probably the same song as "' + other_title + '": give both the same title, or leave it'
            break


def describe_kinds(group):
    """Which kinds of file a song has, e.g. "sheet, chords, slides"."""
    kinds = {row["kind"] for row in group}
    return ", ".join(kind for kind in TITLE_PREFERENCE + ["other"] if kind in kinds)


def refresh_found_in(rows):
    """Works out found_in again once every file has its final song title."""
    by_song = {}
    for row in rows:
        if row["status"] != "skip":
            by_song.setdefault(row["song_title"], []).append(row)
    for group in by_song.values():
        found_in = describe_kinds(group)
        for row in group:
            row["found_in"] = found_in


def is_probably_typo(a, b):
    """
    True if a and b differ by only a letter or two. Numbers differing
    ("Psalm 145 ... 17th" vs "18th") means different songs, not a typo.
    """
    changed = 0
    for operation, a_start, a_end, b_start, b_end in difflib.SequenceMatcher(None, a, b).get_opcodes():
        if operation != "equal":
            if re.search(r"\d", a[a_start:a_end] + b[b_start:b_end]):
                return False
            changed += max(a_end - a_start, b_end - b_start)
    return changed <= 2


def count_title(group, title):
    return sum(1 for row in group if row["song_title"] == title)


def title_rank(kind):
    if kind in TITLE_PREFERENCE:
        return TITLE_PREFERENCE.index(kind)
    return len(TITLE_PREFERENCE)


# ---------------------------------------------------------------------------
# Your song list
# ---------------------------------------------------------------------------

def read_song_list(list_path):
    """
    Reads song_list.csv into a lookup from every spelling (simplified with
    match_key) to the song's proper title.
    """
    lookup = {}
    for song in read_csv(list_path):
        title = (song.get("title") or "").strip()
        if title == "":
            continue
        spellings = [title] + (song.get("other_spellings") or "").split(";")
        for spelling in spellings:
            if spelling.strip() != "":
                lookup[match_key(spelling)] = title
    return lookup


def check_against_song_list(rows, songs):
    """
    Gives each file the proper title from your song list. A file that
    doesn't match any song on the list is marked "check".
    """
    for row in rows:
        if row["status"] == "skip":
            continue
        title = songs.get(match_key(row["song_title"]))
        if title is not None:
            row["song_title"] = title
            # Your list decides which songs are the same, so "probably the
            # same song as..." no longer applies.
            if row["note"].startswith("probably the same song"):
                row["status"] = "ok"
                row["note"] = ""
        else:
            row["status"] = "check"
            hint = row["note"]
            row["note"] = "not on song_list.csv: add it there (or as another spelling of a song), then scan again"
            if hint:
                row["note"] += "; " + hint


def tidy_tags(text):
    """
    Tags as typed ("marian;Easter , easter") made tidy: "Marian, Easter".
    Keep in step with tidyTags in src/helpers.ts.
    """
    tags = []
    for tag in re.split(r"[,;]", text or ""):
        tag = re.sub(r"\s+", " ", tag).strip()
        tag = tag[:1].upper() + tag[1:]  # "marian" becomes "Marian"
        if tag and tag.lower() not in (each.lower() for each in tags):
            tags.append(tag)
    return ", ".join(tags)


def read_song_tags(list_path):
    """Each song's tags from the tags column of song_list.csv: {title: "Marian, Easter"}."""
    if not os.path.exists(list_path):
        return {}
    return {
        (song.get("title") or "").strip(): tidy_tags(song.get("tags"))
        for song in read_csv(list_path)
        if (song.get("title") or "").strip() != ""
    }


def add_tags_column(list_path):
    """
    Adds an empty tags column to a song_list.csv made before tags existed.
    Nothing else in the file is changed.
    """
    songs = read_csv(list_path)
    if not songs or "tags" in songs[0]:
        return
    columns = list(songs[0].keys())
    columns.insert(columns.index("other_spellings") + 1 if "other_spellings" in columns else len(columns), "tags")
    with open(list_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        for song in songs:
            song["tags"] = ""
            writer.writerow(song)
    print("Added a tags column to", list_path, "(e.g. Marian, Easter, Communion).")


def write_first_song_list(rows, list_path):
    """
    Makes song_list.csv from the files the first time you scan: one row per
    song, with the other spellings the script grouped under it and notes
    on rows worth a look.
    """
    songs = {}
    for row in rows:
        if row["status"] == "skip":
            continue
        song = songs.setdefault(row["song_title"], {"spellings": set(), "found_in": row["found_in"], "notes": set()})
        spelling = row["raw_title"]
        if spelling != row["song_title"]:
            song["spellings"].add(spelling)
        if row["note"].startswith("probably the same song"):
            song["notes"].add(row["note"].split(":")[0])
        elif row["note"].startswith("name too short"):
            song["notes"].add(row["note"])

    with open(list_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=SONG_LIST_COLUMNS)
        writer.writeheader()
        for title in sorted(songs, key=str.lower):
            song = songs[title]
            # A song with only some kinds of file (e.g. just chords) is
            # normal, so that isn't noted; found_in still shows it.
            notes = sorted(song["notes"])
            writer.writerow({
                "title": title,
                "other_spellings": "; ".join(sorted(song["spellings"])),
                "tags": "",
                "found_in": song["found_in"],
                "note": "; ".join(notes),
            })
    return len(songs)


def keep_earlier_edits(rows, plan_path, songs):
    """
    If a plan already exists, keep what you changed in it for each file:
    its kind, key and version, a "skip", and an "ok" on a row the script
    had flagged for the same reason as now.
    """
    if not os.path.exists(plan_path):
        return rows
    earlier = {row["file"]: row for row in read_plan(plan_path)}
    for row in rows:
        old = earlier.get(row["file"])
        if old is None:
            continue
        for column in ("kind", "key", "version"):
            row[column] = old.get(column, row[column])
        old_status = (old.get("status") or "").strip().lower()
        if old_status == "skip":
            row["status"] = "skip"
        elif old_status == "ok" and row["status"] == "check" and old.get("note") == row["note"]:
            row["status"] = "ok"
        # A title you typed in the plan is kept if it's on your song list.
        old_title = (old.get("song_title") or "").strip()
        if old_title != row["song_title"] and match_key(old_title) in songs:
            row["song_title"] = songs[match_key(old_title)]
            if row["note"].startswith("not on song_list.csv"):
                row["status"] = "ok" if old_status == "ok" else row["status"]
                row["note"] = ""
    return rows


def write_plan(rows, plan_path):
    # "utf-8-sig" lets Excel show letters like ō correctly.
    with open(plan_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def read_plan(plan_path):
    return read_csv(plan_path)


def read_csv(path):
    # Excel may save the file as UTF-8 or as the older Windows encoding.
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            with open(path, newline="", encoding=encoding) as f:
                return list(csv.DictReader(f))
        except UnicodeDecodeError:
            continue
    sys.exit("Couldn't read " + path + ". In Excel, save it as 'CSV UTF-8'.")


def print_total_size(rows):
    """Says how much space the files will take, next to Cloudflare's free 10 GB."""
    total = 0
    for row in rows:
        if row["status"] != "skip" and os.path.exists(row["file"]):
            total += os.path.getsize(row["file"])
    gigabytes = total / 1_000_000_000
    print("  These files take {:.2f} GB. Cloudflare's free storage is 10 GB.".format(gigabytes))
    if gigabytes > 9:
        print("  WARNING: that's nearly all of it. The site stops uploads at 9.5 GB")
        print("  (counting files already on the site). Mark some rows 'skip', e.g. big recordings.")


# ---------------------------------------------------------------------------
# Step 2: upload
# ---------------------------------------------------------------------------

def upload(plan_path, site, token, songs_path):
    """
    Makes the site match your music folders:
      - new files are uploaded
      - edited files replace the site's copy
      - renamed or moved files (same contents, new place) are moved on the
        site without uploading them again
      - a changed song title, kind, key or version is updated
      - files gone from your folders (or marked "skip") are removed from
        the site, after you say yes
      - tags in song_list.csv are set on their songs
    Rows still marked "check" are left alone.
    """
    rows = read_plan(plan_path)
    plan = {row["file"]: row for row in rows}

    # What the site already has, one line per file.
    on_site = {}
    for line in ask_site(site, token, "GET", "/api/import/done").splitlines():
        parts = line.split("\t")
        if len(parts) >= 6:
            fingerprint, path, title, kind, key, version = parts[:6]
            on_site[path] = {"hash": fingerprint, "title": title, "kind": kind, "key": key, "version": version}

    # The files you want on the site, with their fingerprints.
    wanted = []
    for row in rows:
        if row["status"].strip().lower() != "ok":
            continue
        path = row["file"]
        if not os.path.exists(path):
            continue  # gone since the last scan; dealt with below
        if os.path.getsize(path) > BIGGEST_FILE_BYTES:
            print("  TOO BIG (over 95 MB, the free plan's limit)", path)
            continue
        row["fingerprint"] = file_fingerprint(path)
        wanted.append(row)

    # Files on the site that shouldn't be any more: not in the plan, marked
    # "skip", or no longer on your computer.
    gone = []
    for path in on_site:
        row = plan.get(path)
        status = row["status"].strip().lower() if row else ""
        if row is None or status == "skip" or not os.path.exists(path):
            gone.append(path)

    # Sort out what to do with each file.
    gone_by_fingerprint = {}
    for path in gone:
        gone_by_fingerprint.setdefault(on_site[path]["hash"], []).append(path)
    to_move, to_relabel, to_replace, to_add = [], [], [], []
    for row in wanted:
        path = row["file"]
        site_copy = on_site.get(path)
        if site_copy is None:
            # Same contents as a file that's gone? Then it was renamed or moved.
            old_paths = gone_by_fingerprint.get(row["fingerprint"])
            if old_paths:
                to_move.append((old_paths.pop(), row))
            else:
                to_add.append(row)
        elif site_copy["hash"] != row["fingerprint"]:
            to_replace.append(row)
        elif labels_differ(site_copy, row):
            to_relabel.append(row)
    moved_from = {old_path for old_path, _ in to_move}
    to_delete = [path for path in gone if path not in moved_from]

    print("On the site:", len(on_site), "files. Changes:")
    print("  new:", len(to_add), " edited:", len(to_replace), " renamed or moved:", len(to_move),
          " new title/kind/key/version:", len(to_relabel), " to remove:", len(to_delete))

    failed = 0
    for old_path, row in to_move:
        failed += send_update(site, token, row, old_path)
    for row in to_relabel:
        failed += send_update(site, token, row, row["file"])
    for number, row in enumerate(to_replace + to_add, start=1):
        failed += send_file(site, token, row, number, len(to_replace) + len(to_add))

    if to_delete:
        print()
        print("These", len(to_delete), "files are on the site but gone from your folders (or marked skip):")
        for path in to_delete[:30]:
            print("   ", on_site[path]["title"], "-", os.path.basename(path))
        if len(to_delete) > 30:
            print("    ...and", len(to_delete) - 30, "more")
        answer = input("Remove them from the site? Type yes to remove, anything else to keep: ")
        if answer.strip().lower() == "yes":
            for path in to_delete:
                try:
                    print("  ", ask_site(site, token, "POST", "/api/import/delete?" + urllib.parse.urlencode({"source": path})),
                          "-", os.path.basename(path))
                except RuntimeError as error:
                    print("  FAILED", path, "-", error)
                    failed += 1
        else:
            print("  Kept them. They'll be listed again next time.")

    failed += send_tags(site, token, songs_path)

    if failed:
        print("Done, but", failed, "failed.")
        print("Run the upload again to retry the failed ones.")
    else:
        print("Done.")
    print("Songs left with no files show under 'Resolve now' on the site's admin songs page.")


def send_tags(site, token, songs_path):
    """
    Sends the tags in song_list.csv for songs whose tags on the site are
    different. Songs already on the site get them too; no files are sent.
    Returns how many failed.
    """
    wanted = read_song_tags(songs_path)
    on_site = {}
    for line in ask_site(site, token, "GET", "/api/import/song-tags").splitlines():
        title, _, tags = line.partition("\t")
        on_site[title.strip().lower()] = tags
    failed = changed = 0
    for title, tags in wanted.items():
        site_tags = on_site.get(title.lower())
        if site_tags is None or site_tags == tags:
            continue  # not on the site yet, or nothing to change
        try:
            ask_site(site, token, "POST", "/api/import/song-tags?" + urllib.parse.urlencode({"title": title, "tags": tags}))
            changed += 1
        except RuntimeError as error:
            print("  FAILED to set the tags of", title, "-", error)
            failed += 1
    if changed:
        print("  New tags on", changed, "songs.")
    return failed


def file_fingerprint(path):
    """The SHA-256 of a file's contents, read a bit at a time to save memory."""
    sha = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            sha.update(block)
    return sha.hexdigest()


def labels_differ(site_copy, row):
    """True if you changed the song title, kind, key or version of a file."""
    return (
        site_copy["title"].strip().lower() != row["song_title"].strip().lower()
        or site_copy["kind"] != row["kind"].strip()
        or site_copy["key"] != row["key"].strip()
        or site_copy["version"] != row["version"].strip()
    )


def file_details(row):
    path = row["file"]
    return {
        "title": row["song_title"].strip(),
        "kind": row["kind"].strip(),
        "key": row["key"].strip(),
        "version": row["version"].strip(),
        "filename": os.path.basename(path),
        "section": section_for(path),
    }


def send_update(site, token, row, old_path):
    """Moves or relabels a file on the site, without uploading it. Returns 1 if it failed."""
    details = file_details(row)
    details["source"] = old_path
    details["new_source"] = row["file"]
    try:
        answer = ask_site(site, token, "POST", "/api/import/update?" + urllib.parse.urlencode(details))
        print("  ", details["title"], "-", details["filename"], "-", answer)
        return 0
    except RuntimeError as error:
        print("  FAILED", row["file"], "-", error)
        return 1


def send_file(site, token, row, number, total):
    """Uploads a new or edited file. Returns 1 if it failed."""
    details = file_details(row)
    details["source"] = row["file"]
    details["hash"] = row["fingerprint"]
    with open(row["file"], "rb") as f:
        data = f.read()
    try:
        answer = ask_site(site, token, "POST", "/api/import/song-file?" + urllib.parse.urlencode(details), data)
        print("  [" + str(number) + "/" + str(total) + "]", details["title"], "-", details["filename"], "-", answer)
        return 0
    except RuntimeError as error:
        print("  FAILED", row["file"], "-", error)
        return 1


def section_for(path):
    """ "prayers" if the file is inside one of PRAYERS_FOLDERS, else "music". """
    folders = re.split(r"[\\/]", path)
    if any(folder in PRAYERS_FOLDERS for folder in folders):
        return "prayers"
    return "music"


def ask_site(site, token, method, address, data=None):
    request = urllib.request.Request(site.rstrip("/") + address, data=data, method=method)
    request.add_header("Authorization", "Bearer " + token)
    request.add_header("User-Agent", "choir-music-import/1.0")
    if method == "POST":
        # Always say what's being sent, even with no file: the site turns
        # away POSTs without it (a safety check against forged web forms).
        request.add_header("Content-Type", "application/octet-stream")
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            return response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        message = error.read().decode("utf-8", "replace")
        if error.code == 401:
            sys.exit("The site said the import token is wrong (or IMPORT_TOKEN isn't set on the site).")
        if error.code == 507:
            sys.exit("Stopped: the site's free 10 GB of storage is nearly full. Mark some rows 'skip' and try again.")
        raise RuntimeError(str(error.code) + " " + message)
    except urllib.error.URLError as error:
        raise RuntimeError("couldn't reach the site: " + str(error.reason))


# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Bulk import of the music library.")
    steps = parser.add_subparsers(dest="step", required=True)

    scan_step = steps.add_parser("scan", help="read the music folder and write the spreadsheet")
    scan_step.add_argument("folder", help="the music folder, holding 'Music Chords', 'Scores' and so on")
    scan_step.add_argument("--plan", default=PLAN_FILE)
    scan_step.add_argument("--songs", default=SONG_LIST_FILE, help="your song list (made on the first scan)")

    upload_step = steps.add_parser("upload", help="upload every row marked ok")
    upload_step.add_argument("--site", required=True, help="e.g. https://ourchoir.nz")
    upload_step.add_argument("--plan", default=PLAN_FILE)
    upload_step.add_argument("--songs", default=SONG_LIST_FILE, help="your song list (for its tags column)")

    args = parser.parse_args()

    if args.step == "scan":
        rows = scan(args.folder)
        first_time = not os.path.exists(args.songs)
        if first_time:
            count = write_first_song_list(rows, args.songs)
            songs = {}
        else:
            add_tags_column(args.songs)
            songs = read_song_list(args.songs)
            check_against_song_list(rows, songs)
        rows = keep_earlier_edits(rows, args.plan, songs)
        refresh_found_in(rows)
        rows.sort(key=lambda row: (row["status"] != "check", row["song_title"].lower(), row["kind"]))
        write_plan(rows, args.plan)
        counts = {}
        for row in rows:
            counts[row["status"]] = counts.get(row["status"], 0) + 1
        songs = {row["song_title"] for row in rows if row["status"] != "skip"}
        print("Wrote", args.plan, "-", len(rows), "files,", len(songs), "songs.")
        print_total_size(rows)
        for status in ("ok", "check", "skip"):
            print("  " + status + ":", counts.get(status, 0))
        if first_time:
            print("Also wrote", args.songs, "-", count, "songs. Tidy it first (see its note column),")
            print('save it, then run "scan" again: every file will then be checked against it.')
        else:
            print("Checked every file against", args.songs + ".")
            print('Open', args.plan, 'in Excel, sort out the "check" rows, save, then run "upload".')
    else:
        token = os.environ.get("IMPORT_TOKEN") or getpass.getpass("Import token: ")
        upload(args.plan, args.site, token, args.songs)


if __name__ == "__main__":
    main()
