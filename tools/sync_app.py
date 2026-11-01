"""
Choir site sync: a small window that keeps the website's music library and
PowerPoints up to date with your Music folder.

    python tools/sync_app.py

(or double-click it). It runs the same scan and upload as import_music.py
and import_slides.py, so everything in those files still applies:
song_list.csv, import_plan.csv and slides_plan.csv are still yours to edit.

Two ways to use it:

  Sync now       does a scan and upload straight away.
  Update         when ticked, the app checks your Music folder every minute.
  automatically  When something changes (a new, edited, renamed or deleted
                 file, or you save one of the spreadsheets), it waits for the
                 folder to settle, then syncs by itself.

To be safe when nobody is watching, a sync:
  - uploads only rows marked "ok". New files the scripts aren't sure about
    are marked "check" and wait for you: click "Fix 'check' rows", sort
    them out in Excel, save, and the next sync picks them up.
  - never removes anything from the site. Files gone from your folders are
    counted, and stay on the site until you click "Remove deleted files".

Songs... adds new songs to song_list.csv without opening Excel, and lists
the titles in your folder that aren't on it yet, to add or link to a song.

Settings (Music folder, site address, import token) are saved in
sync_settings.json next to your spreadsheets. It holds the import token, so
keep it to yourself; it's left out of git.

Only Python's built-in libraries are used, so there is nothing to install.
"""

import csv
import datetime
import difflib
import hashlib
import html
import json
import os
import queue
import re
import subprocess
import sys
import threading
import zipfile
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_music import SONG_LIST_COLUMNS, match_key, read_csv, tidy_tags  # noqa: E402

TOOLS = os.path.dirname(os.path.abspath(__file__))
# The spreadsheets live where you've always run the scripts from: the
# folder above tools/ (the same place README tells you to run them).
WORK_FOLDER = os.path.dirname(TOOLS)
SETTINGS_FILE = os.path.join(WORK_FOLDER, "sync_settings.json")

MUSIC_PLAN = os.path.join(WORK_FOLDER, "import_plan.csv")
SONG_LIST = os.path.join(WORK_FOLDER, "song_list.csv")
SUGGESTIONS = os.path.join(WORK_FOLDER, "tag_suggestions.csv")
SLIDES_PLAN = os.path.join(WORK_FOLDER, "slides_plan.csv")
SPREADSHEETS = [SONG_LIST, MUSIC_PLAN, SUGGESTIONS, SLIDES_PLAN]

# How often the folder is looked at, in seconds. Looking costs nothing on
# the site: only a real change leads to a sync.
CHECK_EVERY = 60

DEFAULTS = {"folder": "", "site": "", "token": "", "auto": False}


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

def load_settings():
    settings = dict(DEFAULTS)
    try:
        with open(SETTINGS_FILE, encoding="utf-8") as f:
            settings.update(json.load(f))
    except (OSError, ValueError):
        pass
    return settings


def save_settings(settings):
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)


# ---------------------------------------------------------------------------
# Noticing changes
# ---------------------------------------------------------------------------

def folder_snapshot(folder):
    """
    A fingerprint of the names, sizes and times of every file in the Music
    folder. It changes when anything is added, edited, renamed or deleted.
    Files aren't read, so it's quick.
    """
    sha = hashlib.sha256()
    for dirpath, dirnames, filenames in os.walk(folder):
        dirnames.sort()
        for name in sorted(filenames):
            if name.startswith("~$"):
                continue  # Office's lock files while a document is open
            path = os.path.join(dirpath, name)
            try:
                info = os.stat(path)
            except OSError:
                continue
            sha.update("{}|{}|{}\n".format(path, info.st_size, int(info.st_mtime)).encode("utf-8", "replace"))
    return sha.hexdigest()


def spreadsheets_snapshot():
    """
    A fingerprint of what's in your spreadsheets, so saving a fix in Excel
    counts as a change. Their contents are used, not their times, because
    every scan writes the plans again (usually with nothing different).
    """
    sha = hashlib.sha256()
    for path in SPREADSHEETS:
        try:
            with open(path, "rb") as f:
                sha.update(f.read())
        except OSError:
            sha.update(b"-")
    return sha.hexdigest()


def snapshot(folder):
    return folder_snapshot(folder) + spreadsheets_snapshot()


# ---------------------------------------------------------------------------
# Running the import scripts
# ---------------------------------------------------------------------------

def python_program():
    """python.exe, even when this app was started with pythonw.exe (no console)."""
    program = sys.executable
    folder, name = os.path.split(program)
    if name.lower() == "pythonw.exe" and os.path.exists(os.path.join(folder, "python.exe")):
        return os.path.join(folder, "python.exe")
    return program


def run_script(arguments, token, say, answer=None):
    """Runs one of the import scripts, passing each line it prints to say(). Returns (worked, output)."""
    command = [python_program(), "-u"] + arguments
    environment = dict(os.environ, IMPORT_TOKEN=token, PYTHONIOENCODING="utf-8")
    extra = {}
    if os.name == "nt":
        extra["creationflags"] = 0x08000000  # CREATE_NO_WINDOW: no black console popping up
    process = subprocess.Popen(
        command, cwd=WORK_FOLDER, env=environment,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace", **extra,
    )
    if answer is not None:
        process.stdin.write(answer)
    process.stdin.close()
    output = []
    for line in process.stdout:
        line = line.rstrip("\n")
        output.append(line)
        say("    " + line)
    process.wait()
    text = "\n".join(output)
    if "PermissionError" in text:
        say("    One of the spreadsheets is open in Excel. Close it and sync again.")
    return process.returncode == 0, text


def number_after(pattern, text):
    match = re.search(pattern, text)
    return int(match.group(1)) if match else 0


