# Credits

## Templates

The five worked dashboards in `templates/templates.json` — their SQL, their ECharts options and
their arrangement — are original to this kit. Which panels belong on each kind of dashboard, and
where they sit, follows well-established practice rather than invention; these are the sources
that settled the questions.

**What goes where, and how much fits on one screen**

- Stephen Few, [*Dashboard Design for at-a-glance monitoring*](https://www.perceptualedge.com/files/Dashboard_Design_Course.pdf)
  (Perceptual Edge) — a dashboard is the information needed to do a job, on one screen, read at a
  glance. The single-screen constraint is why these templates stop at eight panels.
- [Domo, *Dashboard design examples and best practices*](https://www.domo.com/learn/article/dashboard-design-examples-best-practices)
  and [UXPin, *Dashboard design principles*](https://www.uxpin.com/studio/blog/dashboard-design-principles/) —
  the F-pattern scan, and the top-left panel as the most valuable real estate on the page.
- [Figr, *Dashboard design best practices for product teams*](https://figr.design/blog/dashboard-design-best-practices) —
  five to seven primary metrics per view, against Miller's seven-plus-or-minus-two.

**Which chart answers which question**

- [eazyBI, *Data visualization — how to pick the right chart type*](https://eazybi.com/blog/data-visualization-and-chart-types) —
  bars emphasise magnitude, lines emphasise trend.
- [ORM, *Which chart types belong on a sales dashboard*](https://orm-tech.com/blog/sales-dashboard-chart-types) —
  why a pipeline is a funnel and never a pie.

**What belongs on each kind of dashboard**

- SaaS revenue: [Klipfolio, *SaaS dashboard metrics and KPIs*](https://www.klipfolio.com/resources/dashboard-examples/saas),
  [Baremetrics, *SaaS metrics checklist*](https://baremetrics.com/blog/saas-metrics-checklist-kpis-founders-should-track),
  [Orbix, *How to build a SaaS metrics dashboard*](https://www.orbix.studio/blogs/saas-metrics-dashboard-guide)
  — MRR and ARR read together, movement (new against churned) beside the level, and a trend rather
  than a single figure.
- Sales pipeline: [Close, *Sales pipeline metrics*](https://close.com/blog/sales-pipeline-metrics),
  [Forecastio, *Sales pipeline dashboard examples*](https://forecastio.ai/blog/sales-pipeline-dashboard)
  — open value, win rate, average deal size, cycle length, and stage-by-stage drop-off.
- Web analytics: [Coupler.io, *Web analytics dashboards*](https://blog.coupler.io/web-analytics-dashboards/),
  [Contentsquare, *Web analytics metrics and KPIs*](https://contentsquare.com/guides/web-analytics/metrics/)
  — traffic trend, acquisition source, landing-page performance, in that order.
- Support operations: [Zendesk, *Help desk metrics*](https://www.zendesk.com/blog/customer-service/help-desk/help-desk/top-10-help-desk-metrics/),
  [Hiver, *Top help desk metrics*](https://hiverhq.com/blog/help-desk-metrics),
  [Pylon, *Customer support dashboard examples*](https://www.usepylon.com/blog/customer-support-dashboard-examples)
  — backlog, first response time, SLA attainment, opened against resolved, volume by channel.

Every query in those templates is written against a schema that is ours and imaginary. Any
resemblance to a real customer's tables is the point, and also a coincidence.

## Charts

Panels are drawn with **[Apache ECharts](https://echarts.apache.org/)** (Apache-2.0). The panel
option format in `dashboard.json` is ECharts' own `option`, with the query result supplied as its
`dataset` — so what the agent writes is an ordinary ECharts option and ECharts' documentation
applies to it unchanged.

## Components

The grid, the conversation surface, the dialogs and the HarnessRouter transport come from
**[reifyui](https://www.npmjs.com/package/reifyui)** (MIT), which is where they live so that a
third kit does not start a third copy of them.

## Database drivers

Queries reach PostgreSQL through **[asyncpg](https://github.com/MagicStack/asyncpg)** (Apache-2.0)
and MySQL/MariaDB through **[aiomysql](https://github.com/aio-libs/aiomysql)** (MIT), from the
gateway. Neither is bundled with this kit; both come from the HarnessRouter image.

## Software dependencies

The Dashboards app installs third-party packages from npm, including React, ReifyUI, ECharts,
react-grid-layout, Lucide, and their transitive dependencies. Those packages remain governed by
their own licenses. `package.json` and `package-lock.json` identify the installed package
versions; a production distributor must generate and ship the notices required for the actual
dependency set included in its build.
