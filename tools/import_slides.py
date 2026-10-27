"""
Bulk import of Sunday and service PowerPoints into the choir website.

They go in the site's PowerPoint archive under the date they were used, so
each one shows on that day's events. It works like import_music.py:

  1. SCAN: read your folder and write a spreadsheet (slides_plan.csv):

         python import_slides.py scan "C:\\Users\\Elijah\\Documents\\Music"

     Give it the same folder as import_music.py. It reads the folders named
     in SLIDES_FOLDERS below, plus PowerPoints sitting loose in the folder
     itself.

     Most of your file names say which Sunday or feast they're for, e.g.
     "15th Sunday in Ordinary Time - St Teresa's Church", and the folder
     says the year ("Year A - 2026"). From those the script works out the
     date. A date in the name also works, e.g. "20260531" or "29-03-2026".

  2. CHECK: open slides_plan.csv in Excel. Rows marked "check" have no date
     the script could work out (an ordination, a retreat, the Holy Rosary).
     Type the date in the date column and change "check" to "ok", or mark
     it "skip". Save.

  3. UPLOAD: upload every row marked "ok".

         python import_slides.py upload --site https://your-choir-site

     It asks for the import token, the same one as the music import.

The status column:
  ok     uploaded, under the date in the date column
  check  no date yet (the note says why). Fill in the date, then set ok or skip.
  skip   not on the site (videos, Word files, autosaves...). If it was
         uploaded before, "upload" offers to remove it.

Like the music import, "upload" makes the site match your folders: run
"scan" then "upload" again after any change. Unchanged files are skipped,
edited ones replace the site's copy, renamed or moved ones are moved
without being sent again, a changed title or date is updated, and files
gone from your folders are removed once you type yes. Running "scan" again
keeps what you typed in an existing slides_plan.csv.

PowerPoints you use again and again (the Holy Rosary, Stations of the
Cross) fit better on the site's "Prayers and services" page: put them in
the music library's prayers folder and import them with import_music.py.

Only Python's built-in libraries are used, so there is nothing to install.
"""

import argparse
import csv
import datetime
import getpass
import os
import re
import sys
import urllib.parse

# The music import has the pieces for talking to the site; use the same ones.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_music import BIGGEST_FILE_BYTES, ask_site, file_fingerprint, read_csv  # noqa: E402

PLAN_FILE = "slides_plan.csv"
COLUMNS = ["status", "date", "title", "note", "file"]

# Folders (directly inside the folder you scan) holding Sunday and service
# PowerPoints. Everything inside them is read, including subfolders.
SLIDES_FOLDERS = ["Sunday Mass Presentations"]

SLIDE_ENDINGS = {".ppt", ".pptx", ".odp"}

ONE_DAY = datetime.timedelta(days=1)
ONE_WEEK = datetime.timedelta(days=7)

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
# The Church's calendar, as kept in New Zealand
# ---------------------------------------------------------------------------

def easter_sunday(year):
    """Easter Sunday (the usual calculation for the Western church)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    el = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * el) // 451
    month, day = divmod(h + el - 7 * m + 114, 31)
    return datetime.date(year, month, day + 1)


def sunday_on_or_after(day):
    return day + datetime.timedelta(days=(6 - day.weekday()) % 7)


def sunday_before(day):
    return day - datetime.timedelta(days=day.weekday() + 1)


def first_sunday_of_advent(year):
    """The first Sunday of Advent in this calendar year (four Sundays before Christmas)."""
    return sunday_before(datetime.date(year, 12, 25)) - 3 * ONE_WEEK


def epiphany(year):
    """In New Zealand: the Sunday between 2 and 8 January."""
    return sunday_on_or_after(datetime.date(year, 1, 2))


def baptism_of_the_lord(year):
    """The Sunday after the Epiphany, or the Monday if the Epiphany is on 7 or 8 January."""
    day = epiphany(year)
    if day.day >= 7:
        return day + ONE_DAY
    return day + ONE_WEEK


def holy_family(year):
    """The Sunday between Christmas and New Year, or 30 December if there isn't one."""
    for day in range(26, 32):
        date = datetime.date(year, 12, day)
        if date.weekday() == 6:
            return date
    return datetime.date(year, 12, 30)


def ordinary_time_sunday(number, liturgical_year):
    """The Nth Sunday in Ordinary Time. The year runs from Advent the year before."""
    year = liturgical_year
    easter = easter_sunday(year)
    # Before Lent: the 2nd Sunday is the first Sunday after the Baptism of the Lord.
    before_lent = sunday_on_or_after(baptism_of_the_lord(year) + ONE_DAY) + (number - 2) * ONE_WEEK
    if number >= 2 and before_lent < easter - datetime.timedelta(days=46):
        return before_lent
    # After Pentecost: counted back from Christ the King, the 34th.
    christ_the_king = first_sunday_of_advent(year) - ONE_WEEK
    after_pentecost = christ_the_king - (34 - number) * ONE_WEEK
    if after_pentecost > easter + datetime.timedelta(days=49):
        return after_pentecost
    return None