def sync(settings, say, remove_deleted=False):
    """
    Scan and upload the music, then the PowerPoints. Returns a summary dict:
    worked, checks (rows waiting for you) and removed (files gone from your
    folders that are still on the site).
    """
    folder, site, token = settings["folder"], settings["site"], settings["token"]
    music = os.path.join(TOOLS, "import_music.py")
    slides = os.path.join(TOOLS, "import_slides.py")
    keep = [] if remove_deleted else ["--keep-removed"]
    answer = "yes\n" if remove_deleted else None
    summary = {"worked": True, "checks": 0, "removed": 0}

    # Music. The very first scan writes song_list.csv, which needs tidying by
    # hand before anything is uploaded (see import_music.py), so the app
    # leaves that first step to you.
    if not os.path.exists(SONG_LIST):
        say("Music: skipped. Do the first music import by hand (see README), then the app takes over.")
    else:
        say("Music: scanning...")
        worked, text = run_script([music, "scan", folder, "--plan", MUSIC_PLAN, "--songs", SONG_LIST,
                                   "--suggestions", SUGGESTIONS], token, say)
        summary["checks"] += number_after(r"check:\s*(\d+)", text)
        if worked:
            say("Music: uploading...")
            worked, text = run_script([music, "upload", "--site", site, "--plan", MUSIC_PLAN, "--songs", SONG_LIST,
                                       "--suggestions", SUGGESTIONS] + keep, token, say, answer)
            if not remove_deleted:
                summary["removed"] += number_after(r"These (\d+) files are on the site but gone", text)
        summary["worked"] &= worked and "failed" not in text

    say("PowerPoints: scanning...")
    worked, text = run_script([slides, "scan", folder, "--plan", SLIDES_PLAN], token, say)
    summary["checks"] += number_after(r"check:\s*(\d+)", text)
    if worked:
        say("PowerPoints: uploading...")
        worked, text = run_script([slides, "upload", "--site", site, "--plan", SLIDES_PLAN] + keep, token, say, answer)
        if not remove_deleted:
            summary["removed"] += number_after(r"These (\d+) PowerPoints are on the site but gone", text)
    summary["worked"] &= worked and "failed" not in text
    return summary


# ---------------------------------------------------------------------------
# Your song list, without Excel
# ---------------------------------------------------------------------------

def read_song_rows():
    """song_list.csv as a list of rows, and its columns (yours, in your order)."""
    rows = read_csv(SONG_LIST)
    columns = list(rows[0].keys()) if rows else list(SONG_LIST_COLUMNS)
    for column in SONG_LIST_COLUMNS:
        if column not in columns:
            columns.append(column)
    return rows, columns


