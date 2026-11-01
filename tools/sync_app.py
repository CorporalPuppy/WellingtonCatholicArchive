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
from tkinter import filedialog, messagebox, scrolledtext, ttk

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
        root.minsize(620, 460)
        pad = {"padx": 8, "pady": 4}

        form = tk.Frame(root)
        form.pack(fill="x", **pad)
        form.columnconfigure(1, weight=1)
        self.folder = self.field(form, 0, "Music folder", self.settings["folder"])
        tk.Button(form, text="Browse...", command=self.browse).grid(row=0, column=2, **pad)
        self.site = self.field(form, 1, "Site address", self.settings["site"])
        self.token = self.field(form, 2, "Import token", self.settings["token"], secret=True)

        options = tk.Frame(root)
        options.pack(fill="x", **pad)
        self.auto = tk.BooleanVar(value=self.settings["auto"])
        tk.Checkbutton(options, text="Update automatically when files change", variable=self.auto,
                       command=self.changed_auto).pack(side="left")
        self.at_startup = tk.BooleanVar(value=os.name == "nt" and os.path.exists(startup_file()))
        if os.name == "nt":
            tk.Checkbutton(options, text="Start with Windows", variable=self.at_startup,
                           command=self.changed_startup).pack(side="left", padx=16)

        buttons = tk.Frame(root)
        buttons.pack(fill="x", **pad)
        self.sync_button = tk.Button(buttons, text="Sync now", width=14, command=self.sync_now)
        self.sync_button.pack(side="left")
        tk.Button(buttons, text="Songs...", command=self.open_songs).pack(side="left", padx=6)
        tk.Button(buttons, text="Fix 'check' rows", command=self.open_plans).pack(side="left")
        self.remove_button = tk.Button(buttons, text="Remove deleted files...", command=self.remove_deleted,
                                       state="disabled")
        self.remove_button.pack(side="left", padx=6)

        self.status = tk.Label(root, anchor="w", justify="left", text="Not synced yet.")
        self.status.pack(fill="x", **pad)
        self.log = scrolledtext.ScrolledText(root, height=16, state="disabled", font=("Consolas", 9))
        self.log.pack(fill="both", expand=True, **pad)

        if minimized:
            root.iconify()
        root.after(200, self.show_messages)
        root.after(1000, self.check_folder)

    def field(self, form, row, label, value, secret=False):
        tk.Label(form, text=label).grid(row=row, column=0, sticky="w")
        entry = tk.Entry(form, show="*" if secret else "")
        entry.insert(0, value)
        entry.grid(row=row, column=1, sticky="ew", padx=8, pady=2)
        entry.bind("<FocusOut>", lambda _: self.save())
        return entry

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
        self.status.config(text="Syncing...")
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
            lines.append("{} rows are marked 'check' and weren't uploaded. Click Fix 'check' rows.".format(summary["checks"]))
        if summary["removed"]:
            lines.append("{} files are gone from your folder but still on the site. "
                         "Click Remove deleted files to take them off.".format(summary["removed"]))
        self.status.config(text="\n".join(lines))
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
        self.window.minsize(860, 600)
        pad = {"padx": 8, "pady": 4}

        new = tk.LabelFrame(self.window, text="Add a new song")
        new.pack(fill="x", **pad)
        new.columnconfigure(1, weight=1)
        self.title = self.field(new, 0, "Title")
        self.spellings = self.field(new, 1, "Other spellings")
        tk.Label(new, text="other ways file names write it, with ; between them", fg="gray").grid(
            row=2, column=1, sticky="w", padx=8)
        self.tags = self.field(new, 3, "Tags")
        tk.Label(new, text="with commas between them, e.g. Marian, Easter", fg="gray").grid(
            row=4, column=1, sticky="w", padx=8)
        tk.Button(new, text="Add song", width=14, command=self.add_new).grid(row=5, column=1, sticky="w", padx=8, pady=6)

        unknown = tk.LabelFrame(self.window, text="Titles in your folder that aren't on the song list (from the last sync)")
        unknown.pack(fill="both", expand=True, **pad)
        lists = tk.Frame(unknown)
        lists.pack(fill="both", expand=True, padx=8, pady=4)
        self.list = tk.Listbox(lists, height=10, width=36, exportselection=False)
        self.list.pack(side="left", fill="both", expand=True)
        self.list.bind("<<ListboxSelect>>", lambda _: self.picked())

        # The picked title's files, and what's in the one picked.
        files = tk.Frame(lists)
        files.pack(side="left", fill="both", expand=True, padx=(8, 0))
        tk.Label(files, text="Its files:", anchor="w").pack(fill="x")
        self.files = tk.Listbox(files, height=4, exportselection=False)
        self.files.pack(fill="x")
        self.files.bind("<<ListboxSelect>>", lambda _: self.show_file())
        self.files.bind("<Double-Button-1>", lambda _: self.open_picked_file(False))
        file_buttons = tk.Frame(files)
        file_buttons.pack(fill="x", pady=4)
        tk.Button(file_buttons, text="Open file", command=lambda: self.open_picked_file(False)).pack(side="left")
        tk.Button(file_buttons, text="Show in folder", command=lambda: self.open_picked_file(True)).pack(side="left", padx=6)
        self.details = scrolledtext.ScrolledText(files, height=12, width=48, wrap="word", state="disabled",
                                                 font=("Segoe UI", 9))
        self.details.pack(fill="both", expand=True)
        actions = tk.Frame(unknown)
        actions.pack(fill="x", padx=8, pady=4)
        tk.Button(actions, text="Add as a new song", command=self.add_picked).pack(side="left")
        tk.Label(actions, text="  or it's another spelling of").pack(side="left")
        self.same_as = ttk.Combobox(actions, width=32)
        self.same_as.pack(side="left", padx=4)
        self.same_as.bind("<KeyRelease>", lambda _: self.filter_titles())
        tk.Button(actions, text="Link", command=self.link_picked).pack(side="left")

        self.message = tk.Label(self.window, anchor="w", justify="left", fg="darkgreen")
        self.message.pack(fill="x", **pad)
        self.refresh()

    def field(self, frame, row, label):
        tk.Label(frame, text=label).grid(row=row, column=0, sticky="w", padx=8)
        entry = tk.Entry(frame)
        entry.grid(row=row, column=1, sticky="ew", padx=8, pady=2)
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
            self.details.insert("end", words)
        self.details.tag_config("label", font=("Segoe UI", 9, "bold"))
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
