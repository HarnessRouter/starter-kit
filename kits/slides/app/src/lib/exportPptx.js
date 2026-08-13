// PowerPoint export: real, editable PowerPoint objects — not screenshots of slides.
//
// Text, shapes and tables become native text boxes, autoshapes and tables, so the recipient can
// edit them. Only the things PowerPoint genuinely cannot express (charts, diagrams, gradient
// backgrounds, SVG embeds) become images, and the caller is told exactly which and how many.
//
// The whole mapping hinges on one constant: the stage is 1920×1080 px and a PowerPoint 16:9 slide
// is 13.333×7.5 in, so 1 stage px = 1/144 in and, for type, exactly 0.5 pt. Get that wrong and
// every deck exports looking broken.
//
// pptxgenjs is imported by this module ONLY, so it lands in its own chunk and costs nothing until
// someone actually exports.
import { ROLE_STYLE } from 'reifyui/slides';   // one source of truth — never re-declare it here

const PX_IN = 13.333 / 1920;
const inch = (v) => +((v || 0) * PX_IN).toFixed(4);
const pt = (v) => +((v || 0) / 2).toFixed(2);          // 1920 px == 960 pt

// Deck styles carry CSS colours AND theme variables (a shape defaults to var(--sl-brand), text to
// var(--sl-ink)). Resolve the variable, then let the browser normalise the rest — no colour parser
// to maintain, and named/hsl/rgba all work.
const _cx = document.createElement('canvas').getContext('2d');
function colour(v, theme) {
  if (!v) return null;
  let s = String(v).trim();
  const m = /^var\(\s*--sl-([a-z]+)/.exec(s);
  if (m) s = (theme?.palette || {})[m[1]] || '';
  if (!s || s === 'transparent') return null;
  _cx.fillStyle = '#000';
  _cx.fillStyle = s;                                    // invalid input leaves #000
  const n = _cx.fillStyle;
  if (String(n).startsWith('#')) return { color: n.slice(1).toUpperCase() };
  const p = String(n).match(/[\d.]+/g) || [];
  if (p.length < 3) return null;
  return {
    color: p.slice(0, 3).map((x) => Math.round(+x).toString(16).padStart(2, '0')).join('').toUpperCase(),
    transparency: p[3] != null ? Math.round((1 - parseFloat(p[3])) * 100) : undefined,
  };
}

const family = (stack) => String(stack || '').split(',')[0].replace(/["']/g, '').trim() || undefined;

/** Rasterise SVG markup. data: URLs only — a blob:-sourced SVG containing <foreignObject> taints
 *  the canvas and toDataURL throws; the identical data: URL does not. */
function svgToPng(svgText, w, h, scale = 2) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = Object.assign(document.createElement('canvas'),
                              { width: Math.max(1, w * scale), height: Math.max(1, h * scale) });
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      try { res(c.toDataURL('image/png')); } catch (e) { rej(e); }
    };
    img.onerror = () => rej(new Error('could not rasterise'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  });
}

async function toDataUri(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`image ${r.status}`);
  const b = await r.blob();
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('could not read image'));
    fr.readAsDataURL(b);
  });
}

function frameOf(el) {
  const f = el.frame || {};
  return {
    x: inch(f.x), y: inch(f.y), w: inch(f.w), h: inch(f.h),
    ...(f.rotation ? { rotate: f.rotation } : {}),
  };
}

