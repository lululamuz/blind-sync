// Tiny DOM helpers + the BLIND SYNC graphic motif library (inline SVG, no image assets).

// Let screens write `cond ? node : null` inside replaceChildren() like they do inside h().
const nativeReplace = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...kids) {
  return nativeReplace.apply(this, kids.flat(Infinity).filter(k => k != null && k !== false));
};

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function svg(markup, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  const el = t.content.firstElementChild;
  if (cls) el.classList.add(...cls.split(' '));
  return el;
}
export function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
export function toggle(el, cls, on) { el.classList.toggle(cls, !!on); }
export const fmtTime = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- motifs
export const motif = {
  sparkle: (fill = 'var(--lime)') => `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 0 C55 38 62 45 100 50 C62 55 55 62 50 100 C45 62 38 55 0 50 C38 45 45 38 50 0Z" fill="${fill}" stroke="var(--ink)" stroke-width="2.5"/></svg>`,
  star: (fill = 'var(--butter)') => `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 4 L59 33 L89 22 L71 48 L96 66 L65 68 L64 98 L48 74 L24 94 L32 64 L4 56 L31 42 L18 14 L44 30Z" fill="${fill}" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
  flower: (fill = 'var(--fuchsia)') => `<svg viewBox="0 0 100 100" aria-hidden="true"><g stroke="var(--ink)" stroke-width="2.5" fill="${fill}">${[0, 60, 120, 180, 240, 300].map(a => `<ellipse cx="50" cy="26" rx="15" ry="22" transform="rotate(${a} 50 50)"/>`).join('')}</g><circle cx="50" cy="50" r="13" fill="var(--butter)" stroke="var(--ink)" stroke-width="2.5"/></svg>`,
  wave: (stroke = 'var(--ink)') => `<svg viewBox="0 0 200 30" aria-hidden="true" preserveAspectRatio="none"><path d="M0 15 Q12.5 0 25 15 T50 15 T75 15 T100 15 T125 15 T150 15 T175 15 T200 15" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round"/></svg>`,
  arrow: () => `<svg viewBox="0 0 120 60" aria-hidden="true"><path d="M5 40 C30 5 70 5 100 30" fill="none" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round"/><path d="M88 18 L102 31 L84 38" fill="none" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  note: (fill = 'var(--indigo)') => `<svg viewBox="0 0 60 80" aria-hidden="true"><path d="M24 62 V10 L52 4 V50" fill="none" stroke="var(--ink)" stroke-width="3"/><ellipse cx="15" cy="63" rx="12" ry="9" fill="${fill}" stroke="var(--ink)" stroke-width="2.5" transform="rotate(-18 15 63)"/><ellipse cx="43" cy="53" rx="12" ry="9" fill="${fill}" stroke="var(--ink)" stroke-width="2.5" transform="rotate(-18 43 53)"/></svg>`,
  blob: (fill) => `<svg viewBox="0 0 200 200" aria-hidden="true"><path d="M43 -58C55 -45 62 -28 66 -9C70 10 70 30 60 45C50 60 30 71 8 73C-14 75 -38 68 -54 53C-70 38 -78 15 -75 -6C-72 -27 -58 -46 -41 -59C-24 -72 -2 -79 16 -76C34 -73 31 -71 43 -58Z" transform="translate(100 100)" fill="${fill}" stroke="var(--ink)" stroke-width="2"/></svg>`,
  burst: (fill = 'var(--lime)') => {
    const pts = []; for (let i = 0; i < 28; i++) { const r = i % 2 ? 38 : 50, a = (i / 28) * Math.PI * 2; pts.push(`${50 + r * Math.cos(a)},${50 + r * Math.sin(a)}`); }
    return `<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="${pts.join(' ')}" fill="${fill}" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/></svg>`;
  },
  speaker: on => `<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>${on ? '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>' : '<path d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>`,
  play: () => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>`,
  pause: () => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z" fill="currentColor"/></svg>`,
};
export const reactionGlyph = { heart: '♥', spark: '✦', fire: '✺', wow: '!!' };
export const reactionLabel = { heart: 'Love', spark: 'Sparkle', fire: 'On fire', wow: 'Wow' };

/** Floating decorative sticker */
export function deco(kind, { x, y, size = 48, rot = 0, fill, cls = '' } = {}) {
  const el = svg(motif[kind](fill), `deco ${cls}`);
  Object.assign(el.style, { left: x, top: y, width: size + 'px', height: size + 'px', '--rot': rot + 'deg' });
  return el;
}

let toastWrap;
export function toast(msg, kind = 'info') {
  if (!toastWrap) { toastWrap = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastWrap); }
  const t = h('div', { class: `toast toast-${kind}` }, msg);
  toastWrap.append(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

/** Non-native confirm dialog. Resolves true/false. */
export function confirmDialog({ title, body, yes = 'Leave', no = 'Stay' }) {
  return new Promise(resolve => {
    const d = h('dialog', { class: 'dialog sticker-card' },
      h('h3', {}, title), h('p', {}, body),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn btn-ghost', onclick: () => close(false) }, no),
        h('button', { class: 'btn btn-fuchsia', onclick: () => close(true) }, yes)));
    function close(v) { d.close(); d.remove(); resolve(v); }
    d.addEventListener('cancel', e => { e.preventDefault(); close(false); });
    document.body.append(d);
    d.showModal();
  });
}

export async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); toast(`${label} copied`); }
  catch { toast(`Copy failed — select and copy: ${text}`, 'warn'); }
}

export function download(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const slug = s => (s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
