# Legacy scripts

`historian.py` is the original (v1) Battery Historian: a Python 2 script that
renders a standalone HTML chart from a bug report. It was retired from the
serving path in 2026 — the v2 timeline (and its replacement React UI) covers
everything it did, and requiring Python 2 just to render a chart was the last
Python 2 dependency in the project.

The script is kept here for reference. It is NOT invoked by the server and is
NOT ported to Python 3.

The kernel trace converter (`scripts/kernel_trace.py`) is still live — it was
ported to Python 3.