/** Runs → pptxgenjs TextProps, preserving marks. */
function textProps(el, theme) {
  const c = el.content || {};
  const role = c.role || 'body';
  const base = { ...(ROLE_STYLE[role] || {}), ...(el.style || {}) };
  const col = colour(base.color, theme);
  const common = {
    fontSize: pt(base.fontSize || 30),
    fontFace: family(base.fontFamily),
    ...(col ? { color: col.color, ...(col.transparency ? { transparency: col.transparency } : {}) } : {}),
    // OOXML has a boolean bold, not a weight axis — 500/600/900 all collapse. Wrong weight,
    // never broken layout. Reported to the caller as a note.
    bold: Number(base.fontWeight || 400) >= 600,
    align: base.align || 'left',
    ...(base.letterSpacing ? { charSpacing: pt(parseFloat(base.letterSpacing)) } : {}),
    ...(base.lineHeight ? { lineSpacingMultiple: Number(base.lineHeight) } : {}),
  };
  const upper = String(base.textTransform || '') === 'uppercase';
  const runs = (c.runs || []).filter((r) => r && typeof r.text === 'string');
  return runs.map((r, i) => {
    const marks = r.marks || [];
    const link = marks.find((m) => m && typeof m === 'object' && m.link);
    return {
      text: upper ? r.text.toUpperCase() : r.text,     // OOXML has no text-transform
      options: {
        ...common,
        ...(marks.includes('bold') ? { bold: true } : {}),
        ...(marks.includes('italic') ? { italic: true } : {}),
        ...(marks.includes('underline') ? { underline: { style: 'sng' } } : {}),
        ...(marks.includes('code') ? { fontFace: 'Consolas' } : {}),
        ...(link ? { hyperlink: { url: link.link } } : {}),
        ...(role === 'bullets' ? { bullet: { type: 'bullet' }, breakLine: true } : {}),
        ...(i < runs.length - 1 && role !== 'bullets' ? { breakLine: false } : {}),
      },
    };
  });
}

async function addChart(slide, el, notes) {
  // The canvas renders charts as SVG; getDataURL on an SVG-renderer instance returns SVG, which
  // PowerPoint outside 365 renders as a corrupt image. Spin a second, canvas-renderer instance
  // offscreen purely to get a real PNG.
  const spec = (el.content || {}).spec || (el.content || {}).option;
  if (!spec) return false;
  const echarts = await import('echarts');
  const host = document.createElement('div');
  const f = el.frame || {};
  host.style.cssText = `position:fixed;left:-10000px;width:${f.w || 800}px;height:${f.h || 450}px`;
  document.body.appendChild(host);
  try {
    const inst = echarts.init(host, null, { renderer: 'canvas', devicePixelRatio: 2 });
    inst.setOption(spec, true);
    const data = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: 'transparent' });
    inst.dispose();
    slide.addImage({ data, ...frameOf(el) });
    notes.rasterised.chart += 1;
    return true;
  } finally {
    host.remove();
  }
}

