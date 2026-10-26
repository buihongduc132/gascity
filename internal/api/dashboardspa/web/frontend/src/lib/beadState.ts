import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';

const CONTROL_KINDS = new Set([
  'workflow',
  'workflow-finalize',
  'scope',
  'scope-check',
  'ralph',
  'spec',
  'check',
  'fan-out',
  'fan-in',
  'tally',
  'drain',
]);
const ENGINEERING_TYPES = new Set(['feature', 'bug', 'task', 'epic', 'chore', 'decision']);

/** Generated orchestration records have different ownership rules from executable leaves. */
export function isWorkflowControl(bead: Bead): boolean {
  return CONTROL_KINDS.has(bead.metadata?.['gc.kind'] ?? '');
}

/** Containers report aggregate child progress; an empty worker assignee is not a lost worker. */
export function isAggregateBead(bead: Bead): boolean {
  return bead.issue_type === 'epic' || isWorkflowControl(bead);
}

/** Business work is the default view; controls remain available through an explicit toggle. */
export function isBoardBead(bead: Bead, includeControls = false): boolean {
  if (isWorkflowControl(bead)) return includeControls;
  return (
    ENGINEERING_TYPES.has(bead.issue_type) &&
    !(bead.labels ?? []).some((label) => label.startsWith('gc:'))
  );
}

/** Only dependency edges block work; hierarchy and tracking edges do not. */
export function isBlockingRelation(kind: string): boolean {
  return kind === 'needs' || kind === 'blocks';
}

function activeMarker(value: string | undefined): boolean {
  return (
    value !== undefined &&
    !['', '0', 'false', 'none', 'cleared', 'resolved'].includes(value.trim().toLowerCase())
  );
}

/** Read an explicit hold without changing or overriding its authority. */
export function beadHoldReason(bead: Bead): string | null {
  if (bead.status === 'closed') return null;
  const metadata = bead.metadata ?? {};
  if (
    ['gc.user_pause', 'gc.paused'].some((key) => activeMarker(metadata[key])) ||
    (bead.labels ?? []).some((label) => label === 'paused' || label === 'user-paused')
  ) {
    return 'Paused by user';
  }
  if (
    ['gc.permission_block', 'gc.sanitizer_permission_block'].some((key) =>
      activeMarker(metadata[key]),
    ) ||
    metadata['gc.blocker_status'] === 'BLOCKED_PLATFORM_SAFETY_DENIAL'
  ) {
    return 'Permission hold';
  }
  if (
    activeMarker(metadata['gc.checkpoint_hold']) ||
    activeMarker(metadata['gc.founder_gate']) ||
    metadata['gc.checkpoint'] === 'awaiting-human'
  )
    return 'Waiting for a decision';
  if ((bead.labels ?? []).includes('hold:mayor')) return 'Waiting on mayor';
  if ((bead.labels ?? []).includes('hold:external')) return 'Waiting on external prerequisite';
  return null;
}

/** Known dependency and hold state; absent native evidence stays unresolved. */
export function dependencyState(
  bead: Bead,
  beads: ReadonlyMap<string, Bead>,
): 'clear' | 'blocked' | 'unknown' {
  if (bead.status === 'blocked' || bead.is_blocked === true || beadHoldReason(bead) !== null)
    return 'blocked';
  const ids = new Set((bead.needs ?? []).filter((id) => id.length > 0));
  for (const dep of bead.dependencies ?? []) {
    if (isBlockingRelation(dep.type) && dep.depends_on_id.length > 0) ids.add(dep.depends_on_id);
  }
  let missing = false;
  for (const id of ids) {
    const prerequisite = beads.get(id);
    if (prerequisite === undefined) missing = true;
    else if (prerequisite.status !== 'closed') return 'blocked';
  }
  // Native clearance also covers completed prerequisites excluded from the fetch window.
  if (missing && bead.is_blocked !== false) return 'unknown';
  return 'clear';
}
