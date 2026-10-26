import type { SupervisorBead } from '../supervisor/beadReads';
import { beadHoldReason, dependencyState, isAggregateBead, isBlockingRelation } from './beadState';

// Pure dependency-graph + kanban-column builder for the Beads board
// (gascity-dashboard-6frc). The board is "part kanban, part dependency
// graph" in the DESIGN.md editorial register: status columns, with each
// bead's upstream (`deps`) and downstream (`blocks`) relations surfaced as
// typeset rows rather than a node-edge canvas.
//
// Honesty discipline (inherited from prd_bead-linked-view.md): the fetched
// bead list is a window, not the whole store. A dependency that points
// outside the window resolves to `bead: null` and is rendered `unresolved`,
// never fabricated. Native dependency state covers prerequisites omitted from
// the window; without that evidence an unresolved blocking edge stays unknown.
//
// ZFC: pure structural inversion of supervisor-provided fields (`needs`,
// `dependencies`, `is_blocked`, `status`, and explicit holds). No scoring.

export type BoardColumnId =
  | 'ready'
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'needs_owner'
  | 'stalled'
  | 'done';

export interface BoardColumn {
  id: BoardColumnId;
  /** Display label in the established label register (caller upper-cases). */
  label: string;
}

/** Column order, left to right. The single source of truth for the board. */
export const BOARD_COLUMNS: readonly BoardColumn[] = [
  { id: 'ready', label: 'ready' },
  { id: 'open', label: 'open' },
  { id: 'in_progress', label: 'in progress' },
  { id: 'blocked', label: 'blocked' },
  { id: 'needs_owner', label: 'needs owner' },
  { id: 'stalled', label: 'stalled' },
  { id: 'done', label: 'done' },
];

/** A single upstream dependency edge, resolved against the fetched window. */
export interface BeadDepEdge {
  /** The dependency target bead id (always present). */
  id: string;
  /** Resolved bead in the fetched window, or null when it points outside. */
  bead: SupervisorBead | null;
  /** Edge provenance: `needs` (the supervisor's blocking set) or a
   *  `dependencies[].type` string. */
  kind: string;
}

/** A single downstream (inverse) edge: `bead` depends on this node via
 *  `kind` (same provenance as `BeadDepEdge.kind`, seen from the other end). */
export interface BeadBlockEdge {
  bead: SupervisorBead;
  kind: string;
}

export interface BeadNode {
  bead: SupervisorBead;
  /** Upstream beads this one depends on, each resolved-or-unresolved. */
  deps: BeadDepEdge[];
  /** Downstream beads that depend on this one (in-window only), each
   *  carrying the dependency type it depends on this one *by* — never
   *  collapsed to an untyped blocker (gascity#4365). */
  blocks: BeadBlockEdge[];
  /** Derived board column. */
  column: BoardColumnId;
  /** Executable open work whose blocking prerequisites and holds are clear. */
  ready: boolean;
  /** A prerequisite is unresolved and no authoritative native clearance covers it. */
  hasUnresolvedDeps: boolean;
  /** Primary explanation, independent of the preserved store lifecycle value. */
  stateNote?: string;
}

export interface BeadGraph {
  /** Every bead keyed by id. */
  nodes: Map<string, BeadNode>;
  /** Beads grouped by column, each sorted by priority then id. */
  columns: Record<BoardColumnId, BeadNode[]>;
}

/** Preserve typed relationships, deduplicating equivalent blocking edges. */
function depEntries(bead: SupervisorBead): ReadonlyArray<{ id: string; kind: string }> {
  const seen = new Set<string>();
  const entries: { id: string; kind: string }[] = [];
  for (const id of bead.needs ?? []) {
    if (id.length === 0 || seen.has(`blocking:${id}`)) continue;
    seen.add(`blocking:${id}`);
    entries.push({ id, kind: 'needs' });
  }
  for (const dep of bead.dependencies ?? []) {
    const id = dep.depends_on_id;
    const key = `${isBlockingRelation(dep.type) ? 'blocking' : dep.type}:${id}`;
    if (id.length === 0 || seen.has(key)) continue;
    seen.add(key);
    entries.push({ id, kind: dep.type });
  }
  return entries;
}

