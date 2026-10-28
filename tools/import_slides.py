"""
Bulk import of Sunday and service PowerPoints into the choir website.

Each PowerPoint is filed under its Year (A, B or C, the cycle of Sunday
readings) and its occasion, such as "15th Sunday in Ordinary Time" or
"Easter Sunday", not under a date. So it shows up on the right Sunday's
events every time that Year comes round. PowerPoints with no occasion
(rosaries, ordinations, retreats...) go under "Other services".
It works like import_music.py:

  1. SCAN: read your folder and write a spreadsheet (slides_plan.csv):

         python import_slides.py scan "C:\\Users\\Elijah\\Documents\\Music"

     Give it the same folder as import_music.py. It reads the folders named
     in SLIDES_FOLDERS below, plus PowerPoints sitting loose in the folder
     itself.

     The occasion comes from the file name ("15th Sunday in Ordinary Time -
     St Teresa's Church") and the Year from its folder ("Year A - 2026").

  2. CHECK (optional): open slides_plan.csv in Excel. You can change any
     row's year (A, B, C or empty), occasion (one of the names in
     OCCASIONS below, or empty for Other services), title or church. The
     date column is optional: a date ties a deck to that day's events too,
     which suits one-off services. Rows marked "check" have an occasion
     the site doesn't know; fix it, then set them to ok. Save.

  3. UPLOAD: upload every row marked "ok".

         python import_slides.py upload --site https://your-choir-site

     It asks for the import token, the same one as the music import.

The status column:
  ok     uploaded and filed as the row says
  check  the occasion isn't one the site knows (the note says so). Fix it.
  skip   not on the site (videos, Word files, autosaves...). If it was
         uploaded before, "upload" offers to remove it.

Like the music import, "upload" makes the site match your folders: run
"scan" then "upload" again after any change. Unchanged files are skipped,
edited ones replace the site's copy, renamed or moved ones are moved
without being sent again, a changed year, occasion, title, church or date
is updated, and files gone from your folders are removed once you type yes.
Running "scan" again keeps what you typed in an existing slides_plan.csv.

"upload" also sends the words on each PowerPoint's slides (song titles,
lyrics, readings), so the site's search finds them. Only .pptx and .odp
files can be read this way; old .ppt files are found by their title.

PowerPoints you use again and again (the Holy Rosary, Stations of the
Cross) fit better on the site's "Prayers and services" page: put them in
the music library's prayers folder and import them with import_music.py.

Only Python's built-in libraries are used, so there is nothing to install.
"""

import argparse
import csv
import datetime
import getpass
import hashlib
import html
import os
import re
import sys
import urllib.parse
import zipfile

# The music import has the pieces for talking to the site; use the same ones.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_music import BIGGEST_FILE_BYTES, ask_site, file_fingerprint, read_csv  # noqa: E402

PLAN_FILE = "slides_plan.csv"
COLUMNS = ["status", "year", "occasion", "title", "church", "date", "note", "file"]

# Folders (directly inside the folder you scan) holding Sunday and service
# PowerPoints. Everything inside them is read, including subfolders.
SLIDES_FOLDERS = ["Sunday Mass Presentations"]

SLIDE_ENDINGS = {".ppt", ".pptx", ".odp"}

# Churches, and words in a file name that mean that church. The first match
# wins, so put longer, more exact words first. Add a line for a new church.
CHURCHES = [
    ("St Teresa's Church", ["st teresa"]),
    ("St Anne's Catholic Church", ["st anne"]),
    ("St Thomas More", ["st thomas mo"]),
    ("St Francis de Sales Catholic Church", ["st francis de sales"]),
    ("Sacred Heart Cathedral", ["sacred heart cathedral", "cathedral"]),
]

# The most words kept from one PowerPoint for searching (about 40 pages).
MOST_TEXT = 100_000

MONTHS = {
    name: number
    for number, names in enumerate(
        [("jan", "january"), ("feb", "february"), ("mar", "march"), ("apr", "april"), ("may",),
         ("jun", "june"), ("jul", "july"), ("aug", "august"), ("sep", "sept", "september"),
         ("oct", "october"), ("nov", "november"), ("dec", "december")],
        start=1,
    )
    for name in names
}


# ---------------------------------------------------------------------------
# Occasions: the Sundays and feasts a PowerPoint can be filed under. The
# names must match OCCASIONS in src/liturgy.ts on the site.
# ---------------------------------------------------------------------------

