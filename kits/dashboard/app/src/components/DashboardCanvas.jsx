// The board: every panel in the document, arranged, each showing what its query returned.
//
// The frame, the loading state, the error state and the grid all come from the package (Panel,
// PanelGrid) because those are the parts every dashboard product rebuilds and gets subtly wrong.
// What is here is only what "this dashboard" means: which of the three viz kinds to draw, and
// how a result becomes one.
//
// The rule that shapes all of it: a panel shows a number the database returned, or it shows why
// there isn't one. There is no third rendering. No zero for a failed query, no empty chart for a
// missing column, no last-known value held over from the previous load.
import { useMemo } from 'react';
import { Panel, PanelGrid } from 'reifyui';
import { Chart, useChartTokens } from 'reifyui/chart';
import { chartOption, formatValue, statValue, tableView } from '../lib/dashboard';
import { freshness, panelState } from '../lib/refresh';

/** The theme a chart is drawn in, as an ECharts option fragment. Built from the live tokens, so
 *  it follows the app's palette rather than restating it — and rebuilt when the theme flips,
 *  which is what the hook is for. */
function useTheme() {
  const [t, ref] = useChartTokens();
  const option = useMemo(() => ({
    // `palette` is categorical and assigned in order — never cycled. Past eight series colour has
    // stopped being an encoding, which is the package's rule and also the honest one.
    color: t.palette,
    backgroundColor: 'transparent',
    animationDuration: 240,
    textStyle: { color: t.ink, fontFamily: t.font },
    grid: { left: 8, right: 12, top: 16, bottom: 8, containLabel: true },
    xAxis: { axisLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.mute },
             splitLine: { show: false } },
    yAxis: { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.mute },
             splitLine: { lineStyle: { color: t.lineSoft } } },
    tooltip: { trigger: 'axis', backgroundColor: t.surface, borderColor: t.line,
               textStyle: { color: t.ink } },
    legend: { textStyle: { color: t.mute }, icon: 'roundRect', itemHeight: 8, itemWidth: 12 },
  }), [t]);
  return [option, ref];
}

function Stat({ result, viz }) {
  const { value, error } = statValue(result, viz);
  if (error) return <p className="db-panel-msg">{error}</p>;
  return (
    <div className="db-stat">
      <span className="db-stat-v">{formatValue(value, viz)}</span>
    </div>
  );
}

function Table({ result, viz }) {
  const { columns, rows } = tableView(result, viz);
  if (!rows.length) return <p className="db-panel-msg">This query returned no rows.</p>;
  return (
    <div className="db-table-wrap scroll">
      <table className="db-table">
        <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c == null ? '—' : String(c)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartPanel({ result, viz, theme, label }) {
  // Memoised on the things that actually change it. A fresh option object every render would
  // redraw the chart every render — the one mistake the package's Chart cannot protect against,
  // because a new reference is indistinguishable from new data.
  const built = useMemo(() => chartOption(result, viz, theme), [result, viz, theme]);
  if (built.error) return <p className="db-panel-msg">{built.error}</p>;
  return <Chart option={built.option} label={label} className="db-chart" />;
}

function Body({ panel, state, theme }) {
  if (state.status !== 'ok') return null;          // Panel draws loading and error itself
  const { result } = state;
  if (panel.viz.kind === 'stat') return <Stat result={result} viz={panel.viz} />;
  if (panel.viz.kind === 'table') return <Table result={result} viz={panel.viz} />;
  return <ChartPanel result={result} viz={panel.viz} theme={theme} label={panel.title} />;
}

export function DashboardCanvas({ doc, states, editable = false, onLayoutChange }) {
  const [theme, themeRef] = useTheme();

  const layout = useMemo(
    () => doc.panels.map((p) => ({ i: p.id, ...p.layout, minW: 2, minH: 2 })),
    [doc.panels],
  );

  return (
    <div className="db-canvas" ref={themeRef}>
      <PanelGrid
        layout={layout}
        editable={editable}
        onLayoutChange={onLayoutChange}
        resizeLabel={(id) => `Resize ${doc.panels.find((p) => p.id === id)?.title || 'panel'}`}
      >
        {doc.panels.map((p) => {
          const st = panelState(p, states);
          // The caption is the agent's note about what the number excludes; the freshness is the
          // app's note about when it was true. Both belong under the title, and neither is
          // invented — an unrefreshed panel shows no time rather than "now".
          const meta = [p.caption, st.status === 'ok' ? freshness(st.at) : '']
            .filter(Boolean).join(' · ');
          // The statement that failed, folded away under the message. A query error is a thing
          // people copy into the conversation to get it fixed, and the error alone is half of it.
          const sql = st.status === 'error' ? doc.queries.get(p.query)?.sql : null;
          // The Panel IS the grid child — no wrapper. A div in between is auto-height, and the
          // panel's `height: 100%` then resolves against it and collapses: every chart rendered
          // into a zero-height box and the board came back as a page of empty titles.
          return (
            <Panel
              key={p.id}
              title={p.title}
              meta={meta || undefined}
              loading={st.status === 'loading'}
              error={st.status === 'error' ? st.error : undefined}
              errorDetail={sql ? <pre className="db-panel-sql">{sql}</pre> : undefined}
              detailLabel="The query"
              className={`db-panel is-${p.viz.kind || 'unknown'}`}
            >
              <Body panel={p} state={st} theme={theme} />
            </Panel>
          );
        })}
      </PanelGrid>
    </div>
  );
}
