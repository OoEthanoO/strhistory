# STR History

The history department's website: an interactive, timeline-based globe of IB
History topics with study notes, plus courses, teachers, news and study guides.

**Live:** https://history.ethanyanxu.com

- Move through time from human origins to the present and see the world's
  borders for any year since 1700, from OpenHistoricalMap.
- Click a pin to open that IB topic's notes — with highlighted, attributed
  quotations, key terms that reveal their significance, historians' debates and
  self-test questions.

```bash
npm install
npm run dev     # http://localhost:4321
```

Built with Astro, React and MapLibre GL; borders from
[OpenHistoricalMap](https://www.openhistoricalmap.org/) (CC0); coastlines from Natural Earth. Every commit to `main` deploys to the
home server automatically.

**Contributing, architecture, design and deployment:** see [AGENTS.md](AGENTS.md).