ORDINAL = r"(\d+)(?:st|nd|rd|th)?"


def liturgical_date(name, liturgical_year):
    """
    The date a liturgy named like "3rd Sunday of Advent" or "Pentecost
    Sunday" fell on, in the liturgical year that ends in liturgical_year
    (so Advent and Christmas are in the year before). None if it isn't
    a name we know.
    """
    year = liturgical_year
    easter = easter_sunday(year)
    text = re.sub(r"\bst\b\.?", "saint", name.lower().replace("&", "and"))

    def days_after_easter(days):
        return easter + datetime.timedelta(days=days)

    found = re.search(ORDINAL + r"\s+day\s+(?:of\s+)?(?:the\s+)?(simbang gabi|christmas novena)", text)
    if found:
        return datetime.date(year - 1, 12, 15) + int(found.group(1)) * ONE_DAY
    found = re.search(ORDINAL + r"\s+day\s+novena\s+to\s+saint therese", text)
    if found:
        return datetime.date(year, 9, 21) + int(found.group(1)) * ONE_DAY
    if "novena" in text:
        return None  # a whole novena: nine days, so no one date
    found = re.search(ORDINAL + r"\s+sunday\s+(?:of|in)\s+ordinary\s+time", text)
    if found:
        return ordinary_time_sunday(int(found.group(1)), year)
    found = re.search(ORDINAL + r"\s+sunday\s+(?:of|in)\s+(advent|lent|easter)", text)
    if found:
        number, season = int(found.group(1)), found.group(2)
        if season == "advent":
            return first_sunday_of_advent(year - 1) + (number - 1) * ONE_WEEK
        if season == "lent":
            return easter - (7 - number) * ONE_WEEK
        if "ascension" in text:
            return days_after_easter(42)  # kept on the 7th Sunday of Easter in New Zealand
        return easter + (number - 1) * ONE_WEEK

    named = [
        ("ash wednesday", lambda: days_after_easter(-46)),
        ("rite of election", lambda: days_after_easter(-42)),
        ("palm sunday", lambda: days_after_easter(-7)),
        ("easter sunday", lambda: easter),
        ("ascension", lambda: days_after_easter(42)),
        ("pentecost", lambda: days_after_easter(49)),
        ("trinity", lambda: days_after_easter(56)),
        ("body and blood", lambda: days_after_easter(63)),
        ("corpus christi", lambda: days_after_easter(63)),
        ("sacred heart of jesus", lambda: days_after_easter(68)),
        ("christ the king", lambda: first_sunday_of_advent(year) - ONE_WEEK),
        ("holy family", lambda: holy_family(year - 1)),
        ("christmas day", lambda: datetime.date(year - 1, 12, 25)),
        ("nativity of the lord", lambda: datetime.date(year - 1, 12, 25)),
        ("mother of god", lambda: datetime.date(year, 1, 1)),
        ("new year", lambda: datetime.date(year, 1, 1)),
        ("epiphany", lambda: epiphany(year)),
        ("baptism of the lord", lambda: baptism_of_the_lord(year)),
        ("pedro calungsod", lambda: datetime.date(year, 4, 2)),
        ("peter and paul", lambda: datetime.date(year, 6, 29)),
        ("assumption", lambda: datetime.date(year, 8, 15)),
        ("exaltation of the holy cross", lambda: datetime.date(year, 9, 14)),
        ("saint therese", lambda: datetime.date(year, 10, 1)),
        ("all saints", lambda: datetime.date(year, 11, 1)),
        ("faithful departed", lambda: datetime.date(year, 11, 2)),
        ("all souls", lambda: datetime.date(year, 11, 2)),
        ("lateran", lambda: datetime.date(year, 11, 9)),
    ]
    for words, work_out in named:
        if words in text:
            return work_out()
    return None


# Feasts on a set date. A parish sometimes keeps one on the nearest Sunday,
# so the note asks you to look.
SET_DATE_FEASTS = ["pedro calungsod", "peter and paul", "assumption", "holy cross", "therese",
                   "all saints", "faithful departed", "all souls", "lateran"]


# ---------------------------------------------------------------------------
# Reading a file name
# ---------------------------------------------------------------------------

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