def ordinal(number):
    """1st, 2nd, 3rd, 4th, ... 11th, 12th, 13th, ... 21st, 22nd."""
    if 11 <= number % 100 <= 13:
        return str(number) + "th"
    return str(number) + {1: "st", 2: "nd", 3: "rd"}.get(number % 10, "th")


OCCASIONS = (
    [ordinal(n) + " Sunday of Advent" for n in range(1, 5)]
    + [ordinal(n) + " Day of Simbang Gabi" for n in range(1, 10)]
    + [ordinal(n) + " Day of the Christmas Novena" for n in range(1, 10)]
    + ["Christmas Day", "Holy Family", "Mary, Mother of God", "Epiphany of the Lord", "Baptism of the Lord"]
    + ["Ash Wednesday"] + [ordinal(n) + " Sunday of Lent" for n in range(1, 6)]
    + ["Palm Sunday", "Holy Thursday", "Good Friday"]
    + ["Easter Vigil", "Easter Sunday"] + [ordinal(n) + " Sunday of Easter" for n in range(2, 7)]
    + ["Ascension of the Lord", "Pentecost Sunday"]
    + ["Trinity Sunday", "Body and Blood of Christ", "Sacred Heart of Jesus"]
    + [ordinal(n) + " Sunday in Ordinary Time" for n in range(2, 34)] + ["Christ the King"]
    + ["St Pedro Calungsod", "Saints Peter and Paul", "Assumption of Mary", "Exaltation of the Holy Cross",
       "St Therese of Lisieux", "All Saints", "All Souls", "Dedication of the Lateran Basilica"]
)

# Words in a file name, and the occasion they mean. The first match wins.
NAMED_OCCASIONS = [
    ("ash wednesday", "Ash Wednesday"),
    ("ash wed", "Ash Wednesday"),
    ("rite of election", "1st Sunday of Lent"),
    ("palm sunday", "Palm Sunday"),
    ("holy thursday", "Holy Thursday"),
    ("maundy thursday", "Holy Thursday"),
    ("good friday", "Good Friday"),
    ("easter vigil", "Easter Vigil"),
    ("easter sunday", "Easter Sunday"),
    ("ascension", "Ascension of the Lord"),
    ("pentecost", "Pentecost Sunday"),
    ("trinity", "Trinity Sunday"),
    ("body and blood", "Body and Blood of Christ"),
    ("corpus christi", "Body and Blood of Christ"),
    ("sacred heart of jesus", "Sacred Heart of Jesus"),
    ("christ the king", "Christ the King"),
    ("holy family", "Holy Family"),
    ("christmas day", "Christmas Day"),
    ("nativity of the lord", "Christmas Day"),
    ("mother of god", "Mary, Mother of God"),
    ("new year", "Mary, Mother of God"),
    ("epiphany", "Epiphany of the Lord"),
    ("baptism of the lord", "Baptism of the Lord"),
    ("pedro calungsod", "St Pedro Calungsod"),
    ("peter and paul", "Saints Peter and Paul"),
    ("assumption", "Assumption of Mary"),
    ("holy cross", "Exaltation of the Holy Cross"),
    ("saint therese", "St Therese of Lisieux"),
    ("all saints", "All Saints"),
    ("all souls", "All Souls"),
    ("faithful departed", "All Souls"),
    ("lateran", "Dedication of the Lateran Basilica"),
]

ORDINAL = r"(\d+)(?:st|nd|rd|th)?"