def write_song_rows(rows, columns):
    rows.sort(key=lambda song: (song.get("title") or "").lower())
    with open(SONG_LIST, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def song_lookup(rows):
    """Every spelling (simplified) to its song's title, the same way the scan matches files."""
    lookup = {}
    for song in rows:
        title = (song.get("title") or "").strip()
        for spelling in [title] + (song.get("other_spellings") or "").split(";"):
            if spelling.strip() and title:
                lookup[match_key(spelling)] = title
    return lookup


def split_spellings(text):
    return [part.strip() for part in (text or "").split(";") if part.strip()]


def add_song(title, other_spellings="", tags=""):
    """Adds a new song to song_list.csv. Returns a problem to show, or None if it worked."""
    title = re.sub(r"\s+", " ", title or "").strip()
    if not title:
        return "Type the song's title."
    rows, columns = read_song_rows()
    lookup = song_lookup(rows)
    spellings = [s for s in split_spellings(other_spellings) if match_key(s) != match_key(title)]
    for spelling in [title] + spellings:
        if match_key(spelling) in lookup:
            return '"{}" is already on the list, as "{}".'.format(spelling, lookup[match_key(spelling)])
    song = {column: "" for column in columns}
    song.update(title=title, other_spellings="; ".join(spellings), tags=tidy_tags(tags), note="added in the sync app")
    rows.append(song)
    write_song_rows(rows, columns)
    return None


def add_spelling(title, spelling):
    """Adds another spelling to a song already on song_list.csv. Returns a problem, or None."""
    spelling = re.sub(r"\s+", " ", spelling or "").strip()
    rows, columns = read_song_rows()
    lookup = song_lookup(rows)
    if match_key(spelling) in lookup:
        return '"{}" is already on the list, as "{}".'.format(spelling, lookup[match_key(spelling)])
    for song in rows:
        if (song.get("title") or "").strip().lower() == (title or "").strip().lower():
            song["other_spellings"] = "; ".join(split_spellings(song.get("other_spellings")) + [spelling])
            write_song_rows(rows, columns)
            return None
    return 'There\'s no song called "{}" on the list.'.format(title)


def unknown_titles():
    """
    Titles of files in your folder that don't match any song on the list,
    from the last scan (the "check" rows in import_plan.csv), each with its
    rows from the plan (one per file). Ones the list now matches are left out.
    """
    if not os.path.exists(MUSIC_PLAN) or not os.path.exists(SONG_LIST):
        return []
    lookup = song_lookup(read_song_rows()[0])
    files = {}
    for row in read_csv(MUSIC_PLAN):
        if (row.get("status") or "").strip().lower() != "check":
            continue
        if not (row.get("note") or "").startswith("not on song_list.csv"):
            continue
        title = (row.get("song_title") or "").strip()
        if title and match_key(title) not in lookup:
            files.setdefault(title, []).append(row)
    return sorted(files.items(), key=lambda item: item[0].lower())


# ---------------------------------------------------------------------------
# What's in a file: to tell which song it is without opening it
# ---------------------------------------------------------------------------

FILE_TYPES = {
    ".pdf": "PDF", ".doc": "Word document (old)", ".docx": "Word document", ".odt": "OpenDocument text",
    ".mscz": "MuseScore score", ".mscx": "MuseScore score", ".ppt": "PowerPoint (old)", ".pptx": "PowerPoint",
    ".odp": "OpenDocument slides", ".jpg": "Picture", ".jpeg": "Picture", ".png": "Picture",
    ".mp3": "Recording", ".m4a": "Recording", ".wav": "Recording", ".cho": "ChordPro chords", ".chordpro": "ChordPro chords",
}

# The most words shown from inside a file.
PREVIEW_LETTERS = 600


def xml_text(xml, tag):
    """The words inside every <tag>...</tag> in some XML, joined into lines."""
    found = re.findall(r"<" + tag + r"(?:\s[^>]*)?>([^<]*)</" + tag + r">", xml)
    return html.unescape(" ".join(found))


def office_details(path, ending):
    """Title, author and the first words of a PowerPoint, Word or OpenDocument file (all zip files of XML)."""
    details, words = [], ""
    try:
        with zipfile.ZipFile(path) as package:
            names = set(package.namelist())
            if "docProps/core.xml" in names:  # PowerPoint and Word
                core = package.read("docProps/core.xml").decode("utf-8", "replace")
                for label, tag in (("Title", "dc:title"), ("Subject", "dc:subject"), ("Author", "dc:creator"),
                                   ("Last saved by", "cp:lastModifiedBy")):
                    value = xml_text(core, tag).strip()
                    if value:
                        details.append((label, value))
            if "meta.xml" in names:  # OpenDocument
                meta = package.read("meta.xml").decode("utf-8", "replace")
                for label, tag in (("Title", "dc:title"), ("Author", "meta:initial-creator")):
                    value = xml_text(meta, tag).strip()
                    if value:
                        details.append((label, value))
            if ending == ".pptx":
                slides = sorted((name for name in names if re.match(r"ppt/slides/slide\d+\.xml$", name)),
                                key=lambda name: int(re.search(r"(\d+)\.xml$", name).group(1)))
                details.append(("Slides", str(len(slides))))
                words = "\n".join(xml_text(paragraph, "a:t") for name in slides[:6]
                                  for paragraph in package.read(name).decode("utf-8", "replace").split("</a:p>"))
            elif ending == ".docx" and "word/document.xml" in names:
                document = package.read("word/document.xml").decode("utf-8", "replace")
                words = "\n".join(xml_text(paragraph, "w:t") for paragraph in document.split("</w:p>"))
            elif ending in (".odt", ".odp") and "content.xml" in names:
                content = package.read("content.xml").decode("utf-8", "replace")
                words = "\n".join(html.unescape(re.sub(r"<[^>]+>", "", part)) for part in content.split("</text:p>"))
            elif ending == ".mscz":
                score = next((name for name in names if name.endswith(".mscx")), None)
                if score:
                    xml = package.read(score).decode("utf-8", "replace")
                    for label, name in (("Title", "workTitle"), ("Composer", "composer"), ("Lyricist", "lyricist")):
                        match = re.search(r'<metaTag name="' + name + r'">([^<]+)</metaTag>', xml)
                        if match:
                            details.append((label, html.unescape(match.group(1))))
                    words = " ".join(xml_text(xml, "text").split())
    except (zipfile.BadZipFile, KeyError, OSError, ValueError):
        pass
    return details, words


def pdf_details(path):
    """The title and author a PDF says it has, when it says (not every PDF does)."""
    details = []
    try:
        with open(path, "rb") as f:
            start = f.read(200_000)
            f.seek(max(0, os.path.getsize(path) - 200_000))
            data = start + f.read()
    except OSError:
        return details
    for label, key in (("Title", b"/Title"), ("Author", b"/Author"), ("Made with", b"/Creator")):
        match = re.search(re.escape(key) + rb"\s*\(((?:[^()\\]|\\.){1,200})\)", data)
        if match:
            raw = match.group(1)
            # Text written as UTF-16 (starting FE FF) or plain letters.
            value = raw[2:].decode("utf-16-be", "replace") if raw.startswith(b"\xfe\xff") else raw.decode("latin-1")
            value = value.replace("\\(", "(").replace("\\)", ")").strip()
            if value:
                details.append((label, value))
    pages = len(re.findall(rb"/Type\s*/Page[^s]", start))
    if pages:
        details.append(("Pages", str(pages) + " or more" if len(start) == 200_000 else str(pages)))
    return details


def mp3_details(path):
    """The song title and artist an MP3 carries (its ID3 tag), if any."""
    details = []
    try:
        with open(path, "rb") as f:
            header = f.read(10)
            if header[:3] != b"ID3":
                return details
            size = (header[6] << 21) | (header[7] << 14) | (header[8] << 7) | header[9]
            tag = f.read(min(size, 500_000))
    except OSError:
        return details
    labels = {b"TIT2": "Title", b"TPE1": "Artist", b"TALB": "Album"}
    place = 0
    while place + 10 <= len(tag) and tag[place:place + 4].strip(b"\x00"):
        frame, length = tag[place:place + 4], int.from_bytes(tag[place + 4:place + 8], "big")
        body = tag[place + 10:place + 10 + length]
        if frame in labels and body:
            encoding = {0: "latin-1", 1: "utf-16", 2: "utf-16-be", 3: "utf-8"}.get(body[0], "latin-1")
            value = body[1:].decode(encoding, "replace").strip("\x00 ")
            if value:
                details.append((labels[frame], value))
        place += 10 + length
    return details


def describe_file(row):
    """Lines describing one file: what the scan made of it, then what's inside it."""
    path = row.get("file") or ""
    ending = os.path.splitext(path)[1].lower()
    lines = [("File", os.path.basename(path)), ("Folder", os.path.dirname(path)),
             ("Type", FILE_TYPES.get(ending, ending or "unknown"))]
    for label, column in (("Kind", "kind"), ("Key", "key"), ("Version", "version"), ("Note", "note")):
        value = (row.get(column) or "").strip()
        if column == "note":
            # Every file here is "not on song_list.csv"; only the scan's other hints are worth showing.
            value = value.split("; ", 1)[1] if value.startswith("not on song_list.csv") and "; " in value else (
                "" if value.startswith("not on song_list.csv") else value)
        if value:
            lines.append((label, value))
    words = ""
    try:
        info = os.stat(path)
        lines.append(("Size", "{:,.0f} KB".format(info.st_size / 1000)))
        lines.append(("Changed", datetime.datetime.fromtimestamp(info.st_mtime).strftime("%d %b %Y %H:%M")))
    except OSError:
        lines.append(("Size", "the file isn't there any more"))
        return lines, ""
    if ending in (".pptx", ".docx", ".odt", ".odp", ".mscz"):
        details, words = office_details(path, ending)
        lines += details
    elif ending == ".pdf":
        lines += pdf_details(path)
    elif ending == ".mp3":
        lines += mp3_details(path)
    elif ending in (".cho", ".chordpro", ".mscx"):
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                words = f.read(20_000)
            if ending == ".mscx":
                words = " ".join(xml_text(words, "text").split())
        except OSError:
            pass
    words = re.sub(r"\n\s*\n+", "\n", words).strip()
    if len(words) > PREVIEW_LETTERS:
        words = words[:PREVIEW_LETTERS].rsplit(" ", 1)[0] + " ..."
    return lines, words


def open_file(path, show_in_folder=False):
    """Opens a file, or the folder it's in with the file picked out."""
    if os.name == "nt":
        if show_in_folder:
            subprocess.Popen('explorer /select,"{}"'.format(os.path.normpath(path)))
        else:
            os.startfile(path)
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", path] if show_in_folder else ["open", path])
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(path) if show_in_folder else path])


# ---------------------------------------------------------------------------
# Starting with Windows
# ---------------------------------------------------------------------------