def make_row(path, filename):
    stem, ending = os.path.splitext(filename)
    row = {"status": "ok", "date": "", "title": tidy_title(stem), "note": "", "file": path}

    if filename.startswith("~$") or filename.startswith("."):
        row.update(status="skip", note="autosave or hidden file")
        return row
    if ending.lower() not in SLIDE_ENDINGS:
        row.update(status="skip", note="not a PowerPoint")
        return row
    if os.path.getsize(path) > BIGGEST_FILE_BYTES:
        row.update(status="skip", note="too big: Cloudflare's free plan takes files up to 95 MB")
        return row

    liturgical_year = year_from_path(path)
    date = date_in_name(stem, liturgical_year)
    how = "date in the file name"
    if date is None and liturgical_year:
        date = liturgical_date(stem, liturgical_year)
        how = "worked out from the name and the Year folder"
    if date is None:
        row["status"] = "check"
        if liturgical_year:
            row["note"] = "no date: type the date it was used (e.g. 2026-07-12), or skip"
        else:
            row["note"] = "no date and no Year folder: type the date it was used, or skip"
        return row

    row["date"] = date.isoformat()
    row["note"] = how
    if any(words in stem.lower() for words in SET_DATE_FEASTS) and how != "date in the file name":
        row["note"] += "; a feast on a set date, change it if it was kept on a Sunday"
    if "vigil" in stem.lower():
        row["note"] += "; vigil Mass, dated by its Sunday"
    return row


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
    """Keeps what you typed in the last slides_plan.csv: status, date and title."""
    if not os.path.exists(plan_path):
        return
    earlier = {row["file"]: row for row in read_csv(plan_path)}
    for row in rows:
        old = earlier.get(row["file"])
        if old is None:
            continue
        row["status"] = old["status"].strip().lower() or row["status"]
        row["date"] = read_typed_date(old["date"]) or row["date"]
        row["title"] = old["title"].strip() or row["title"]
        row["note"] = old["note"]


def write_plan(rows, plan_path):
    rows.sort(key=lambda row: ({"check": 0, "ok": 1}.get(row["status"], 2), row["date"], row["title"].lower()))
    with open(plan_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

def upload(plan_path, site, token):
    """Makes the site's PowerPoint archive match your folders (see the top of this file)."""
    rows = read_csv(plan_path)
    plan = {row["file"]: row for row in rows}

    on_site = {}
    for line in ask_site(site, token, "GET", "/api/import/slides/done").splitlines():
        parts = line.split("\t")
        if len(parts) >= 4:
            fingerprint, path, title, date = parts[:4]
            on_site[path] = {"hash": fingerprint, "title": title, "date": date}

    wanted = []
    for row in rows:
        if row["status"].strip().lower() != "ok" or not os.path.exists(row["file"]):
            continue
        row["date"] = read_typed_date(row["date"])
        if row["date"] == "":
            print("  NO DATE, left alone:", row["file"])
            continue
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
        elif site_copy["title"] != row["title"].strip() or site_copy["date"] != row["date"]:
            to_relabel.append(row)
    moved_from = {old_path for old_path, _ in to_move}
    to_delete = [path for path in gone if path not in moved_from]

    print("On the site:", len(on_site), "PowerPoints. Changes:")
    print("  new or edited:", len(to_send), " renamed or moved:", len(to_move),
          " new title or date:", len(to_relabel), " to remove:", len(to_delete))

    failed = 0
    for old_path, row in to_move:
        failed += send(site, token, "/api/import/slides/update", row, {"source": old_path, "new_source": row["file"]})
    for row in to_relabel:
        failed += send(site, token, "/api/import/slides/update", row, {"source": row["file"]})
    for number, row in enumerate(to_send, start=1):
        print("  [" + str(number) + "/" + str(len(to_send)) + "]", end="")
        failed += send(site, token, "/api/import/slides/file", row, {"source": row["file"], "hash": row["fingerprint"]})

    if to_delete:
        print()
        print("These", len(to_delete), "PowerPoints are on the site but gone from your folders (or marked skip):")
        for path in to_delete[:30]:
            print("   ", on_site[path]["date"], on_site[path]["title"])
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
        details.update(title=row["title"].strip(), date=row["date"], filename=os.path.basename(row["file"]))
        if address.endswith("/file"):
            with open(row["file"], "rb") as f:
                data = f.read()
    try:
        answer = ask_site(site, token, "POST", address + "?" + urllib.parse.urlencode(details), data)
        print("  ", details.get("date", ""), details.get("title", details["source"]), "-", answer)
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
        size = sum(os.path.getsize(row["file"]) for row in rows if row["status"] != "skip")
        print("Wrote", args.plan, "-", len(rows), "files.")
        print("  These take {:.2f} GB. Cloudflare's free storage is 10 GB, shared with the music.".format(size / 1e9))
        for status in ("ok", "check", "skip"):
            print("  " + status + ":", counts.get(status, 0))
        print('Open', args.plan, 'in Excel, give the "check" rows a date (or skip them), save, then run "upload".')
    else:
        token = os.environ.get("IMPORT_TOKEN") or getpass.getpass("Import token: ")
        upload(args.plan, args.site, token)


if __name__ == "__main__":
    main()
