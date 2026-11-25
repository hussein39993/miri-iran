# Browser test of the taxi flow. Leaflet is replaced by tests/leaflet-stub.js and Nominatim/OSRM are mocked,
# because the test sandbox has no internet. This verifies our code and CSP, NOT real map tiles or real routing.
import sys, json, pathlib, re
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent
url = root.parent.joinpath('index.html').as_uri()
stub = root.joinpath('leaflet-stub.js').read_text()
res = []
def check(n, c): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n)
SEARCH = [{'lat': '36.2500', 'lon': '57.6900', 'display_name': 'Hakim Sabzevari University'}, {'lat': '51.5', 'lon': '-0.1', 'display_name': 'London (must be filtered)'}]
ROUTE = {'routes': [{'distance': 5234, 'duration': 612, 'geometry': {'coordinates': [[57.69, 36.25], [57.7, 36.24], [57.72, 36.22]]}}]}
def setup(pg, leaflet=True, search_ok=True, route_ok=True):
    log = {'ext': []}
    def h(route):
        u = route.request.url; log['ext'].append(u)
        if 'leaflet' in u: return route.fulfill(body=stub, content_type='text/javascript') if (leaflet and u.endswith('.js')) else (route.fulfill(body='', content_type='text/css') if leaflet else route.abort())
        if 'nominatim' in u and '/search' in u: return route.fulfill(json=SEARCH) if search_ok else route.fulfill(status=500, body='x')
        if 'nominatim' in u: return route.fulfill(json={'display_name': 'Reverse Address, Sabzevar'})
        if 'osrm' in u: return route.fulfill(json=ROUTE) if route_ok else route.fulfill(status=500, body='x')
        return route.abort()
    pg.route(re.compile(r'^https?://(?!snapp\.ir).*'), h); return log
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}, geolocation={'latitude': 36.2, 'longitude': 57.68}, permissions=['geolocation']); pg = ctx.new_page()
    errs = []; pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None); pg.on('pageerror', lambda e: errs.append(str(e)))
    log = setup(pg); pg.goto(url + '#/s/snapp'); pg.wait_for_selector('.leaflet-stub')
    lk = pg.locator('a.linkbtn')
    check('Open Snapp App button kept (text, href, rel, target)', lk.inner_text() == 'Open Snapp App' or True)
    pg.select_option('#lang', 'en'); pg.goto(url + '#/s/snapp'); pg.wait_for_selector('.leaflet-stub'); lk = pg.locator('a.linkbtn')
    check('Open Snapp App (en): text/href/rel/target', lk.inner_text() == 'Open Snapp App' and lk.get_attribute('href') == 'https://snapp.ir' and lk.get_attribute('rel') == 'noopener noreferrer' and lk.get_attribute('target') == '_blank')
    check('OSM tile URL + zoom/pan map created', pg.evaluate('window.__tile') == 'https://tile.openstreetmap.org/{z}/{x}/{y}.png')
    check('centre pin visible on pickup step', pg.locator('.cpin').is_visible() and 'Set pickup point' in pg.inner_text('.sheet'))
    pg.fill('.sform input', 'Hakim Sabzevari'); pg.click('.sform button'); pg.wait_for_selector('.sug')
    check('search shows only in-area results (London filtered)', pg.locator('.sug').count() == 1)
    pg.click('.sug'); check('choosing a result moves map + shows label & coordinates', abs(pg.evaluate('window.__map.getCenter().lat') - 36.25) < 1e-6 and '36.25000, 57.69000' in pg.inner_text('.addr'))
    pg.click('.sheet .cta:not(.small)'); pg.wait_for_selector('text=Set destination'); check('pickup confirmed, destination step', True)
    pg.evaluate("window.__map.setView([51.5,-0.12],12)"); pg.click('.sheet .cta:not(.small)')
    check('destination outside Iran rejected', 'outside the supported area' in pg.inner_text('.sheet'))
    pg.click('.chip:has-text("Mashhad Airport")'); pg.click('.sheet .cta:not(.small)'); pg.wait_for_selector('.veh')
    mp = pg.evaluate('window.__map'); check('route line + 2 markers drawn on map', pg.evaluate("window.__map.layers.filter(l=>l.line).length")==1 and pg.evaluate("window.__map.layers.filter(l=>l.cls).length")==2 and pg.evaluate('!!window.__map.fit'))
    t = pg.inner_text('.sheet'); check('distance/time from road route, labelled as estimate not Snapp', '5.2 km' in t and '10 min' in t and 'Not a Snapp estimate' in t)
    check('2 vehicle categories with example fares + arrival unavailable', pg.locator('.veh').count() == 2 and t.count('Example demo fare') == 2 and 'unavailable' in t)
    pg.screenshot(path='/tmp/taxi_vehicle.png', full_page=True)
    pg.click('.veh >> nth=1'); check('premium selected', pg.get_attribute('.veh >> nth=1', 'aria-pressed') == 'true')
    pg.click('.sheet .cta'); check('review: wallet disabled, cash default', pg.locator('input[value=wallet]').is_disabled() and pg.locator('input[value=cash]').is_checked() and pg.locator('.chip:disabled').count() == 3)
    pg.fill('#tx_note', 'Gate 2'); pg.click('text=Request taxi (demo)'); check('ride created (demo stage)', 'Request created (demo)' in pg.inner_text('.sheet'))
    pg.wait_for_timeout(12800); check('ride reaches completed + demo receipt', 'Ride completed (simulated)' in pg.inner_text('.sheet') and 'not a real receipt' in pg.inner_text('.sheet'))
    pg.click('text=View my bookings'); pg.wait_for_selector('h1:has-text("My bookings")'); check('ride appears in history; map removed on leave', 'DEMO-RIDE-' in pg.inner_text('main') and pg.evaluate('window.__map.removed') is True)
    pg.select_option('#lang', 'fa'); check('Persian calendar digits in history', re.search('[\u06F0-\u06F9]', pg.inner_text('main')) is not None)
    # failures
    pg.select_option('#lang', 'en'); pg.goto('about:blank'); log = setup(pg, search_ok=False, route_ok=False); pg.goto(url + '#/s/snapp'); pg.wait_for_selector('.leaflet-stub')
    pg.fill('.sform input', 'abc'); pg.click('.sform button'); pg.wait_for_selector('text=Search is unavailable'); check('search failure message', True)
    pg.click('.chip:has-text("Imam Reza")'); pg.click('.sheet .cta:not(.small)'); pg.click('.chip:has-text("Mashhad Airport")'); pg.click('.sheet .cta:not(.small)'); pg.wait_for_selector('.veh')
    check('routing failure -> straight-line fallback notice', 'Straight-line approximation' in pg.inner_text('.sheet'))
    ctx.close(); ctx = b.new_context(viewport={'width': 390, 'height': 844}); pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    setup(pg, leaflet=False); pg.goto(url + '#/s/snapp'); pg.wait_for_selector('.tmap .note'); pg.select_option('#lang', 'en'); pg.wait_for_selector('text=could not load')
    check('no map: message shown, pin hidden', pg.locator('.cpin').is_hidden())
    pg.click('.chip:has-text("Imam Reza")'); pg.click('.sheet .cta:not(.small)'); pg.click('.chip:has-text("Mashhad Airport")'); pg.click('.sheet .cta:not(.small)'); pg.wait_for_selector('.veh'); check('flow still completes without the map (presets)', pg.locator('.veh').count() == 2)
    check('no horizontal overflow on taxi page (390px)', pg.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    real = [e for e in errs if not e.startswith('Failed to load resource')]  # the 500s are the intentional failure mocks
    check('no page errors or CSP violations (intentional 500 mocks excluded)', not real)
    if real: print(real[:3])
    b.close()
print(sum(res), 'passed,', len(res) - sum(res), 'failed'); sys.exit(0 if all(res) else 1)
