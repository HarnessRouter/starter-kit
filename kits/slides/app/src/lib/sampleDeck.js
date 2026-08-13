// sampleDeckFor — a small deterministic showcase deck for the template
// preview modal. The THEME is the template's real theme (this is exactly how
// a deck created from it will look); the copy is illustrative placeholder the
// copilot replaces with the user's content. Rendered by the same SlideView as
// the editor/presentation, so the preview is honest.

function el(type, frame, content, style = {}) {
  return { id: `${type}_${frame.x}_${frame.y}`, type, frame: { rotation: 0, ...frame }, style, content };
}

const text = (frame, role, lines, style = {}) =>
  el('text', frame, { role, runs: lines.map((t) => ({ text: t })) }, style);

export function sampleDeckFor(detail) {
  const theme = detail.theme || {};
  const p = theme.palette || {};
  const brand = p.brand || '#4F46E5';
  const accent = p.accent || '#06B6D4';
  const bg = p.bg || '#FFFFFF';
  const surface = p.surface || '#F7F8FB';

  const cover = {
    id: 'slide_cover', layout: 'title',
    background: { gradient: `linear-gradient(135deg, ${bg}, ${surface})` },
    notes: '', elements: [
      el('shape', { x: 260, y: 388, w: 150, h: 8 }, { kind: 'rect' }, { fill: accent, radius: 4 }),
      text({ x: 260, y: 420, w: 1400, h: 150 }, 'title', [detail.name]),
      text({ x: 260, y: 590, w: 1200, h: 90 }, 'subtitle', [detail.description || 'Your story, designed.']),
      text({ x: 260, y: 900, w: 1000, h: 50 }, 'caption', ['The copilot adapts this structure to your content.']),
    ],
  };

  const content = {
    id: 'slide_content', layout: 'title-content', notes: '', elements: [
      text({ x: 160, y: 120, w: 1400, h: 90 }, 'title', ['A clear point per slide']),
      el('shape', { x: 160, y: 226, w: 160, h: 8 }, { kind: 'rect' }, { fill: brand, radius: 4 }),
      text({ x: 160, y: 300, w: 760, h: 500 }, 'bullets',
           ['One idea, stated plainly', 'Evidence that backs it', 'What it means for the audience', 'The next step you want']),
      el('shape', { x: 1040, y: 300, w: 720, h: 480 }, { kind: 'rect' }, { fill: surface, radius: 18 }),
      text({ x: 1100, y: 380, w: 600, h: 160 }, 'title', ['64%'], { color: brand, fontSize: 130 }),
      text({ x: 1100, y: 560, w: 600, h: 80 }, 'caption', ['A number that carries the argument']),
    ],
  };

  const chart = {
    id: 'slide_chart', layout: 'chart-focus', notes: '', elements: [
      text({ x: 160, y: 120, w: 1400, h: 90 }, 'title', ['Data, styled to the theme']),
      el('shape', { x: 160, y: 226, w: 160, h: 8 }, { kind: 'rect' }, { fill: brand, radius: 4 }),
      el('chart', { x: 220, y: 300, w: 1480, h: 640 }, {
        spec: {
          grid: { left: 60, right: 30, top: 30, bottom: 50 },
          xAxis: { type: 'category', data: ['Q1', 'Q2', 'Q3', 'Q4'],
                   axisLabel: { color: p.mute || '#6B7280', fontSize: 22 }, axisLine: { lineStyle: { color: p.mute } } },
          yAxis: { type: 'value', axisLabel: { color: p.mute || '#6B7280', fontSize: 20 },
                   splitLine: { lineStyle: { color: 'rgba(128,128,128,.15)' } } },
          series: [{ type: 'bar', barWidth: '52%',
                     data: [42, 58, 76, { value: 104, itemStyle: { color: accent } }],
                     itemStyle: { color: brand, borderRadius: [8, 8, 0, 0] },
                     label: { show: true, position: 'top', color: p.ink || '#111827', fontSize: 24 } }],
        },
      }),
    ],
  };

  const closing = {
    id: 'slide_close', layout: 'section',
    background: { color: brand }, notes: '', elements: [
      text({ x: 260, y: 440, w: 1400, h: 140 }, 'title', ['A confident close'], { color: '#FFFFFF' }),
      text({ x: 260, y: 600, w: 1200, h: 80 }, 'subtitle', ['Sections and closings pick up the brand color.'], { color: 'rgba(255,255,255,.85)' }),
    ],
  };

  return {
    meta: { title: detail.name, aspectRatio: '16:9' },
    stage: { width: 1920, height: 1080 },
    theme,
    slides: [cover, content, chart, closing],
  };
}
