/* Рисунки к заданиям: SVG-графики функций, диаграммы и геометрические чертежи.
   Задание может содержать поле fig — объект-описание рисунка (или массив таких объектов).

   1) График функции на клетчатой сетке:
      { type:'plot', x:[-6,6], y:[-2,8], labels:2,
        fns:[{ f: x => 2*x*x + 4*x + 1, from:-3, to:2, dash:false }],
        pts:[[0,1,'A']],             // точки (подпись необязательна)
        segs:[[x1,y1,x2,y2,true]],   // отрезки, 5-й элемент — пунктир
        xname:'x', yname:'y', h:false }
   2) Столбчатая диаграмма:  { type:'bars', labels:[...], values:[...], ymax, ystep, unit, title }
   3) Линейная диаграмма:     { type:'line', labels:[...], values:[...], ymin, ymax, ystep, unit, title }
   4) Чертёж:                 { type:'geo', w, h, items:[...] }
      элементы: {p:[[x,y],...], open, dash} многоугольник/ломаная; {s:[[x,y],[x,y]], dash} отрезок;
      {c:[cx,cy,r], dash} окружность; {arc:[cx,cy,rx,ry,from,to], dash} дуга эллипса (градусы, против часовой);
      {t:[x,y,'A'], it} подпись; {d:[x,y]} точка; {ra:[x,y,ax,ay,bx,by]} отметка прямого угла;
      {ang:[x,y,ax,ay,bx,by,r]} дуга угла */
