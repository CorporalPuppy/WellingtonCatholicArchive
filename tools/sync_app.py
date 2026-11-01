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

Settings (Music folder, site address, import token) are saved in
sync_settings.json next to your spreadsheets. It holds the import token, so
keep it to yourself; it's left out of git.

Only Python's built-in libraries are used, so there is nothing to install.
"""

import datetime
import hashlib
import json
import os
import queue
import re
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext

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
        tk.Button(buttons, text="Fix 'check' rows", command=self.open_plans).pack(side="left", padx=6)
        self.remove_button = tk.Button(buttons, text="Remove deleted files...", command=self.remove_deleted,
                                       state="disabled")
        self.remove_button.pack(side="left")

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


def main():
    root = tk.Tk()
    App(root, minimized="--minimized" in sys.argv)
    root.mainloop()


if __name__ == "__main__":
    main()