def startup_file():
    folder = os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
    return os.path.join(folder, "Choir site sync.vbs")


def set_start_with_windows(on):
    path = startup_file()
    if not on:
        if os.path.exists(path):
            os.remove(path)
        return
    folder, _ = os.path.split(sys.executable)
    pythonw = os.path.join(folder, "pythonw.exe")
    if not os.path.exists(pythonw):
        pythonw = sys.executable
    # A tiny script Windows runs at sign-in: starts the app minimised, with no console window.
    with open(path, "w", encoding="utf-8") as f:
        f.write('CreateObject("WScript.Shell").Run """{}"" ""{}"" --minimized", 0\n'.format(
            pythonw, os.path.abspath(__file__)))


# ---------------------------------------------------------------------------
# The window
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# The look: the website's colours (public/styles.css), light and dark
# ---------------------------------------------------------------------------

# Keep in step with the "--" colours at the top of public/styles.css.
LIGHT = {
    "accent": "#2d4a7c", "accent_soft": "#e8edf6", "gold": "#c9a34e", "text": "#1d1d1f", "muted": "#6e6e73",
    "background": "#fbfaf7", "surface": "#ffffff", "border": "#e7e5e0", "danger": "#c0392b",
}
DARK = {
    "accent": "#9db8e8", "accent_soft": "#1f2a3d", "gold": "#e0be6e", "text": "#f2f2f2", "muted": "#a1a1a6",
    "background": "#121316", "surface": "#1b1c20", "border": "#2c2d33", "danger": "#ff6b5e",
}
THEME_NAMES = {"system": "\u25d0  Same as Windows", "light": "\u25d0  Light", "dark": "\u25d0  Dark"}

# The site uses the device's own font, which on Windows is Segoe UI.
FONT = "Segoe UI" if os.name == "nt" else "Helvetica"
MONO = "Consolas" if os.name == "nt" else "Courier"
ICON = os.path.join(WORK_FOLDER, "public", "icon-192.png")


def windows_uses_dark():
    """True when Windows is set to dark mode for apps."""
    if os.name != "nt":
        return False
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize") as key:
            return winreg.QueryValueEx(key, "AppsUseLightTheme")[0] == 0
    except OSError:
        return False


