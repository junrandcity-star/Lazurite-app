"""Draw the LINE rich menu images (2500x843, 4 buttons) for the 5 languages with headless Chrome (proper Thai/Nepali shaping)."""
import pathlib, sys
from playwright.sync_api import sync_playwright
out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
LABELS = {
    'ja': ['本日', '予定', 'ガイド', 'お給料'],
    'en': ['Today', 'Schedule', 'Guide', 'Pay'],
    'th': ['งานวันนี้', 'ตารางงาน', 'คู่มือ', 'ค่าจ้าง'],
    'ne': ['आजको काम', 'तालिका', 'निर्देशिका', 'तलब'],
    'vi': ['Hôm nay', 'Lịch', 'Hướng dẫn', 'Tiền lương'],
}
ICONS = [  # today, calendar, book, yen (same pictures as the app's tabs)
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M8 7h7M8 11h7"/>',
    '<path d="M6 3l6 8 6-8"/><path d="M12 11v10M7 13h10M7 17h10"/>',
]
COLORS = ['#c2410c', '#1d4f91', '#1d4f91', '#1d4f91']
page = """<!doctype html><html><head><meta charset=utf-8><style>
html,body{margin:0;width:2500px;height:843px;background:#fff;font-family:'Noto Sans CJK JP','Poppins','Loma','DejaVu Sans',sans-serif}
.g{display:grid;grid-template-columns:repeat(4,1fr);height:843px}
.b{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px;border-right:6px solid #e3e8ef;background:#f6f8fb}
.b:last-child{border-right:0}
.i{width:300px;height:300px;border-radius:70px;display:grid;place-items:center;color:#fff}
.i svg{width:190px;height:190px}
.t{font-size:112px;font-weight:700;color:#18202c;text-align:center;line-height:1.15;padding:0 30px}
</style></head><body><div class=g>%s</div></body></html>"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 2500, 'height': 843})
    for lang, labels in LABELS.items():
        cells = ''.join(f'<div class=b><div class=i style="background:{COLORS[i]}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{ICONS[i]}</svg></div><div class=t>{labels[i]}</div></div>' for i in range(4))
        pg.set_content(page % cells); pg.wait_for_timeout(200)
        f = out / f'richmenu-{lang}.png'
        pg.screenshot(path=str(f), clip={'x': 0, 'y': 0, 'width': 2500, 'height': 843})
        print(lang, f.stat().st_size)
    b.close()
