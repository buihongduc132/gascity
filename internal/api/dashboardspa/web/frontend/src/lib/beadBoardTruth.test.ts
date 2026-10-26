import { describe, expect, it } from 'vitest';
import type { SupervisorBead } from '../supervisor/beadReads';
import { buildBeadGraph, selectColumns } from './beadGraph';
import { isBoardBead } from './beadState';
import {
  inProgressCardNote,
  selectBeadsNeedingAttention,
} from '../attention/beadsNeedingAttention';

function bead(id: string, extra: Partial<SupervisorBead> = {}): SupervisorBead {
  return {
    id,
    title: id,
    status: 'open',
    issue_type: 'task',
    created_at: '2026-10-23T00:00:00Z',
    ...extra,
  };
}

describe('board truth regression: 26 October native snapshot', () => {
  it('keeps controls accessible without putting bookkeeping in the business view', () => {
    const root = bead('root', { metadata: { 'gc.kind': 'workflow' } });
    expect(isBoardBead(root)).toBe(false);
    expect(isBoardBead(root, true)).toBe(true);
    expect(isBoardBead(bead('epic', { issue_type: 'epic' }))).toBe(true);
    expect(isBoardBead(bead('noise', { labels: ['gc:session'] }), true)).toBe(false);
  });

  it('never promotes native-blocked open records to Ready when needs is absent', () => {
    const records = Array.from({ length: 100 }, (_, i) =>
      bead(`blocked-${i}`, { is_blocked: true }),
    );
    const graph = buildBeadGraph(records);
    expect(graph.columns.ready).toHaveLength(0);
    expect(graph.columns.blocked).toHaveLength(100);
  });

  it('uses typed blocks edges while leaving tracks and parent-child as relationships', () => {
    const graph = buildBeadGraph([
      bead('source'),
      bead('blocked', {
        dependencies: [{ issue_id: 'blocked', depends_on_id: 'source', type: 'blocks' }],
      }),
      bead('tracking', {
        dependencies: [{ issue_id: 'tracking', depends_on_id: 'source', type: 'tracks' }],
      }),
    ]);
    expect(graph.nodes.get('blocked')?.column).toBe('blocked');
    expect(graph.nodes.get('tracking')?.column).toBe('ready');
  });

  it('does not call an unknown blocking prerequisite Ready', () => {
    const graph = buildBeadGraph([
      bead('missing', {
        dependencies: [{ issue_id: 'missing', depends_on_id: 'outside-window', type: 'blocks' }],
      }),
    ]);
    expect(graph.nodes.get('missing')?.column).toBe('open');
  });

  it('preserves native clearance when a completed prerequisite is outside the fetch window', () => {
    const graph = buildBeadGraph([
      bead('cleared', {
        is_blocked: false,
        dependencies: [
          { issue_id: 'cleared', depends_on_id: 'completed-outside-window', type: 'blocks' },
        ],
      }),
    ]);
    expect(graph.nodes.get('cleared')?.column).toBe('ready');
    expect(graph.nodes.get('cleared')?.hasUnresolvedDeps).toBe(false);
  });

  it('keeps explicit platform permission holds blocked even when native dependencies are clear', () => {
    for (const key of ['gc.permission_block', 'gc.sanitizer_permission_block']) {
      const graph = buildBeadGraph([
        bead('dyl-8tt1', {
          is_blocked: false,
          metadata: { [key]: 'prior_platform_denial_no_retry_no_delegation' },
        }),
      ]);
      expect(graph.nodes.get('dyl-8tt1')?.column).toBe('blocked');
    }
  });

  it('preserves explicit user pauses and distinguishes a cleared zero-valued marker', () => {
    for (const key of ['gc.user_pause', 'gc.paused']) {
      expect(
        buildBeadGraph([
          bead('paused', {
            status: 'in_progress',
            assignee: 'worker',
            metadata: { [key]: 'true' },
          }),
        ]).nodes.get('paused')?.column,
      ).toBe('blocked');
    }
    for (const label of ['paused', 'user-paused']) {
      expect(
        buildBeadGraph([bead('paused', { labels: [label] })]).nodes.get('paused')?.column,
      ).toBe('blocked');
    }
    expect(
      buildBeadGraph([
        bead('clear', { metadata: { 'gc.paused': '0', 'gc.permission_block': '0' } }),
      ]).nodes.get('clear')?.column,
    ).toBe('ready');
  });

  it('separates ownerless executable WIP from work claimed in progress without editing raw state', () => {
    const orphan = bead('orphan', { status: 'in_progress' });
    const graph = buildBeadGraph([
      orphan,
      bead('owned', { status: 'in_progress', assignee: 'worker-a' }),
    ]);
    expect(graph.nodes.get('orphan')?.column).toBe('needs_owner');
    expect(graph.nodes.get('orphan')?.bead.status).toBe('in_progress');
    expect(graph.columns.in_progress.map((n) => n.bead.id)).toEqual(['owned']);
  });

  it('shows real dependency blockage ahead of recorded WIP', () => {
    expect(
      buildBeadGraph([
        bead('blocked-wip', { status: 'in_progress', assignee: 'worker', is_blocked: true }),
      ]).nodes.get('blocked-wip')?.column,
    ).toBe('blocked');
  });

  it('does not treat a workflow root or epic as an unclaimed executable leaf', () => {
    const root = bead('dyl-w0i2', { status: 'in_progress', metadata: { 'gc.kind': 'workflow' } });
    const epic = bead('epic', { status: 'in_progress', issue_type: 'epic' });
    for (const b of [root, epic]) {
      expect(buildBeadGraph([b]).nodes.get(b.id)?.column).toBe('open');
      expect(inProgressCardNote(b, [], Date.parse('2026-10-26T08:19:31Z'))).not.toMatch(
        /stalled|no assignee/,
      );
    }
  });

  it('does not infer a missing worker from an unmatched external assignee', () => {
    const b = bead('external', { status: 'in_progress', assignee: 'Duc Bui' });
    expect(inProgressCardNote(b, [], Date.parse('2026-10-26T08:19:31Z'))).toMatch(
      /runtime unknown/i,
    );
    expect(
      selectBeadsNeedingAttention(
        { beads: [b], escalations: [], sessions: [] },
        Date.parse('2026-10-26T08:19:31Z'),
      ).some((r) => r.reason === 'stalled'),
    ).toBe(false);
  });

  it('moves observed native stalls out of WIP while retaining unknown external execution', () => {
    const records = [
      bead('native-stall', { status: 'in_progress', assignee: 'worker-native' }),
      bead('external-unknown', { status: 'in_progress', assignee: 'external-worker' }),
      bead('blocked-stall', { status: 'in_progress', assignee: 'worker-native', is_blocked: true }),
    ];
    const attention = selectBeadsNeedingAttention(
      {
        beads: records,
        escalations: [],
        sessions: [{ id: 'session-native', session_name: 'worker-native', state: 'dead' }],
      },
      Date.parse('2026-10-26T08:19:31Z'),
    );
    const graph = buildBeadGraph(records, {
      stalledIds: new Set(
        attention.filter((row) => row.reason === 'stalled').map((row) => row.beadId),
      ),
    });
    expect(graph.columns.stalled.map((node) => node.bead.id)).toEqual(['native-stall']);
    expect(graph.columns.in_progress.map((node) => node.bead.id)).toEqual(['external-unknown']);
    expect(graph.nodes.get('blocked-stall')?.column).toBe('blocked');
    expect(graph.nodes.get('native-stall')?.bead.status).toBe('in_progress');
  });

  it('does not advertise old dependency-blocked or permission-held work as ready-unclaimed', () => {
    const rows = selectBeadsNeedingAttention(
      {
        beads: [
          bead('native-blocked', { is_blocked: true }),
          bead('permission-held', {
            metadata: { 'gc.permission_block': 'prior_platform_denial_no_retry_no_delegation' },
          }),
        ],
        escalations: [],
      },
      Date.parse('2026-10-26T08:19:31Z'),
    );
    expect(rows.some((row) => row.reason === 'ready-unclaimed')).toBe(false);
  });

  it('retains dependency truth when the visible board excludes a prerequisite', () => {
    const graph = buildBeadGraph([
      bead('complete', { status: 'closed' }),
      bead('dependent', {
        dependencies: [{ issue_id: 'dependent', depends_on_id: 'complete', type: 'blocks' }],
      }),
    ]);
    expect(selectColumns(graph, new Set(['dependent'])).ready.map((n) => n.bead.id)).toEqual([
      'dependent',
    ]);
    expect(graph.nodes.get('dependent')?.deps[0]?.bead?.status).toBe('closed');
  });
});
