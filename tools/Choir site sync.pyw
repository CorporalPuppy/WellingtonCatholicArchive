# Double-click this to open the sync app without a console window.
# The app itself is sync_app.py, in this same folder.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sync_app  # noqa: E402

sync_app.main()