def occasion_in_name(name):
    """The occasion a file name is for, e.g. "15th Sunday in Ordinary Time", or "" if none."""
    text = re.sub(r"\bst\b\.?", "saint", name.lower().replace("&", "and").replace("-", " "))
    text = re.sub(r"\s+", " ", text)

    found = re.search(ORDINAL + r" day (?:of )?(?:the )?(simbang gabi|christmas novena)", text)
    if found:
        number, which = found.group(1), found.group(2)
    else:  # "Simbang Gabi Day 3"
        found = re.search(r"(simbang gabi|christmas novena) day " + ORDINAL, text)
        if found:
            number, which = found.group(2), found.group(1)
    if found and 1 <= int(number) <= 9:
        which = "Simbang Gabi" if which == "simbang gabi" else "the Christmas Novena"
        return ordinal(int(number)) + " Day of " + which
    if "novena" in text:
        return ""  # other novenas (e.g. to St Therese) are other services
    found = re.search(ORDINAL + r" sun(?:day)? (?:of |in )?(?:the )?(?:ordinary time|ot)\b", text)
    if found:
        number = int(found.group(1))
        if number == 34:
            return "Christ the King"
        return ordinal(number) + " Sunday in Ordinary Time" if 2 <= number <= 33 else ""
    found = re.search(ORDINAL + r" sun(?:day)? (?:of |in )?(?:the )?(advent|lent|easter)", text)
    if found:
        number, season = int(found.group(1)), found.group(2)
        if season == "advent":
            return ordinal(number) + " Sunday of Advent" if 1 <= number <= 4 else ""
        if season == "lent":
            if number == 6:
                return "Palm Sunday"
            return ordinal(number) + " Sunday of Lent" if 1 <= number <= 5 else ""
        if number == 7 or "ascension" in text:
            return "Ascension of the Lord"  # kept on the 7th Sunday of Easter in New Zealand
        if number == 1:
            return "Easter Sunday"
        return ordinal(number) + " Sunday of Easter" if 2 <= number <= 6 else ""
    for words, occasion in NAMED_OCCASIONS:
        if words in text:
            return occasion
    return ""


def cycle_in(path):
    """ "A" for a file in "Year A - 2026" (or named "... Yr A"), or ""."""
    parts = re.split(r"[\\/]", path)
    for part in parts[:-1] + [os.path.splitext(parts[-1])[0]]:
        found = re.search(r"\b(?:year|yr)\s*([abc])\b", part, re.IGNORECASE)
        if found:
            return found.group(1).upper()
    return ""


def date_in_name(name, liturgical_year):
    """A date written in the file name, e.g. 20260531, 29-03-2026, July 24 2026, 23-March."""
    def make(year, month, day):
        try:
            return datetime.date(year, month, day)
        except ValueError:
            return None

    found = re.search(r"(?<!\d)(20\d\d)(\d\d)(\d\d)(?!\d)", name)
    if found:
        return make(int(found.group(1)), int(found.group(2)), int(found.group(3)))
    # Day, month, year with anything between them: 29-03-2026, 20/8/23, 20 ̸ 8 ̸ 23
    found = re.search(r"(?<!\d)(\d{1,2})\s*[^\w\s]+\s*(\d{1,2})\s*[^\w\s]+\s*(\d{2}|\d{4})(?!\d)", name)
    if found:
        year = int(found.group(3))
        return make(year + 2000 if year < 100 else year, int(found.group(2)), int(found.group(1)))
    # A month's name next to a day, maybe with a year.
    month_names = "|".join(sorted(MONTHS, key=len, reverse=True))
    found = re.search(r"\b(" + month_names + r")\b[\s\-]*(\d{1,2})(?!\d)(?:[\s,\-]*(20\d\d))?", name, re.IGNORECASE)
    if not found:
        found_reversed = re.search(r"(?<!\d)(\d{1,2})[\s\-]*(" + month_names + r")\b(?:[\s,\-]*(20\d\d))?", name, re.IGNORECASE)
        if found_reversed:
            day, month_name, year = found_reversed.groups()
            found = (month_name, day, year)
    else:
        found = found.groups()
    if found:
        month_name, day, year = found
        month = MONTHS[month_name.lower()]
        if year:
            return make(int(year), month, int(day))
        if liturgical_year:
            return make(liturgical_year - 1 if month == 12 else liturgical_year, month, int(day))
    return None


def year_from_path(path):
    """2026 for a file in "Year A - 2026", or None."""
    for folder in re.split(r"[\\/]", path):
        found = re.match(r"\s*year\s+[abc]\s*-\s*(20\d\d)\s*$", folder, re.IGNORECASE)
        if found:
            return int(found.group(1))
    return None


def tidy_title(stem):
    """A readable title from a file name."""
    title = stem
    if " " not in title:
        title = title.replace("-", " ").replace("_", " ")
    title = re.sub(r"^\s*\d+\.\s*-?\s*", "", title)  # "1.-Welcoming-Mass"
    title = re.sub(r"\(\s*\d{1,3}\s*\)", "", title)  # "(1)", "(003)"
    title = re.sub(r"\s*-\s*year\s+[abc]\b", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s*-?\s*sunday\s+presentations?\b", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s+presentation$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s+", " ", title)
    title = re.sub(r"(\s*-\s*)+$", "", title).strip(" -")
    return title or stem