(function () {
  const r1 = v => Math.round(v * 10) / 10;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = v => String(v).replace('.', ',').replace('-', '−');

  function plot(o) {
    const [x1, x2] = o.x, [y1, y2] = o.y, u = o.unit || Math.min(34, 330 / (x2 - x1), 300 / (y2 - y1)), pad = 18;
    const W = (x2 - x1) * u + pad * 2, H = (y2 - y1) * u + pad * 2;
    const X = x => r1(pad + (x - x1) * u), Y = y => r1(pad + (y2 - y) * u);
    const lab = o.labels || 2;
    let g = '';
    for (let x = Math.ceil(x1); x <= x2; x++) g += `<line class="fg-grid${x % lab === 0 ? ' b' : ''}" x1="${X(x)}" y1="${Y(y1)}" x2="${X(x)}" y2="${Y(y2)}"/>`;
    for (let y = Math.ceil(y1); y <= y2; y++) g += `<line class="fg-grid${y % lab === 0 ? ' b' : ''}" x1="${X(x1)}" y1="${Y(y)}" x2="${X(x2)}" y2="${Y(y)}"/>`;
    const ax0 = Math.min(Math.max(0, x1), x2), ay0 = Math.min(Math.max(0, y1), y2);
    g += `<line class="fg-axis" x1="${X(x1)}" y1="${Y(ay0)}" x2="${X(x2) + 10}" y2="${Y(ay0)}" marker-end="url(#fgArr)"/>`;
    g += `<line class="fg-axis" x1="${X(ax0)}" y1="${Y(y1)}" x2="${X(ax0)}" y2="${Y(y2) - 10}" marker-end="url(#fgArr)"/>`;
    for (let x = Math.ceil(x1 / lab) * lab; x < x2; x += lab) if (x !== 0) g += `<text class="fg-n" x="${X(x)}" y="${Y(ay0) + 14}" text-anchor="middle">${num(x)}</text>`;
    for (let y = Math.ceil(y1 / lab) * lab; y < y2; y += lab) if (y !== 0) g += `<text class="fg-n" x="${X(ax0) - 5}" y="${Y(y) + 4}" text-anchor="end">${num(y)}</text>`;
    g += `<text class="fg-n" x="${X(ax0) - 5}" y="${Y(ay0) + 14}" text-anchor="end">0</text>`;
    g += `<text class="fg-name" x="${X(x2) + 4}" y="${Y(ay0) - 8}" text-anchor="end">${esc(o.xname || 'x')}</text>`;
    g += `<text class="fg-name" x="${X(ax0) + 9}" y="${Y(y2) + 2}">${esc(o.yname || 'y')}</text>`;
    let c = '';
    (o.fns || []).forEach(fn => {
      const a = fn.from !== undefined ? fn.from : x1, b = fn.to !== undefined ? fn.to : x2, steps = 600;
      let d = '', pen = false;
      for (let k = 0; k <= steps; k++) {
        const x = a + (b - a) * k / steps, y = fn.f(x);
        if (!isFinite(y) || y > y2 + 3 || y < y1 - 3) { pen = false; continue; }
        d += (pen ? 'L' : 'M') + X(x) + ' ' + Y(y); pen = true;
      }
      c += `<path class="fg-curve${fn.dash ? ' dash' : ''}${fn.alt ? ' alt' : ''}" d="${d}"/>`;
      if (fn.name) { const lx = fn.nx !== undefined ? fn.nx : b - 0.3; c += `<text class="fg-fn" x="${X(lx)}" y="${Y(fn.f(lx)) - 8}" text-anchor="middle">${esc(fn.name)}</text>`; }
    });
    (o.segs || []).forEach(s => { c += `<line class="fg-seg${s[4] ? ' dash' : ''}" x1="${X(s[0])}" y1="${Y(s[1])}" x2="${X(s[2])}" y2="${Y(s[3])}"/>`; });
    (o.pts || []).forEach(p => {
      c += `<circle class="fg-pt${p[3] === 'open' ? ' open' : ''}" cx="${X(p[0])}" cy="${Y(p[1])}" r="3.6"/>`;
      if (p[2]) c += `<text class="fg-lbl" x="${X(p[0]) + 7}" y="${Y(p[1]) - 7}">${esc(p[2])}</text>`;
    });
    const id = 'c' + Math.random().toString(36).slice(2, 8);
    return `<svg viewBox="0 0 ${r1(W)} ${r1(H)}" role="img" aria-label="${esc(o.alt || 'График')}">
      <defs><marker id="fgArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="fg-arrow"/></marker>
      <clipPath id="${id}"><rect x="${X(x1)}" y="${Y(y2)}" width="${(x2 - x1) * u}" height="${(y2 - y1) * u}"/></clipPath></defs>
      ${g}<g clip-path="url(#${id})">${c}</g></svg>`;
  }

  function chart(o) {
    const n = o.labels.length, W = 340, H = 220, L = 44, R = 12, T = o.title ? 34 : (o.unit ? 22 : 14), B = 34;
    const ymin = o.ymin || 0, ymax = o.ymax, st = o.ystep;
    const X = i => L + (W - L - R) * (o.type === 'bars' ? (i + 0.5) / n : (n === 1 ? 0.5 : i / (n - 1)));
    const Y = v => T + (H - T - B) * (1 - (v - ymin) / (ymax - ymin));
    let g = o.title ? `<text class="fg-title" x="${W / 2}" y="16" text-anchor="middle">${esc(o.title)}</text>` : '';
    for (let v = ymin; v <= ymax + 1e-9; v += st) g += `<line class="fg-grid b" x1="${L}" y1="${r1(Y(v))}" x2="${W - R}" y2="${r1(Y(v))}"/><text class="fg-n" x="${L - 6}" y="${r1(Y(v)) + 4}" text-anchor="end">${num(+v.toFixed(3))}${o.unit && v === ymax ? '' : ''}</text>`;
    if (o.unit) g += `<text class="fg-n" x="${L - 6}" y="${T - 10}" text-anchor="end">${esc(o.unit)}</text>`;
    g += `<line class="fg-axis" x1="${L}" y1="${r1(Y(ymin))}" x2="${W - R}" y2="${r1(Y(ymin))}"/>`;
    o.labels.forEach((l, i) => { g += `<text class="fg-n" x="${r1(X(i))}" y="${H - B + 16}" text-anchor="middle">${esc(l)}</text>`; });
    if (o.xname) g += `<text class="fg-n" x="${W - R}" y="${H - 2}" text-anchor="end">${esc(o.xname)}</text>`;
    if (o.type === 'bars') {
      const bw = (W - L - R) / n * 0.56;
      o.values.forEach((v, i) => { g += `<rect class="fg-bar" x="${r1(X(i) - bw / 2)}" y="${r1(Y(v))}" width="${r1(bw)}" height="${r1(Y(ymin) - Y(v))}" rx="3"/>`; });
    } else {
      g += `<polyline class="fg-curve" points="${o.values.map((v, i) => r1(X(i)) + ',' + r1(Y(v))).join(' ')}"/>`;
      o.values.forEach((v, i) => { g += `<circle class="fg-pt" cx="${r1(X(i))}" cy="${r1(Y(v))}" r="3.6"/>`; });
    }
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.alt || o.title || 'Диаграмма')}">${g}</svg>`;
  }

  function geo(o) {
    const P = a => a.map(p => r1(p[0]) + ',' + r1(p[1])).join(' ');
    let g = '';
    (o.items || []).forEach(it => {
      const dash = it.dash ? ' dash' : '';
      if (it.p) g += `<${it.open ? 'polyline' : 'polygon'} class="fg-geo${dash}" points="${P(it.p)}"/>`;
      else if (it.s) g += `<line class="fg-geo${dash}${it.thin ? ' thin' : ''}" x1="${it.s[0][0]}" y1="${it.s[0][1]}" x2="${it.s[1][0]}" y2="${it.s[1][1]}"/>`;
      else if (it.c) g += `<circle class="fg-geo${dash}" cx="${it.c[0]}" cy="${it.c[1]}" r="${it.c[2]}"/>`;
      else if (it.arc) {
        const [cx, cy, rx, ry, a, b] = it.arc, rad = t => t * Math.PI / 180;
        const sx = cx + rx * Math.cos(rad(a)), sy = cy - ry * Math.sin(rad(a)), ex = cx + rx * Math.cos(rad(b)), ey = cy - ry * Math.sin(rad(b));
        const large = Math.abs(b - a) > 180 ? 1 : 0, sweep = b > a ? 0 : 1;
        g += `<path class="fg-geo${dash}" d="M${r1(sx)} ${r1(sy)}A${rx} ${ry} 0 ${large} ${sweep} ${r1(ex)} ${r1(ey)}"/>`;
      }
      else if (it.ra) {
        const [x, y, ax, ay, bx, by] = it.ra, s = it.size || 11;
        const n = (dx, dy) => { const l = Math.hypot(dx, dy); return [dx / l * s, dy / l * s]; };
        const [ux, uy] = n(ax - x, ay - y), [vx, vy] = n(bx - x, by - y);
        g += `<polyline class="fg-geo thin" points="${r1(x + ux)},${r1(y + uy)} ${r1(x + ux + vx)},${r1(y + uy + vy)} ${r1(x + vx)},${r1(y + vy)}"/>`;
      }
      else if (it.ang) {
        const [x, y, ax, ay, bx, by, rr] = it.ang, r = rr || 18;
        const a1 = Math.atan2(ay - y, ax - x), a2 = Math.atan2(by - y, bx - x);
        let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        g += `<path class="fg-geo thin" d="M${r1(x + r * Math.cos(a1))} ${r1(y + r * Math.sin(a1))}A${r} ${r} 0 0 ${d > 0 ? 1 : 0} ${r1(x + r * Math.cos(a2))} ${r1(y + r * Math.sin(a2))}"/>`;
      }
      else if (it.d) g += `<circle class="fg-pt" cx="${it.d[0]}" cy="${it.d[1]}" r="3.2"/>`;
      else if (it.t) g += `<text class="${it.it === false ? 'fg-n big' : 'fg-lbl'}" x="${it.t[0]}" y="${it.t[1]}" text-anchor="middle" dominant-baseline="middle">${esc(it.t[2])}</text>`;
    });
    return `<svg viewBox="0 0 ${o.w} ${o.h}" role="img" aria-label="${esc(o.alt || 'Рисунок')}" style="max-width:${o.max || o.w * 1.3}px">${g}</svg>`;
  }

  function one(o) {
    if (!o) return '';
    if (o.type === 'plot') return plot(o);
    if (o.type === 'bars' || o.type === 'line') return chart(o);
    if (o.type === 'geo') return geo(o);
    return '';
  }
  window.FIG = { render: f => (Array.isArray(f) ? f : [f]).map(o => `<div class="fig">${one(o)}</div>`).join('') };
})();
