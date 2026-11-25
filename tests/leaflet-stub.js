// TEST-ONLY minimal stand-in for the Leaflet API surface that js/map.js uses. It is NOT Leaflet and proves nothing about real map rendering.
(function () {
  const reg = m => l => { l.addTo = mm => { mm.layers.push(l); l.map = mm; return l; }; l.remove = () => { if (l.map) l.map.layers.splice(l.map.layers.indexOf(l), 1); }; return l; };
  window.L = {
    map(el) { const m = { _c: { lat: 35.6892, lng: 51.389 }, _z: 12, _h: {}, layers: [], setView(ll, z) { this._c = { lat: ll[0], lng: ll[1] }; this._z = z; (this._h.moveend || []).forEach(f => f()); return this; }, getCenter() { return this._c; }, on(e, f) { (this._h[e] = this._h[e] || []).push(f); return this; }, fitBounds(b) { this.fit = b; return this; }, remove() { this.removed = true; } }; el.classList.add('leaflet-stub'); window.__map = m; return m; },
    tileLayer(u) { window.__tile = u; return { addTo(m) { m.tiles = u; return this; } }; },
    marker(ll, o) { return reg()({ ll, cls: o.icon.cls }); }, divIcon(o) { return { cls: o.className }; },
    polyline(c) { return reg()({ coords: c, line: true }); }, latLngBounds(c) { return c; }
  };
})();