async function addFlowchart(slide, el, notes) {
  const src = (el.content || {}).code || (el.content || {}).text;
  if (!src) return false;
  const mermaid = (await import('mermaid')).default;
  // htmlLabels:false matters — with it on, mermaid emits <foreignObject>, the one shape that
  // rasterises unreliably.
  mermaid.initialize({ startOnLoad: false, theme: 'neutral', htmlLabels: false });
  const { svg } = await mermaid.render(`x${Math.abs(hash(src))}`, src);
  const f = el.frame || {};
  slide.addImage({ data: await svgToPng(svg, f.w || 800, f.h || 450, 2), ...frameOf(el) });
  notes.rasterised.flowchart += 1;
  return true;
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Build and download a .pptx for this deck.
 * @returns {{notes: string[]}} honest counts of anything rasterised or dropped — never a guess.
 */
export async function downloadPptx(deck, resolveSrc, onProgress) {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';                     // 13.333 × 7.5 in
  pptx.title = deck?.meta?.title || 'Slides';

  const theme = deck?.theme || {};
  const notes = { rasterised: { chart: 0, flowchart: 0, embed: 0, background: 0 }, dropped: [], weight: 0 };
  const slides = deck?.slides || [];

  for (let i = 0; i < slides.length; i += 1) {
    const s = slides[i];
    onProgress?.(i + 1, slides.length);
    const slide = pptx.addSlide();

    const bg = colour(s.background?.color, theme);
    if (bg) slide.background = { color: bg.color };
    if (s.notes) slide.addNotes(String(s.notes));

    for (const el of s.elements || []) {
      try {
        if (el.type === 'text') {
          const props = textProps(el, theme);
          if (props.length) {
            const base = { ...(ROLE_STYLE[el.content?.role || 'body'] || {}), ...(el.style || {}) };
            if (Number(base.fontWeight || 400) > 400 && Number(base.fontWeight) !== 700) notes.weight += 1;
            slide.addText(props, {
              ...frameOf(el), valign: 'top', margin: 0, inset: 0, isTextBox: true, fit: 'none',
            });
          }
        } else if (el.type === 'shape') {
          const kind = el.content?.kind || 'rect';
          const fill = colour(el.style?.fill || 'var(--sl-brand)', theme);
          if (kind === 'line' || kind === 'arrow') {
            slide.addShape('line', {
              ...frameOf(el), h: 0,
              line: { ...(fill ? { color: fill.color } : {}), width: 2,
                      endArrowType: kind === 'arrow' ? 'triangle' : 'none' },
            });
          } else {
            const radius = Number(el.style?.radius || 0);
            slide.addShape(kind === 'ellipse' ? 'ellipse' : (radius ? 'roundRect' : 'rect'), {
              ...frameOf(el),
              ...(fill ? { fill: { color: fill.color, ...(fill.transparency ? { transparency: fill.transparency } : {}) } } : {}),
              ...(radius ? { rectRadius: Math.min(0.5, inch(radius)) } : {}),
            });
          }
        } else if (el.type === 'table') {
          const rows = (el.content?.rows || []).map((r) => (r || []).map((cell) => String(cell ?? '')));
          if (rows.length) {
            const head = el.content?.head || rows[0];
            const body = el.content?.head ? rows : rows.slice(1);
            const brand = colour('var(--sl-brand)', theme);
            slide.addTable(
              [head.map((h) => ({ text: String(h), options: { bold: true } })), ...body],
              { ...frameOf(el), fontSize: pt(24), border: { type: 'solid', pt: 1,
                color: brand ? brand.color : 'DDDDDD' },
                // autoPage defaults to TRUE and will silently invent extra slides.
                autoPage: false },
            );
          }
        } else if (el.type === 'image') {
          const src = resolveSrc ? resolveSrc(el.content?.src) : el.content?.src;
          if (src) {
            slide.addImage({
              data: await toDataUri(src), ...frameOf(el),
              ...(el.content?.fit === 'cover'
                ? { sizing: { type: 'cover', w: inch(el.frame?.w), h: inch(el.frame?.h) } } : {}),
              altText: el.content?.alt || '',
            });
          }
        } else if (el.type === 'chart') {
          await addChart(slide, el, notes);
        } else if (el.type === 'flowchart') {
          await addFlowchart(slide, el, notes);
        } else if (el.type === 'embed') {
          const html = el.content?.html || '';
          if (/<svg/i.test(html)) {
            // Every real embed omits the xmlns; without it the raster silently fails.
            const svg = /xmlns=/.test(html) ? html
              : html.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
            const f = el.frame || {};
            slide.addImage({ data: await svgToPng(svg, f.w || 400, f.h || 400, 4), ...frameOf(el) });
            notes.rasterised.embed += 1;
          } else {
            notes.dropped.push('an embedded block that is not an image');
          }
        } else if (el.type === 'code') {
          const props = textProps({ ...el, content: { ...el.content, role: 'body' } }, theme);
          if (props.length) {
            slide.addText(props.map((p) => ({ ...p, options: { ...p.options, fontFace: 'Consolas' } })),
                          { ...frameOf(el), valign: 'top', margin: 0, inset: 0, isTextBox: true, fit: 'none' });
          }
        }
      } catch (e) {
        // One bad element must not lose the whole deck — but it must be reported, not swallowed.
        notes.dropped.push(`${el.type} on slide ${i + 1} (${e.message || 'failed'})`);
      }
    }
  }

  const name = String(deck?.meta?.title || 'slides').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'slides';
  await pptx.writeFile({ fileName: `${name}.pptx` });

  // Only real counts. Nothing here is estimated.
  const out = [];
  const r = notes.rasterised;
  const rast = r.chart + r.flowchart + r.embed + r.background;
  if (rast) {
    const parts = [];
    if (r.chart) parts.push(`${r.chart} chart${r.chart === 1 ? '' : 's'}`);
    if (r.flowchart) parts.push(`${r.flowchart} diagram${r.flowchart === 1 ? '' : 's'}`);
    if (r.embed) parts.push(`${r.embed} embedded graphic${r.embed === 1 ? '' : 's'}`);
    out.push(`${parts.join(', ')} exported as images — PowerPoint cannot represent them as editable objects.`);
  }
  if (notes.weight) {
    out.push(`${notes.weight} text element${notes.weight === 1 ? '' : 's'} use a font weight PowerPoint cannot express; they are bold or regular.`);
  }
  if (notes.dropped.length) out.push(`Could not include: ${notes.dropped.join('; ')}.`);
  return { notes: out };
}
