"""Remove registration, confirmation and payment details from the site's data files.
The Google Sheet keeps everything; only the copies the website serves are cleaned.
Usage: python3 scripts/sanitize.py data   (also run automatically by xlsx2csv.py)"""
import csv, re, sys, os

DROP_COLS = {"racelist.csv": ["Registration / Confirmation #", "Cost", "Notes"]}
# rows (any tab) whose text matches these are dropped; ref numbers and amounts are redacted elsewhere
SENSITIVE = re.compile(r"\bref\s+[A-Z]{2,}\d{5,}|\bCTG\d+|\bconfirmation\s*(#|no|number)|\$\s?\d|\bpaid\b|\bbib\s*#?\s*\d", re.I)
REDACT = [(re.compile(r"\(?\bref\s+[A-Z]{2,}\d{5,}\)?", re.I), ""), (re.compile(r"\$\s?\d[\d,]*(\.\d+)?"), "")]

def clean(path):
    name = os.path.basename(path)
    with open(path, encoding="utf-8") as fh:
        rows = list(csv.reader(fh))
    if name in DROP_COLS:
        h = next(i for i, r in enumerate(rows) if r and r[0] == "Date")
        drop = {i for i, c in enumerate(rows[h]) if c in DROP_COLS[name]}
        rows = [[c for i, c in enumerate(r) if i not in drop] if k >= h else r for k, r in enumerate(rows)]
    if name == "racelist.csv":  # sold-out races you never entered aren't shown on the site
        h = next(i for i, r in enumerate(rows) if r and r[0] == "Date")
        st = rows[h].index("Status")
        rows = [r for k, r in enumerate(rows) if k <= h or not (len(r) > st and re.search(r"sold out", r[st], re.I))]
    out = []
    for r in rows:
        if name == "summary.csv" and any(SENSITIVE.search(c) for c in r):
            continue  # Summary rows are free text; drop the whole row
        r2 = []
        for c in r:
            for pat, rep in REDACT:
                c = pat.sub(rep, c)
            r2.append(c)
        out.append(r2)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        csv.writer(fh, lineterminator="\n").writerows(out)

if __name__ == "__main__":
    d = sys.argv[1] if len(sys.argv) > 1 else "data"
    for f in sorted(os.listdir(d)):
        if f.endswith(".csv"):
            clean(os.path.join(d, f))
    print("sanitized", d)