function columnFor(
  bead: SupervisorBead,
  dependency: 'clear' | 'blocked' | 'unknown',
  stalled: boolean,
): BoardColumnId {
  if (bead.status === 'closed') return 'done';
  if (dependency === 'blocked') return 'blocked';
  if (isAggregateBead(bead)) return 'open';
  if (bead.status === 'in_progress') {
    if ((bead.assignee?.trim().length ?? 0) === 0) return 'needs_owner';
    return stalled ? 'stalled' : 'in_progress';
  }
  return bead.status === 'open' && dependency === 'clear' ? 'ready' : 'open';
}

function byPriorityThenId(a: BeadNode, b: BeadNode): number {
  const pa = a.bead.priority ?? Number.POSITIVE_INFINITY;
  const pb = b.bead.priority ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  return a.bead.id < b.bead.id ? -1 : a.bead.id > b.bead.id ? 1 : 0;
}

export function buildBeadGraph(
  beads: readonly SupervisorBead[],
  options: { stalledIds?: ReadonlySet<string> } = {},
): BeadGraph {
  const byId = new Map<string, SupervisorBead>();
  for (const b of beads) byId.set(b.id, b);

  const blocksOf = new Map<string, BeadBlockEdge[]>();
  const nodes = new Map<string, BeadNode>();

  // First pass: resolve upstream edges and readiness; accumulate inverse edges.
  for (const b of beads) {
    const deps: BeadDepEdge[] = depEntries(b).map(({ id, kind }) => ({
      id,
      kind,
      bead: byId.get(id) ?? null,
    }));
    const dependency = dependencyState(b, byId);
    const hasUnresolvedDeps = dependency === 'unknown';
    const column = columnFor(b, dependency, options.stalledIds?.has(b.id) ?? false);
    const ready = column === 'ready';
    const stateNote =
      beadHoldReason(b) ??
      (column === 'needs_owner'
        ? 'Needs accountable owner'
        : isAggregateBead(b)
          ? b.issue_type === 'epic'
            ? 'Epic · child progress'
            : 'Workflow control · child progress'
          : dependency === 'blocked'
            ? 'Waiting for prerequisites'
            : dependency === 'unknown'
              ? 'Prerequisite state unknown'
              : undefined);

    const node: BeadNode = {
      bead: b,
      deps,
      blocks: [],
      ready,
      hasUnresolvedDeps,
      column,
      ...(stateNote === undefined ? {} : { stateNote }),
    };
    nodes.set(b.id, node);

    for (const dep of deps) {
      if (dep.bead === null) continue;
      const edge: BeadBlockEdge = { bead: b, kind: dep.kind };
      const list = blocksOf.get(dep.id);
      if (list) list.push(edge);
      else blocksOf.set(dep.id, [edge]);
    }
  }

  // Second pass: attach inverse edges (sorted for deterministic render).
  for (const [id, blockers] of blocksOf) {
    const node = nodes.get(id);
    if (node) {
      node.blocks = [...blockers].sort((a, b) =>
        a.bead.id < b.bead.id ? -1 : a.bead.id > b.bead.id ? 1 : 0,
      );
    }
  }

  const columns = emptyColumns();
  for (const node of nodes.values()) columns[node.column].push(node);
  for (const col of BOARD_COLUMNS) columns[col.id].sort(byPriorityThenId);

  return { nodes, columns };
}

function emptyColumns(): Record<BoardColumnId, BeadNode[]> {
  return {
    ready: [],
    open: [],
    in_progress: [],
    blocked: [],
    needs_owner: [],
    stalled: [],
    done: [],
  };
}

/**
 * Project the graph's columns down to just the beads in `ids`, preserving
 * each column's existing order. Lets the page render one board per rig from
 * a single shared graph — so cross-rig dependency edges still resolve
 * (the graph is built over all beads), while display is grouped by rig.
 */
export function selectColumns(
  graph: BeadGraph,
  ids: ReadonlySet<string>,
): Record<BoardColumnId, BeadNode[]> {
  const out = emptyColumns();
  for (const col of BOARD_COLUMNS) {
    out[col.id] = graph.columns[col.id].filter((n) => ids.has(n.bead.id));
  }
  return out;
}
