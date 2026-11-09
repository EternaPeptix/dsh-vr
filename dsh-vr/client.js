window.__ModuleLoader__.load({
  id: 'dsh-vr',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const chip = (text, tone) =>
      h(
        'span',
        {
          key: String(text),
          style: {
            display: 'inline-block',
            padding: '1px 7px',
            borderRadius: 9,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.2,
            color: tone === 'good' ? '#0b3d2c' : tone === 'bad' ? '#5b1420' : '#33405a',
            background: tone === 'good' ? '#b7f4d4' : tone === 'bad' ? '#ffd0d6' : '#dbe3f0',
          },
        },
        text,
      );

    function gateTone(decision) {
      if (decision === 'REPORT') return 'good';
      if (decision === 'REFUTE') return 'bad';
      return undefined;
    }

    function groupByEngagement(threads, current) {
      const groups = new Map();
      for (const thread of threads) {
        const key = thread.engagement || 'unscoped';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(thread);
      }
      return [...groups.entries()]
        .map(([engagement, rows]) => ({
          engagement,
          rows,
          open: rows.filter((row) => row.status === 'active' || row.status === 'untested').length,
          report: rows.filter((row) => row.gate === 'REPORT').length,
          hold: rows.filter((row) => row.gate === 'HOLD').length,
        }))
        .sort((a, b) => {
          if (a.engagement === current) return -1;
          if (b.engagement === current) return 1;
          return b.rows.length - a.rows.length;
        });
    }

    function ThreadTable({ rows }) {
      const columns = [
        ['thread', 78],
        ['status', 86],
        ['stage', 78],
        ['gate', 150],
        ['evidence', 96],
        ['question', undefined],
      ];
      return h(
        'table',
        { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' } },
        h('thead', null,
          h('tr', null,
            ...columns.map(([title, width]) =>
              h('th', {
                key: title,
                style: {
                  width,
                  textAlign: 'left',
                  padding: '6px 8px',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                  opacity: 0.6,
                  borderBottom: '1px solid rgba(127,127,127,.3)',
                },
              }, title)))),
        h('tbody', null,
          ...rows.map((thread) =>
            h('tr', { key: thread.id },
              h('td', { style: { padding: '6px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 12 } }, thread.id),
              h('td', { style: { padding: '6px 8px' } },
                chip(thread.status, thread.status === 'refuted' ? 'bad' : thread.status === 'reported' ? 'good' : undefined)),
              h('td', { style: { padding: '6px 8px', opacity: 0.75, fontSize: 12 } }, thread.stage),
              h('td', { style: { padding: '6px 8px', whiteSpace: 'nowrap' } },
                chip(thread.gate, gateTone(thread.gate)),
                thread.gate === 'HOLD'
                  ? h('span', { style: { opacity: 0.6, fontSize: 11, marginLeft: 6 } },
                      thread.reasons.map((reason) => reason.code).slice(0, 2).join(', '))
                  : null),
              h('td', { style: { padding: '6px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 12 } },
                `${thread.evidence.length}${thread.executed > 0 ? ` (${thread.executed} exec)` : ''}`),
              h('td', {
                style: {
                  padding: '6px 8px',
                  opacity: 0.9,
                  fontSize: 12,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
                title: thread.question,
              }, thread.question)))),
      );
    }

    function Dashboard() {
      const [state, setState] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [filter, setFilter] = React.useState('open');

      const load = React.useCallback(() => {
        fetch('/vr/api/state', { cache: 'no-store' })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((data) => {
            setState(data);
            setError(null);
          })
          .catch((failure) => setError(String(failure)));
      }, []);

      React.useEffect(() => {
        load();
      }, [load]);

      const outer = {
        height: '100%',
        maxHeight: '100%',
        // Flex parents clip a child that grows; minHeight lets this box scroll instead of overflowing.
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        overscrollBehavior: 'contain',
        boxSizing: 'border-box',
        padding: '16px 20px 40px',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
      };

      if (error !== null) {
        return h('div', { style: { ...outer, fontFamily: 'ui-monospace, monospace' } },
          `dashboard could not read state: ${error}`);
      }
      if (state === null) {
        return h('div', { style: { ...outer, opacity: 0.7 } }, 'reading research state…');
      }

      const visible = state.threads.filter((thread) => {
        if (filter === 'open') return thread.status === 'active' || thread.status === 'untested';
        if (filter === 'report') return thread.gate === 'REPORT';
        return true;
      });
      const groups = groupByEngagement(visible, state.engagement);
      const muted = { opacity: 0.62, fontSize: 12 };

      return h('div', { style: outer },
        h('div', {
          style: {
            position: 'sticky',
            top: 0,
            zIndex: 2,
            margin: '-16px -20px 10px',
            padding: '16px 20px 8px',
            background: 'Canvas',
            borderBottom: '1px solid rgba(127,127,127,.25)',
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' } },
            h('h2', { style: { margin: 0, fontSize: 17 } }, 'Research findings'),
            h('span', { style: muted }, `current ${state.engagement}`),
            h('span', { style: muted }, `open ${state.open}/${state.ceiling}`),
            h('span', { style: muted }, `${state.counts.total} threads`),
            h('span', { style: muted }, `${state.counts.report} reportable`)),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' } },
            ...['open', 'report', 'all'].map((option) =>
              h('button', {
                key: option,
                onClick: () => setFilter(option),
                style: {
                  padding: '4px 10px',
                  borderRadius: 7,
                  border: '1px solid rgba(127,127,127,.35)',
                  background: filter === option ? 'rgba(127,127,127,.18)' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                },
              }, option)),
            h('button', {
              onClick: load,
              style: {
                marginLeft: 'auto',
                padding: '4px 10px',
                borderRadius: 7,
                border: '1px solid rgba(127,127,127,.35)',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 12,
              },
            }, 'refresh'))),
        state.ruleFrequency.length > 0
          ? h('p', { style: { ...muted, margin: '0 0 10px' } },
              'blocking: ',
              state.ruleFrequency.map((row) => `${row.code} ×${row.n}`).join(' · '))
          : null,
        state.orphans !== undefined && state.orphans.length > 0
          ? h('p', { style: { ...muted, margin: '0 0 12px', color: '#8a5a12' } },
              `unlinked evidence files: ${state.orphans.join(', ')}`)
          : null,
        groups.length === 0 ? h('p', { style: muted }, 'nothing matches this filter') : null,
        ...groups.map((group) =>
          h('section', { key: group.engagement, style: { marginBottom: 22 } },
            h('div', {
              style: {
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                flexWrap: 'wrap',
                margin: '0 0 6px',
                paddingBottom: 4,
                borderBottom: '1px solid rgba(127,127,127,.2)',
              },
            },
              h('h3', { style: { margin: 0, fontSize: 14, fontFamily: 'ui-monospace, monospace' } }, group.engagement),
              group.engagement === state.engagement
                ? h('span', { style: { fontSize: 11, opacity: 0.8, fontWeight: 600 } }, 'current')
                : null,
              h('span', { style: muted }, `${group.rows.length} shown`),
              h('span', { style: muted }, `${group.open} open`),
              h('span', { style: muted }, `${group.report} reportable`),
              group.hold > 0 ? h('span', { style: muted }, `${group.hold} held`) : null),
            ThreadTable({ rows: group.rows.slice(0, 150) }),
            group.rows.length > 150
              ? h('p', { style: muted }, `${group.rows.length - 150} more in this engagement`)
              : null)),
        h('p', { style: { ...muted, marginTop: 6 } },
          `generated ${state.generatedAt} · read-only · decisions come from vr_gate, not from this page`),
      );
    }

    const Icon = () =>
      h('span', { style: { fontSize: 15, lineHeight: 1 }, 'aria-hidden': true }, '◈');

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'vr-dashboard' }, Dashboard));
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'vr-dashboard', order: 21, label: () => 'Findings' },
            Icon,
          ));
      },
    };
  },
});