def church_in_name(name):
    """The church a file name mentions (see CHURCHES), or ""."""
    text = re.sub(r"\bst\.?\s+", "st ", name.lower().replace("-", " "))
    for church, words in CHURCHES:
        if any(word in text for word in words):
            return church
    return ""


def make_row(path, filename):
    stem, ending = os.path.splitext(filename)
    row = {"status": "ok", "year": "", "occasion": "", "title": tidy_title(stem), "church": church_in_name(stem),
           "date": "", "note": "", "file": path}

    if filename.startswith("~$") or filename.startswith("."):
        row.update(status="skip", note="autosave or hidden file")
        return row
    if ending.lower() not in SLIDE_ENDINGS:
        row.update(status="skip", note="not a PowerPoint")
        return row
    if os.path.getsize(path) > BIGGEST_FILE_BYTES:
        row.update(status="skip", note="too big: Cloudflare's free plan takes files up to 95 MB")
        return row

    row["occasion"] = occasion_in_name(stem)
    row["year"] = cycle_in(path)
    date = date_in_name(stem, year_from_path(path))
    row["date"] = date.isoformat() if date else ""
    row["note"] = describe(row)
    return row


def describe(row):
    """The note for a row: where it will be filed, and anything to look at."""
    if row["occasion"] == "" and row["date"] != "":
        return "the site files it under the Sunday or feast on its date (Other services if there isn't one)"
    if row["occasion"] == "":
        return "Other services (no Sunday or feast in the name)"
    if row["occasion"] not in OCCASIONS:
        return "not an occasion the site knows: use a name from OCCASIONS in the script, or leave it empty"
    if row["year"] == "":
        return "no Year folder: shows in every Year; type A, B or C in the year column to choose one"
    return ""


def scan(folder):
    folder = os.path.abspath(folder)  # so the same file always has the same path
    rows = []
    for name in sorted(os.listdir(folder)):
        path = os.path.join(folder, name)
        if os.path.isfile(path):
            # Loose files: only PowerPoints, the rest belong to other things.
            if os.path.splitext(name)[1].lower() in SLIDE_ENDINGS:
                rows.append(make_row(path, name))
        elif name in SLIDES_FOLDERS:
            for dirpath, _, filenames in os.walk(path):
                for filename in sorted(filenames):
                    rows.append(make_row(os.path.join(dirpath, filename), filename))
    return rows


