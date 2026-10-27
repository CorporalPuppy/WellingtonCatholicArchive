"""
Bulk import of the music library into the choir website.

It works in two steps, so nothing is uploaded until you've checked it:

  1. SCAN: read your music folder and write a spreadsheet (a CSV file)
     with one row per file: the song it belongs to, what kind of file it
     is, its key and version, and a status.

         python import_music.py scan "C:\\Users\\Elijah\\Documents\\Music"

  2. UPLOAD: open import_plan.csv in Excel, fix anything marked "check",
     save it, then upload every row marked "ok".

         python import_music.py upload --site https://your-choir-site

     It asks for the import token (the IMPORT_TOKEN secret on the site).

The status column:
  ok     the script is confident; this row will be uploaded
  check  the script isn't sure (the note says why). Fix the song title,
         key or version if needed, then change it to ok, or to skip.
  skip   never uploaded (autosaves, backups, shortcuts, videos...)

Running "upload" again is safe: the site remembers every file it already
has and skips it. If you've edited a file since (a new chord chart, a
fixed typo in the slides), the site's copy is replaced with the new one.
Running "scan" again keeps the changes you made to rows in an existing
import_plan.csv, and adds any new files.

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

# Cloudflare's free plan takes at most 100 MB in one upload. We stop a
# little below that, at 95 MB, to leave room.
BIGGEST_FILE_BYTES = 95_000_000

COLUMNS = ["status", "song_title", "kind", "key", "version", "note", "file"]

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
    rows.sort(key=lambda row: (row["status"] != "check", row["song_title"].lower(), row["kind"]))
    return rows


def make_row(path, filename, folder_kind, folder_version):
    row = {"status": "ok", "song_title": "", "kind": "", "key": "", "version": "", "note": "", "file": path}

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
        for row in group:
            row["song_title"] = best_title

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


def keep_earlier_edits(rows, plan_path):
    """If a plan already exists, keep what you typed in it for each file."""
    if not os.path.exists(plan_path):
        return rows
    earlier = {row["file"]: row for row in read_plan(plan_path)}
    for row in rows:
        if row["file"] in earlier:
            row.update(earlier[row["file"]])
    return rows


def write_plan(rows, plan_path):
    # "utf-8-sig" lets Excel show letters like ō correctly.
    with open(plan_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def read_plan(plan_path):
    # Excel may save the file as UTF-8 or as the older Windows encoding.
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            with open(plan_path, newline="", encoding=encoding) as f:
                return list(csv.DictReader(f))
        except UnicodeDecodeError:
            continue
    sys.exit("Couldn't read " + plan_path + ". In Excel, save it as 'CSV UTF-8'.")


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

def upload(plan_path, site, token):
    rows = read_plan(plan_path)
    to_upload = [row for row in rows if row["status"].strip().lower() == "ok"]

    # What the site already has: each file's path and its fingerprint.
    on_site = {}
    for line in ask_site(site, token, "GET", "/api/import/done").splitlines():
        if "\t" in line:
            fingerprint, path = line.split("\t", 1)
            on_site[path] = fingerprint

    print(len(to_upload), "rows marked ok,", len(on_site), "files already on the site.")
    uploaded = 0
    replaced = 0
    failed = 0
    for number, row in enumerate(to_upload, start=1):
        path = row["file"]
        if not os.path.exists(path):
            print("  MISSING", path)
            failed += 1
            continue
        if os.path.getsize(path) > BIGGEST_FILE_BYTES:
            print("  TOO BIG (over 95 MB, the free plan's limit)", path)
            failed += 1
            continue

        with open(path, "rb") as f:
            data = f.read()
        fingerprint = hashlib.sha256(data).hexdigest()
        if on_site.get(path) == fingerprint:
            continue  # on the site already, and not edited since

        details = {
            "title": row["song_title"].strip(),
            "kind": row["kind"].strip(),
            "key": row["key"].strip(),
            "version": row["version"].strip(),
            "filename": os.path.basename(path),
            "source": path,
            "hash": fingerprint,
        }
        try:
            answer = ask_site(site, token, "POST", "/api/import/song-file?" + urllib.parse.urlencode(details), data)
            print("  [" + str(number) + "/" + str(len(to_upload)) + "]", details["title"], "-", details["filename"], "-", answer)
            if path in on_site:
                replaced += 1
            else:
                uploaded += 1
        except RuntimeError as error:
            print("  FAILED", path, "-", error)
            failed += 1

    print("Done.", uploaded, "new,", replaced, "replaced (edited since last time),", failed, "failed.")
    if failed:
        print("Run the upload again to retry the failed ones.")


def ask_site(site, token, method, address, data=None):
    request = urllib.request.Request(site.rstrip("/") + address, data=data, method=method)
    request.add_header("Authorization", "Bearer " + token)
    if data is not None:
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

    upload_step = steps.add_parser("upload", help="upload every row marked ok")
    upload_step.add_argument("--site", required=True, help="e.g. https://ourchoir.nz")
    upload_step.add_argument("--plan", default=PLAN_FILE)

    args = parser.parse_args()

    if args.step == "scan":
        rows = keep_earlier_edits(scan(args.folder), args.plan)
        write_plan(rows, args.plan)
        counts = {}
        for row in rows:
            counts[row["status"]] = counts.get(row["status"], 0) + 1
        songs = {row["song_title"] for row in rows if row["status"] != "skip"}
        print("Wrote", args.plan, "-", len(rows), "files,", len(songs), "songs.")
        print_total_size(rows)
        for status in ("ok", "check", "skip"):
            print("  " + status + ":", counts.get(status, 0))
        print('Open it in Excel, sort out the "check" rows, save, then run "upload".')
    else:
        token = os.environ.get("IMPORT_TOKEN") or getpass.getpass("Import token: ")
        upload(args.plan, args.site, token)


if __name__ == "__main__":
    main()
