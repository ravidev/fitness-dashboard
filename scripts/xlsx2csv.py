import openpyxl, csv, re, datetime, sys
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
OUT = sys.argv[2]
TABS = {'Summary':'summary','Workouts':'workouts','DailyStats':'dailystats','Food Log (items)':'foodlog','Sleep':'sleep',
        'Naps':'naps','racelist':'racelist','Google Health':'google-health','Mohana Plan':'mohana-plan','Health Historical Daily':'health-daily'}
def fmt(c):
    v, f = c.value, c.number_format or 'General'
    if v is None: return ''
    if isinstance(v, datetime.datetime):
        if v.year < 1901:  # pure time stored as datetime on 1899-12-30
            return v.strftime('%-I:%M %p')
        if 'mmm d, yyyy' in f: return v.strftime('%b %-d, %Y')
        if 'ddd mmm d' in f: return v.strftime('%a %b %-d')
        return v.strftime('%Y-%m-%d')
    if isinstance(v, datetime.time): return v.strftime('%-I:%M %p')
    if isinstance(v, datetime.date): return v.isoformat()
    if isinstance(v, bool): return str(v).upper()
    if isinstance(v, (int, float)):
        suffix = ''.join(re.findall(r'"([^"]*)"', f))
        core = re.sub(r'"[^"]*"', '', f)
        dec = len(core.split('.')[1].rstrip('#').replace('%','')) if '.' in core else None
        if 'General' in core or dec is None and '0' not in core:
            s = str(int(v)) if float(v).is_integer() else ('%.4f' % v).rstrip('0').rstrip('.')
        else:
            d = dec or 0
            s = f'{v:,.{d}f}' if ',' in core else f'{v:.{d}f}'
        return s + suffix
    return str(v)
for name, slug in TABS.items():
    if name not in wb.sheetnames: print('missing', name); continue
    ws = wb[name]
    rows = [[fmt(c) for c in r] for r in ws.iter_rows()]
    while rows and not any(rows[-1]): rows.pop()
    w = max((max((i+1 for i,x in enumerate(r) if x), default=0) for r in rows), default=0)
    with open(f'{OUT}/{slug}.csv', 'w', newline='', encoding='utf-8') as fh:
        csv.writer(fh, lineterminator='\n').writerows([r[:w] for r in rows])
    print(f'{slug}: {len(rows)} rows')