def words_in_slides(path):
    """
    The words on a PowerPoint's slides, one line per paragraph, so the site
    can search them. Works for .pptx and .odp (both are zip files of XML
    inside). Old .ppt files give "", so they're found by title only.
    """
    ending = os.path.splitext(path)[1].lower()
    try:
        with zipfile.ZipFile(path) as deck:
            if ending == ".pptx":
                slides = [name for name in deck.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", name)]
                slides.sort(key=lambda name: int(re.search(r"(\d+)\.xml$", name).group(1)))
                pages = [deck.read(name).decode("utf-8", "replace") for name in slides]
                paragraph_end, text_part = "</a:p>", r"<a:t>([^<]*)</a:t>"
            elif ending == ".odp":
                pages = [deck.read("content.xml").decode("utf-8", "replace")]
                paragraph_end, text_part = "</text:p>", r">([^<]*)<"
            else:
                return ""
    except (zipfile.BadZipFile, KeyError, OSError):
        return ""

    lines = []
    for page in pages:
        for paragraph in page.split(paragraph_end):
            line = html.unescape("".join(re.findall(text_part, paragraph)))
            line = re.sub(r"\s+", " ", line).strip()
            if line:
                lines.append(line)
    return "\n".join(lines)[:MOST_TEXT]


# ---------------------------------------------------------------------------
# The spreadsheet
# ---------------------------------------------------------------------------

def read_typed_date(text):
    """A date as you typed it, or as Excel saved it (2026-07-12, 12/07/2026, 12/7/26)."""
    text = text.strip()
    found = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", text)
    if found:
        year, month, day = (int(part) for part in found.groups())
    else:
        found = re.match(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$", text)
        if not found:
            return ""
        day, month, year = (int(part) for part in found.groups())
        if year < 100:
            year += 2000
    try:
        return datetime.date(year, month, day).isoformat()
    except ValueError:
        return ""


def keep_earlier_edits(rows, plan_path):
    """Keeps what you typed in the last slides_plan.csv: status, year, occasion, title, church and date."""
    if not os.path.exists(plan_path):
        return
    earlier = {row["file"]: row for row in read_csv(plan_path)}
    for row in rows:
        old = earlier.get(row["file"])
        if old is None or row["status"] == "skip" and row["note"] != "":
            continue
        row["title"] = (old.get("title") or "").strip() or row["title"]
        if "church" in old:
            row["church"] = old["church"].strip()
        if (old.get("status") or "").strip().lower() == "skip":
            row["status"] = "skip"
        if "occasion" not in old:
            continue  # a plan from before PowerPoints were filed by occasion: its dates aren't kept
        year = (old.get("year") or "").strip().upper()
        row["year"] = year if year in ("A", "B", "C") else ""
        row["occasion"] = (old.get("occasion") or "").strip()
        row["date"] = read_typed_date(old.get("date") or "")
        if row["status"] != "skip":
            row["note"] = describe(row)
            row["status"] = "check" if row["note"].startswith("not an occasion") else "ok"


def write_plan(rows, plan_path):
    order = {occasion: index for index, occasion in enumerate(OCCASIONS)}
    rows.sort(key=lambda row: ({"check": 0, "ok": 1}.get(row["status"], 2), row["year"] or "Z",
                               order.get(row["occasion"], len(order)), row["title"].lower()))
    with open(plan_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

def upload(plan_path, site, token):
    """Makes the site's PowerPoint archive match your folders (see the top of this file)."""
    rows = read_csv(plan_path)
    if rows and "occasion" not in rows[0]:
        sys.exit(plan_path + ' is from before PowerPoints were filed by occasion. Run "scan" first.')
    plan = {row["file"]: row for row in rows}

    on_site = {}
    for line in ask_site(site, token, "GET", "/api/import/slides/done").splitlines():
        parts = line.split("\t") + ["", ""]
        if len(parts) >= 8:
            fingerprint, path, title, date, church, words_fingerprint, cycle, occasion = parts[:8]
            on_site[path] = {"hash": fingerprint, "title": title, "date": date, "church": church,
                             "words": words_fingerprint, "year": cycle, "occasion": occasion}

    wanted = []
    for row in rows:
        if row["status"].strip().lower() != "ok" or not os.path.exists(row["file"]):
            continue
        row["date"] = read_typed_date(row.get("date") or "")
        row["year"] = (row.get("year") or "").strip().upper()
        row["occasion"] = (row.get("occasion") or "").strip()
        if os.path.getsize(row["file"]) > BIGGEST_FILE_BYTES:
            print("  TOO BIG (over 95 MB, the free plan's limit)", row["file"])
            continue
        row["fingerprint"] = file_fingerprint(row["file"])
        wanted.append(row)

    gone = []
    for path in on_site:
        row = plan.get(path)
        if row is None or row["status"].strip().lower() == "skip" or not os.path.exists(path):
            gone.append(path)

    gone_by_fingerprint = {}
    for path in gone:
        gone_by_fingerprint.setdefault(on_site[path]["hash"], []).append(path)
    to_move, to_relabel, to_send = [], [], []
    for row in wanted:
        site_copy = on_site.get(row["file"])
        if site_copy is None:
            old_paths = gone_by_fingerprint.get(row["fingerprint"])
            if old_paths:
                to_move.append((old_paths.pop(), row))
            else:
                to_send.append(row)
        elif site_copy["hash"] != row["fingerprint"]:
            to_send.append(row)
        elif any(site_copy[column] != row.get(column, "").strip()
                 for column in ("title", "date", "church", "year", "occasion")):
            to_relabel.append(row)
    moved_from = {old_path for old_path, _ in to_move}
    to_delete = [path for path in gone if path not in moved_from]

    print("On the site:", len(on_site), "PowerPoints. Changes:")
    print("  new or edited:", len(to_send), " renamed or moved:", len(to_move),
          " refiled (year, occasion, title, church or date):", len(to_relabel), " to remove:", len(to_delete))

    failed = 0
    for old_path, row in to_move:
        failed += send(site, token, "/api/import/slides/update", row, {"source": old_path, "new_source": row["file"]})
    for row in to_relabel:
        failed += send(site, token, "/api/import/slides/update", row, {"source": row["file"]})
    for number, row in enumerate(to_send, start=1):
        print("  [" + str(number) + "/" + str(len(to_send)) + "]", end="")
        failed += send(site, token, "/api/import/slides/file", row, {"source": row["file"], "hash": row["fingerprint"]})

    # The words on the slides, for searching. Sent on their own, and only
    # when they've changed (or the site doesn't have them yet).
    words_on_site = {row["file"]: on_site.get(row["file"], {}).get("words", "") for row in wanted}
    for old_path, row in to_move:
        words_on_site[row["file"]] = on_site[old_path]["words"]
    words_sent = 0
    for row in wanted:
        words = words_in_slides(row["file"])
        words_fingerprint = hashlib.sha256(words.encode("utf-8")).hexdigest()
        if words == "" or words_on_site[row["file"]] == words_fingerprint:
            continue
        try:
            ask_site(site, token, "POST", "/api/import/slides/words?" + urllib.parse.urlencode(
                {"source": row["file"], "hash": words_fingerprint}), words.encode("utf-8"))
            words_sent += 1
        except RuntimeError as error:
            print("  FAILED to send the words of", row["file"], "-", error)
            failed += 1
    if words_sent:
        print("  Sent the words of", words_sent, "PowerPoints, for searching.")

    if to_delete:
        print()
        print("These", len(to_delete), "PowerPoints are on the site but gone from your folders (or marked skip):")
        for path in to_delete[:30]:
            print("   ", on_site[path]["title"])
        if len(to_delete) > 30:
            print("    ...and", len(to_delete) - 30, "more")
        answer = input("Remove them from the site? Type yes to remove, anything else to keep: ")
        if answer.strip().lower() == "yes":
            for path in to_delete:
                failed += send(site, token, "/api/import/slides/delete", None, {"source": path})
        else:
            print("  Kept them. They'll be listed again next time.")

    print("Done, but " + str(failed) + " failed. Run the upload again to retry them." if failed else "Done.")


def send(site, token, address, row, extra):
    """One request to the site (with the file, for /file). Returns 1 if it failed."""
    details = dict(extra)
    data = None
    if row is not None:
        details.update(title=row["title"].strip(), cycle=row["year"], occasion=row["occasion"], date=row["date"],
                       church=row.get("church", "").strip(), filename=os.path.basename(row["file"]))
        if address.endswith("/file"):
            with open(row["file"], "rb") as f:
                data = f.read()
    try:
        answer = ask_site(site, token, "POST", address + "?" + urllib.parse.urlencode(details), data)
        where = (details.get("occasion") or "Other services") + (", Year " + details["cycle"] if details.get("cycle") else "")
        print("  ", details.get("title", details["source"]), "(" + where + ")" if row is not None else "", "-", answer)
        return 0
    except RuntimeError as error:
        print("  FAILED", details["source"], "-", error)
        return 1


# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Bulk import of Sunday and service PowerPoints.")
    steps = parser.add_subparsers(dest="step", required=True)

    scan_step = steps.add_parser("scan", help="read the folder and write the spreadsheet")
    scan_step.add_argument("folder", help="the folder holding 'Sunday Mass Presentations'")
    scan_step.add_argument("--plan", default=PLAN_FILE)

    upload_step = steps.add_parser("upload", help="upload every row marked ok")
    upload_step.add_argument("--site", required=True, help="e.g. https://ourchoir.nz")
    upload_step.add_argument("--plan", default=PLAN_FILE)

    args = parser.parse_args()

    if args.step == "scan":
        rows = scan(args.folder)
        keep_earlier_edits(rows, args.plan)
        write_plan(rows, args.plan)
        counts = {}
        for row in rows:
            counts[row["status"]] = counts.get(row["status"], 0) + 1
        filed = sum(1 for row in rows if row["status"] == "ok" and row["occasion"])
        other = sum(1 for row in rows if row["status"] == "ok" and not row["occasion"])
        size = sum(os.path.getsize(row["file"]) for row in rows if row["status"] != "skip")
        print("Wrote", args.plan, "-", len(rows), "files.")
        print("  These take {:.2f} GB. Cloudflare's free storage is 10 GB, shared with the music.".format(size / 1e9))
        print("  ok:", counts.get("ok", 0), "(" + str(filed), "filed under a Sunday or feast,", other, "under Other services)")
        print("  check:", counts.get("check", 0))
        print("  skip:", counts.get("skip", 0))
        print('Look over', args.plan, 'in Excel if you like (fix any "check" rows), save, then run "upload".')
    else:
        token = os.environ.get("IMPORT_TOKEN") or getpass.getpass("Import token: ")
        upload(args.plan, args.site, token)


if __name__ == "__main__":
    main()
