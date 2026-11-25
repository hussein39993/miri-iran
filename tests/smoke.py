# Browser smoke test (Playwright + Chromium). Run: python tests/smoke.py
import sys, pathlib
from playwright.sync_api import sync_playwright
url = pathlib.Path(__file__).resolve().parent.parent.joinpath('index.html').as_uri()
res = []
def check(name, cond): res.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 390, 'height': 800}); errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None); pg.on('pageerror', lambda e: errs.append(str(e)))
    reqs = []; pg.on('request', lambda r: reqs.append(r.url) if not r.url.startswith('file:') else None)
    pg.goto(url)
    check('home renders 19 service tiles', pg.locator('.tile').count() == 23)
    check('Snapp tile is featured', pg.locator('.tile.feature').count() == 1)
    check('default dir rtl (ar)', pg.evaluate('document.documentElement.dir') == 'rtl')
    check('no horizontal scroll at 390px', pg.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    pg.screenshot(path='/tmp/home_ar_mobile.png', full_page=False)
    pg.select_option('#lang', 'en'); check('English is ltr', pg.evaluate('document.documentElement.dir') == 'ltr')
    pg.goto(url + '#/s/flight'); pg.wait_for_selector('#f_from')
    check('date default is local today', pg.input_value('#f_date') == pg.evaluate("(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()"))
    pg.select_option('#f_to', '0'); pg.click('.step .cta')
    check('same city shows error', 'same city' in pg.inner_text('.step').lower())
    pg.select_option('#f_to', '2'); pg.fill('#f_date', '2020-01-01'); pg.click('.step .cta')
    check('past date shows error', 'later date' in pg.inner_text('.step').lower())
    pg.fill('#f_date', '2030-01-01'); pg.click('.step .cta'); pg.wait_for_selector('.result')
    check('3 results with airline + stops + baggage', pg.locator('.result').count() == 3 and 'Baggage' in pg.inner_text('.result') and 'Departure airport' in pg.inner_text('.result'))
    pg.click('.result .cta'); pg.fill('#f_name', 'Test User'); pg.fill('#f_contact', '+9647700000000'); pg.click('.step .cta')
    check('review step', 'Review your request' in pg.inner_text('.step'))
    pg.click('.step .cta'); check('demo confirmation, not a ticket', 'NOT a ticket' in pg.inner_text('.step') and 'DEMO-BKG-' in pg.inner_text('.step'))
    pg.goto(url + '#/s/cardtransfer'); pg.click('.step .cta'); check('bank + amount required', 'Choose a bank' in pg.inner_text('.step') and 'valid amount' in pg.inner_text('.step'))
    pg.select_option('#f_bank', '1'); pg.fill('#f_amount', '50000'); pg.click('.step .cta'); pg.click('.step .cta')
    check('finance demo confirmation', 'DEMO-FIN-' in pg.inner_text('.step') and 'no money moved' in pg.inner_text('.step'))
    pg.goto(url + '#/s/wallet'); before = pg.inner_text('.wcard'); pg.click('text=Sample deposit request')
    check('wallet balance unchanged after sample request', pg.inner_text('.wcard') == before and pg.locator('main .line').count() >= 4)
    pg.set_viewport_size({'width': 1280, 'height': 800}); pg.goto(url + '#/home'); pg.screenshot(path='/tmp/home_en_desktop.png')
    for l in ['ar', 'fa']:
        pg.select_option('#lang', l); pg.goto(url + '#/s/flight'); check(l + ' flight page has no raw keys', not any(k in pg.inner_text('main') for k in ['err_', 'st_', 'r_dep']))
    check('no console errors', not errs); check('no network requests', not reqs)
    b.close()
bad = [n for n, c in res if not c]; print(len(res) - len(bad), 'passed,', len(bad), 'failed'); sys.exit(1 if bad else 0)