def mix(colour, other, amount):
    """A colour part of the way (0 to 1) towards another, for hover shades."""
    a = [int(colour[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(other[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join("{:02x}".format(round(x + (y - x) * amount)) for x, y in zip(a, b))


class Theme:
    """Paints every window in the site's colours, and repaints them when you switch light/dark."""

    def __init__(self, root, choice):
        self.root = root
        self.choice = choice
        self.plain = []  # (widget, kind): the few non-ttk widgets, painted by hand
        self.style = ttk.Style(root)
        self.style.theme_use("clam")  # the ttk look that takes colours best
        self.apply()

    @property
    def dark(self):
        return self.choice == "dark" or (self.choice == "system" and windows_uses_dark())

    def apply(self):
        c = self.colours = DARK if self.dark else LIGHT
        st = self.style
        base = (FONT, 10)
        st.configure(".", background=c["background"], foreground=c["text"], font=base,
                     bordercolor=c["border"], lightcolor=c["border"], darkcolor=c["border"],
                     troughcolor=c["background"], focuscolor=c["accent"], insertcolor=c["text"],
                     selectbackground=c["accent_soft"], selectforeground=c["text"])
        st.configure("TFrame", background=c["background"])
        st.configure("Card.TFrame", background=c["surface"], borderwidth=1, relief="solid")
        st.configure("TLabel", background=c["background"], foreground=c["text"])
        st.configure("Card.TLabel", background=c["surface"])
        st.configure("Muted.Card.TLabel", background=c["surface"], foreground=c["muted"], font=(FONT, 9))
        st.configure("Heading.Card.TLabel", background=c["surface"], font=(FONT, 12, "bold"))
        st.configure("Good.Card.TLabel", background=c["surface"], foreground=c["accent"])
        st.configure("Problem.Card.TLabel", background=c["surface"], foreground=c["danger"])
        st.configure("Good.TLabel", foreground=c["accent"])
        st.configure("Title.TLabel", font=(FONT, 15, "bold"))
        st.configure("Subtitle.TLabel", foreground=c["muted"], font=(FONT, 9))

        # Buttons: filled in the accent colour, like the site's; a quieter outlined one.
        st.configure("TButton", background=c["accent"], foreground=c["background"], font=(FONT, 10, "bold"),
                     borderwidth=0, padding=(18, 8), relief="flat", focusthickness=0)
        st.map("TButton",
               background=[("disabled", c["border"]), ("pressed", mix(c["accent"], c["text"], 0.15)),
                           ("active", mix(c["accent"], c["background"], 0.12))],
               foreground=[("disabled", c["muted"])])
        st.configure("Secondary.TButton", background=c["surface"], foreground=c["accent"], borderwidth=1,
                     relief="solid", bordercolor=c["border"], lightcolor=c["surface"], darkcolor=c["surface"])
        st.map("Secondary.TButton",
               background=[("disabled", c["surface"]), ("pressed", c["accent_soft"]), ("active", c["accent_soft"])],
               foreground=[("disabled", c["muted"])], bordercolor=[("active", c["accent"])])
        st.configure("Danger.TButton", background=c["surface"], foreground=c["danger"], borderwidth=1,
                     relief="solid", bordercolor=c["border"], lightcolor=c["surface"], darkcolor=c["surface"])
        st.map("Danger.TButton", background=[("disabled", c["surface"]), ("active", c["accent_soft"])],
               foreground=[("disabled", c["muted"])])
        st.configure("Header.TButton", background=c["background"], foreground=c["muted"], font=(FONT, 9),
                     padding=(10, 4), borderwidth=1, relief="solid", bordercolor=c["border"],
                     lightcolor=c["background"], darkcolor=c["background"])
        st.map("Header.TButton", background=[("active", c["accent_soft"])], foreground=[("active", c["accent"])])

        for kind in ("TCheckbutton",):
            st.configure(kind, background=c["surface"], foreground=c["text"], indicatorbackground=c["surface"],
                         indicatorforeground=c["accent"], indicatormargin=(0, 0, 8, 0), padding=(0, 4))
            st.map(kind, background=[("active", c["surface"])],
                   indicatorbackground=[("selected", c["accent_soft"]), ("active", c["accent_soft"])])
        for kind in ("TEntry", "TCombobox"):
            st.configure(kind, fieldbackground=c["background"], foreground=c["text"], padding=(8, 6),
                         bordercolor=c["border"], lightcolor=c["background"], darkcolor=c["background"],
                         arrowcolor=c["muted"], background=c["surface"])
            st.map(kind, bordercolor=[("focus", c["accent"])], lightcolor=[("focus", c["accent"])],
                   fieldbackground=[("readonly", c["background"])])
        st.configure("Vertical.TScrollbar", background=c["surface"], troughcolor=c["surface"],
                     bordercolor=c["surface"], lightcolor=c["surface"], darkcolor=c["surface"], arrowcolor=c["muted"])
        st.map("Vertical.TScrollbar", background=[("active", c["accent_soft"])])
        # The Combobox's drop-down list is a plain Tk list.
        self.root.option_add("*TCombobox*Listbox.background", c["surface"])
        self.root.option_add("*TCombobox*Listbox.foreground", c["text"])
        self.root.option_add("*TCombobox*Listbox.selectBackground", c["accent_soft"])
        self.root.option_add("*TCombobox*Listbox.selectForeground", c["text"])
        self.root.option_add("*TCombobox*Listbox.font", base)

        self.root.configure(background=c["background"])
        for widget, kind in list(self.plain):
            try:
                self.paint(widget, kind)
            except tk.TclError:
                self.plain.remove((widget, kind))  # its window was closed

    def paint(self, widget, kind):
        c = self.colours
        if kind == "window":
            widget.configure(background=c["background"])
            dark_title_bar(widget, self.dark)
            return
        widget.configure(background=c["surface"], foreground=c["text"], relief="flat", borderwidth=0,
                         highlightthickness=1, highlightbackground=c["border"], highlightcolor=c["accent"],
                         selectbackground=c["accent_soft"], selectforeground=c["text"])
        if kind == "text":
            widget.configure(insertbackground=c["text"], padx=10, pady=8)
            widget.tag_configure("label", font=(FONT, 9, "bold"), foreground=c["muted"])
            widget.tag_configure("words", foreground=c["text"])

    def add(self, widget, kind):
        """A non-ttk widget (window, list or text box) to keep in the site's colours."""
        self.plain.append((widget, kind))
        self.paint(widget, kind)
        return widget

    def switch(self):
        """Same as Windows, then Light, then Dark, like the half-circle button on the site."""
        order = ["system", "light", "dark"]
        self.choice = order[(order.index(self.choice) + 1) % 3] if self.choice in order else "system"
        self.apply()
        return self.choice


def dark_title_bar(window, dark):
    """Windows 10 and 11 can draw a window's title bar dark; ask it to, to match."""
    if os.name != "nt":
        return
    try:
        import ctypes
        window.update_idletasks()
        handle = ctypes.windll.user32.GetParent(window.winfo_id())
        value = ctypes.c_int(1 if dark else 0)
        for attribute in (20, 19):  # DWMWA_USE_IMMERSIVE_DARK_MODE, newer then older Windows
            if ctypes.windll.dwmapi.DwmSetWindowAttribute(handle, attribute, ctypes.byref(value), ctypes.sizeof(value)) == 0:
                break
    except Exception:
        pass  # only looks; never worth stopping for


def scrolled(parent, theme, kind, **options):
    """A list or text box with a slim scrollbar beside it, in a frame. Returns (frame, widget)."""
    frame = ttk.Frame(parent, style="Card.TFrame", borderwidth=0)
    widget = (tk.Listbox if kind == "list" else tk.Text)(frame, **options)
    bar = ttk.Scrollbar(frame, orient="vertical", command=widget.yview)
    widget.configure(yscrollcommand=bar.set)
    bar.pack(side="right", fill="y")
    widget.pack(side="left", fill="both", expand=True)
    theme.add(widget, kind)
    return frame, widget


def card(parent, title=None, note=None):
    """A white (or dark) panel with a thin border, like the site's cards. Returns its inside frame."""
    outer = ttk.Frame(parent, style="Card.TFrame", padding=(16, 12))
    if title:
        ttk.Label(outer, text=title, style="Heading.Card.TLabel").pack(anchor="w")
    if note:
        ttk.Label(outer, text=note, style="Muted.Card.TLabel", wraplength=760, justify="left").pack(anchor="w", pady=(0, 6))
    return outer


def header(parent, theme, title, subtitle, on_switch=None):
    """The top bar: the site's icon and a name, with the light/dark button on the right."""
    bar = ttk.Frame(parent, padding=(18, 14, 18, 6))
    bar.pack(fill="x")
    try:
        icon = tk.PhotoImage(file=ICON).subsample(6)  # 192 px down to 32
        label = ttk.Label(bar, image=icon)
        label.image = icon
        label.pack(side="left", padx=(0, 12))
    except tk.TclError:
        pass
    words = ttk.Frame(bar)
    words.pack(side="left")
    ttk.Label(words, text=title, style="Title.TLabel").pack(anchor="w")
    ttk.Label(words, text=subtitle, style="Subtitle.TLabel").pack(anchor="w")
    button = None
    if on_switch:
        button = ttk.Button(bar, text=THEME_NAMES.get(theme.choice, THEME_NAMES["system"]), style="Header.TButton",
                            command=on_switch, cursor="hand2")
        button.pack(side="right")
    return button


class App:
    def __init__(self, root, minimized):
        self.root = root
        self.settings = load_settings()
        self.messages = queue.Queue()
        self.busy = False
        self.last_synced = None   # folder snapshot after the last good sync
        self.last_seen = None     # folder snapshot at the last check
        self.retry_at = None      # after a failed sync, when to try again

        root.title("Choir site sync")
        root.minsize(720, 640)
        root.geometry("820x720")
        self.theme = Theme(root, self.settings.get("theme", "system"))
        self.theme.add(root, "window")
        try:
            self.icon = tk.PhotoImage(file=ICON)
            root.iconphoto(True, self.icon)
        except tk.TclError:
            pass

        self.theme_button = header(root, self.theme, "Choir site sync",
                                   "Keeps the website's music and PowerPoints in step with your Music folder",
                                   on_switch=self.switch_theme)
        body = ttk.Frame(root, padding=(18, 6, 18, 18))
        body.pack(fill="both", expand=True)
        gap = {"fill": "x", "pady": (0, 12)}

        # Where to sync from and to.
        setup = card(body, "Setup")
        setup.pack(**gap)
        form = ttk.Frame(setup, style="Card.TFrame", borderwidth=0)
        form.pack(fill="x", pady=(6, 0))
        form.columnconfigure(1, weight=1)
        self.folder = self.field(form, 0, "Music folder", self.settings["folder"])
        ttk.Button(form, text="Browse...", style="Secondary.TButton", command=self.browse,
                   cursor="hand2").grid(row=0, column=2, padx=(8, 0), pady=4)
        self.site = self.field(form, 1, "Site address", self.settings["site"])
        self.token = self.field(form, 2, "Import token", self.settings["token"], secret=True)

        # Syncing.
        sync_card = card(body, "Sync")
        sync_card.pack(**gap)
        self.auto = tk.BooleanVar(value=self.settings["auto"])
        ttk.Checkbutton(sync_card, text="Update automatically when files change", variable=self.auto,
                        command=self.changed_auto, cursor="hand2").pack(anchor="w", pady=(6, 0))
        self.at_startup = tk.BooleanVar(value=os.name == "nt" and os.path.exists(startup_file()))
        if os.name == "nt":
            ttk.Checkbutton(sync_card, text="Start with Windows (minimised, so automatic updates keep going)",
                            variable=self.at_startup, command=self.changed_startup, cursor="hand2").pack(anchor="w")
        buttons = ttk.Frame(sync_card, style="Card.TFrame", borderwidth=0)
        buttons.pack(fill="x", pady=(10, 4))
        self.sync_button = ttk.Button(buttons, text="Sync now", command=self.sync_now, cursor="hand2")
        self.sync_button.pack(side="left")
        ttk.Button(buttons, text="Songs...", style="Secondary.TButton", command=self.open_songs,
                   cursor="hand2").pack(side="left", padx=(8, 0))
        ttk.Button(buttons, text="Fix 'check' rows", style="Secondary.TButton", command=self.open_plans,
                   cursor="hand2").pack(side="left", padx=(8, 0))
        self.remove_button = ttk.Button(buttons, text="Remove deleted files...", style="Danger.TButton",
                                        command=self.remove_deleted, state="disabled", cursor="hand2")
        self.remove_button.pack(side="right")
        self.status = ttk.Label(sync_card, text="Not synced yet.", style="Card.TLabel", justify="left", wraplength=740)
        self.status.pack(anchor="w", pady=(8, 0))

        # What happened.
        log_card = card(body, "Activity")
        log_card.pack(fill="both", expand=True)
        frame, self.log = scrolled(log_card, self.theme, "text", height=12, state="disabled", wrap="word",
                                   font=(MONO, 9))
        frame.pack(fill="both", expand=True, pady=(6, 0))

        if minimized:
            root.iconify()
        root.after(200, self.show_messages)
        root.after(1000, self.check_folder)

    def field(self, form, row, label, value, secret=False):
        ttk.Label(form, text=label, style="Card.TLabel").grid(row=row, column=0, sticky="w", padx=(0, 12))
        entry = ttk.Entry(form, show="\u2022" if secret else "")
        entry.insert(0, value)
        entry.grid(row=row, column=1, sticky="ew", pady=4)
        entry.bind("<FocusOut>", lambda _: self.save())
        return entry

    def switch_theme(self):
        choice = self.theme.switch()
        self.theme_button.config(text=THEME_NAMES[choice])
        self.settings["theme"] = choice
        save_settings(self.settings)

    # -- settings -------------------------------------------------------

    def save(self):
        self.settings.update(folder=self.folder.get().strip(), site=self.site.get().strip().rstrip("/"),
                             token=self.token.get().strip(), auto=self.auto.get())
        save_settings(self.settings)

    def ready(self, quiet=False):
        self.save()
        problem = None
        if not os.path.isdir(self.settings["folder"]):
            problem = "Choose your Music folder first."
        elif not self.settings["site"].startswith("https://"):
            problem = "Type the site address, starting with https://"
        elif not self.settings["token"]:
            problem = "Type the import token (the IMPORT_TOKEN secret on the site)."
        if problem and not quiet:
            messagebox.showinfo("Choir site sync", problem)
        return problem is None

    def browse(self):
        chosen = filedialog.askdirectory(initialdir=self.folder.get() or os.path.expanduser("~"))
        if chosen:
            self.folder.delete(0, "end")
            self.folder.insert(0, os.path.normpath(chosen))
            self.save()

    def changed_auto(self):
        self.save()
        if self.auto.get():
            self.say("Automatic updates on: the folder is checked every minute.")
            self.last_seen = None
        else:
            self.say("Automatic updates off. Use Sync now when you want to upload.")

    def changed_startup(self):
        try:
            set_start_with_windows(self.at_startup.get())
        except OSError as error:
            messagebox.showerror("Choir site sync", "Couldn't change the startup setting: " + str(error))

    # -- syncing --------------------------------------------------------

    def sync_now(self):
        if self.ready():
            self.start_sync(remove_deleted=False)

    def remove_deleted(self):
        if not self.ready():
            return
        if messagebox.askyesno("Choir site sync",
                               "Remove from the site every file that's gone from your Music folder "
                               "(or marked skip)?\n\nThe list is in the log above."):
            self.start_sync(remove_deleted=True)

    def start_sync(self, remove_deleted):
        if self.busy:
            return
        self.busy = True
        self.sync_button.config(state="disabled")
        self.remove_button.config(state="disabled")
        self.status.config(text="Syncing...", style="Card.TLabel")
        settings = dict(self.settings)
        threading.Thread(target=self.sync_in_background, args=(settings, remove_deleted), daemon=True).start()

    def sync_in_background(self, settings, remove_deleted):
        self.say("--- Sync started " + datetime.datetime.now().strftime("%a %d %b %H:%M") + " ---")
        try:
            # The folder as it was when the sync started (so anything added
            # during the sync is picked up next time), and the spreadsheets as
            # the scans left them (so their rewriting doesn't count as a change).
            folder_before = folder_snapshot(settings["folder"])
            summary = sync(settings, self.say, remove_deleted)
            summary["snapshot"] = folder_before + spreadsheets_snapshot() if summary["worked"] else None
        except Exception as error:  # keep the app running whatever happens
            self.say("Something went wrong: " + repr(error))
            summary = {"worked": False, "checks": 0, "removed": 0, "snapshot": None}
        self.messages.put(("done", summary))

    def finished(self, summary):
        self.busy = False
        self.sync_button.config(state="normal")
        self.remove_button.config(state="normal" if summary["removed"] else "disabled")
        # A failed sync (site unreachable, say) is tried again in 15 minutes,
        # if automatic updates are on.
        self.last_synced = summary["snapshot"]
        self.retry_at = None if summary["worked"] else datetime.datetime.now() + datetime.timedelta(minutes=15)
        when = datetime.datetime.now().strftime("%H:%M")
        lines = ["Last sync " + when + (": done." if summary["worked"] else ": had problems (see the log). Automatic updates retry in 15 minutes.")]
        if summary["checks"]:
            lines.append("{} {} marked 'check' and weren't uploaded. Use Songs... or Fix 'check' rows.".format(
                summary["checks"], "row is" if summary["checks"] == 1 else "rows are"))
        if summary["removed"]:
            lines.append("{} file{} gone from your folder but still on the site. "
                         "Click Remove deleted files to take {} off.".format(
                             summary["removed"], " is" if summary["removed"] == 1 else "s are",
                             "it" if summary["removed"] == 1 else "them"))
        self.status.config(text="\n".join(lines), style="Card.TLabel" if summary["worked"] else "Problem.Card.TLabel")
        self.say(lines[0])

    def check_folder(self):
        """Every minute: if automatic updates are on and the folder changed, then settled, sync."""
        try:
            if self.auto.get() and not self.busy and self.ready(quiet=True):
                now = snapshot(self.settings["folder"])
                # Sync only once the folder looks the same two checks running,
                # so a file still being copied in isn't sent half-done.
                waiting = self.retry_at is not None and datetime.datetime.now() < self.retry_at
                if now != self.last_synced and now == self.last_seen and not waiting:
                    self.start_sync(remove_deleted=False)
                self.last_seen = now
        finally:
            self.root.after(CHECK_EVERY * 1000, self.check_folder)

    def open_songs(self):
        if not os.path.exists(SONG_LIST):
            messagebox.showinfo("Choir site sync", "There's no song_list.csv yet. Do the first music import by hand "
                                                   "(see README), then add songs here.")
            return
        SongsWindow(self)

    def open_plans(self):
        opened = False
        for path in (MUSIC_PLAN, SLIDES_PLAN):
            if os.path.exists(path):
                opened = True
                if os.name == "nt":
                    os.startfile(path)
                else:
                    subprocess.Popen(["xdg-open" if sys.platform != "darwin" else "open", path])
        if not opened:
            messagebox.showinfo("Choir site sync", "No spreadsheets yet. Sync once first.")

    # -- the log --------------------------------------------------------

    def say(self, line):
        """Safe to call from the sync thread: the window shows it shortly."""
        self.messages.put(("line", line))

    def show_messages(self):
        try:
            while True:
                kind, value = self.messages.get_nowait()
                if kind == "done":
                    self.finished(value)
                    continue
                self.log.config(state="normal")
                self.log.insert("end", value + "\n")
                # Keep the log from growing forever.
                if int(self.log.index("end").split(".")[0]) > 5000:
                    self.log.delete("1.0", "1000.0")
                self.log.see("end")
                self.log.config(state="disabled")
        except queue.Empty:
            pass
        self.root.after(200, self.show_messages)


class SongsWindow:
    """
    Add songs to song_list.csv, or sort out titles the scan didn't know,
    without opening Excel. The next sync uploads their files.
    """

    def __init__(self, app):
        self.app = app
        self.window = tk.Toplevel(app.root)
        self.window.title("Songs")
        self.window.minsize(900, 640)
        self.window.geometry("1000x820")
        theme = app.theme
        theme.add(self.window, "window")
        header(self.window, theme, "Songs", "Add songs to song_list.csv without opening Excel")
        body = ttk.Frame(self.window, padding=(18, 6, 18, 18))
        body.pack(fill="both", expand=True)

        self.message = ttk.Label(body, text="", style="Good.TLabel",
                                 justify="left", wraplength=900)
        self.message.pack(side="bottom", anchor="w", pady=(10, 0))
        new = card(body, "Add a new song")
        new.pack(fill="x", pady=(0, 12))
        form = ttk.Frame(new, style="Card.TFrame", borderwidth=0)
        form.pack(fill="x", pady=(6, 0))
        form.columnconfigure(1, weight=1)
        self.title = self.field(form, 0, "Title")
        self.spellings = self.field(form, 1, "Other spellings", "other ways file names write it, with ; between them")
        self.tags = self.field(form, 3, "Tags", "with commas between them, e.g. Marian, Easter")
        ttk.Button(form, text="Add song", command=self.add_new, cursor="hand2").grid(
            row=5, column=1, sticky="w", pady=(8, 0))

        unknown = card(body, "Titles not on the song list",
                       "Files from your folder that are waiting as 'check' (from the last sync). Click a title "
                       "to see its files, then add it as a new song or link it to the song it really is.")
        unknown.pack(fill="both", expand=True)
        actions = ttk.Frame(unknown, style="Card.TFrame", borderwidth=0)
        actions.pack(side="bottom", fill="x", pady=(10, 0))  # packed first, so it never gets squeezed out
        ttk.Button(actions, text="Add as a new song", command=self.add_picked, cursor="hand2").pack(side="left")
        ttk.Label(actions, text="or it's another spelling of", style="Card.TLabel").pack(side="left", padx=10)
        self.same_as = ttk.Combobox(actions, width=34, font=(FONT, 10))
        self.same_as.pack(side="left")
        self.same_as.bind("<KeyRelease>", lambda _: self.filter_titles())
        ttk.Button(actions, text="Link", style="Secondary.TButton", command=self.link_picked,
                   cursor="hand2").pack(side="left", padx=(8, 0))

        lists = ttk.Frame(unknown, style="Card.TFrame", borderwidth=0)
        lists.pack(fill="both", expand=True, pady=(4, 0))
        frame, self.list = scrolled(lists, theme, "list", height=7, width=34, exportselection=False,
                                    activestyle="none", font=(FONT, 10))
        frame.pack(side="left", fill="both", expand=True)
        self.list.bind("<<ListboxSelect>>", lambda _: self.picked())

        # The picked title's files, and what's in the one picked.
        files = ttk.Frame(lists, style="Card.TFrame", borderwidth=0)
        files.pack(side="left", fill="both", expand=True, padx=(12, 0))
        ttk.Label(files, text="Its files", style="Muted.Card.TLabel").pack(anchor="w")
        frame, self.files = scrolled(files, theme, "list", height=4, exportselection=False,
                                     activestyle="none", font=(FONT, 10))
        frame.pack(fill="x")
        self.files.bind("<<ListboxSelect>>", lambda _: self.show_file())
        self.files.bind("<Double-Button-1>", lambda _: self.open_picked_file(False))
        file_buttons = ttk.Frame(files, style="Card.TFrame", borderwidth=0)
        file_buttons.pack(fill="x", pady=8)
        ttk.Button(file_buttons, text="Open file", style="Secondary.TButton", cursor="hand2",
                   command=lambda: self.open_picked_file(False)).pack(side="left")
        ttk.Button(file_buttons, text="Show in folder", style="Secondary.TButton", cursor="hand2",
                   command=lambda: self.open_picked_file(True)).pack(side="left", padx=(8, 0))
        frame, self.details = scrolled(files, theme, "text", height=8, width=48, wrap="word", state="disabled",
                                       font=(FONT, 10))
        frame.pack(fill="both", expand=True)

        self.refresh()

    def field(self, frame, row, label, hint=None):
        ttk.Label(frame, text=label, style="Card.TLabel").grid(row=row, column=0, sticky="w", padx=(0, 12))
        entry = ttk.Entry(frame)
        entry.grid(row=row, column=1, sticky="ew", pady=(4, 0 if hint else 4))
        if hint:
            ttk.Label(frame, text=hint, style="Muted.Card.TLabel").grid(row=row + 1, column=1, sticky="w")
        return entry

    def refresh(self):
        try:
            rows = read_song_rows()[0]
            self.all_titles = sorted({(song.get("title") or "").strip() for song in rows} - {""}, key=str.lower)
            self.unknown = unknown_titles()
        except SystemExit as error:  # read_csv stops with a message on a file it can't read
            messagebox.showerror("Songs", str(error), parent=self.window)
            self.all_titles, self.unknown = [], []
        self.same_as["values"] = self.all_titles
        self.list.delete(0, "end")
        for title, files in self.unknown:
            self.list.insert("end", "{}   ({} file{})".format(title, len(files), "" if len(files) == 1 else "s"))
        self.files.delete(0, "end")
        self.show_details([], "")
        if not self.unknown:
            self.list.insert("end", "None: every file matches a song on the list.")

    def filter_titles(self):
        typed = match_key(self.same_as.get())
        self.same_as["values"] = [title for title in self.all_titles if typed in match_key(title)]

    def picked_title(self):
        chosen = self.list.curselection()
        if not chosen or not self.unknown:
            messagebox.showinfo("Songs", "Click a title in the list first.", parent=self.window)
            return None
        return self.unknown[chosen[0]][0]

    def picked(self):
        chosen = self.list.curselection()
        if chosen and self.unknown:
            # Suggest the nearest songs on the list, in case it's a misspelling.
            title = self.unknown[chosen[0]][0]
            close = difflib.get_close_matches(title, self.all_titles, n=8, cutoff=0.5)
            self.same_as["values"] = close or self.all_titles
            self.same_as.set(close[0] if close else "")
            self.files.delete(0, "end")
            for row in self.unknown[chosen[0]][1]:
                kind = (row.get("kind") or "").strip()
                self.files.insert("end", os.path.basename(row.get("file") or "") + ("   [" + kind + "]" if kind else ""))
            self.files.selection_set(0)
            self.show_file()

    def picked_file(self):
        title, file = self.list.curselection(), self.files.curselection()
        if not title or not file or not self.unknown:
            return None
        return self.unknown[title[0]][1][file[0]]

    def show_file(self):
        row = self.picked_file()
        if row is None:
            self.show_details([], "")
            return
        lines, words = describe_file(row)
        self.show_details(lines, words)

    def show_details(self, lines, words):
        self.details.config(state="normal")
        self.details.delete("1.0", "end")
        for label, value in lines:
            self.details.insert("end", label + ": ", "label")
            self.details.insert("end", value + "\n")
        if words:
            self.details.insert("end", "\nWords inside:\n", "label")
            self.details.insert("end", words, "words")
        self.details.config(state="disabled")

    def open_picked_file(self, show_in_folder):
        row = self.picked_file()
        if row is None:
            messagebox.showinfo("Songs", "Click a title, then one of its files.", parent=self.window)
            return
        path = row.get("file") or ""
        if not os.path.exists(path):
            messagebox.showinfo("Songs", "That file isn't there any more:\n" + path, parent=self.window)
            return
        try:
            open_file(path, show_in_folder)
        except OSError as error:
            messagebox.showerror("Songs", "Couldn't open it: " + str(error), parent=self.window)

    def done(self, problem, success):
        if problem:
            messagebox.showinfo("Songs", problem, parent=self.window)
            return
        self.message.config(text=success + (" It goes up with the next sync." if self.app.auto.get()
                                            else " Click Sync now to upload its files."))
        self.app.say(success)
        self.refresh()

    def save(self, change):
        """Runs a change to song_list.csv, catching the file being open in Excel."""
        try:
            return change()
        except PermissionError:
            return "song_list.csv is open in Excel. Close it and try again."
        except SystemExit as error:  # read_csv stops with a message on a file it can't read
            return str(error)

    def add_new(self):
        title = self.title.get().strip()
        problem = self.save(lambda: add_song(title, self.spellings.get(), self.tags.get()))
        if not problem:
            for entry in (self.title, self.spellings, self.tags):
                entry.delete(0, "end")
        self.done(problem, 'Added "{}" to song_list.csv.'.format(title))

    def add_picked(self):
        title = self.picked_title()
        if title:
            # The title from the file name, tidied by hand if you like.
            self.title.delete(0, "end")
            self.title.insert(0, title)
            self.message.config(text='Check the title above (fix its spelling if needed, add tags), then click Add song. '
                                     'If you change it, the file name\'s spelling is kept as another spelling.')
            self.spellings.delete(0, "end")
            self.spellings.insert(0, title)
            self.title.focus_set()

    def link_picked(self):
        title = self.picked_title()
        same_as = self.same_as.get().strip()
        if not title:
            return
        if same_as not in self.all_titles:
            messagebox.showinfo("Songs", "Pick the song it belongs to from the list.", parent=self.window)
            return
        problem = self.save(lambda: add_spelling(same_as, title))
        self.done(problem, 'Added "{}" as another spelling of "{}".'.format(title, same_as))


def main():
    root = tk.Tk()
    App(root, minimized="--minimized" in sys.argv)
    root.mainloop()


if __name__ == "__main__":
    main()
