/**
 * WorkflowGraph — visual SVG node/edge editor for a named workflow's transitions.
 *
 * Design:
 *  - Nodes = project statuses, auto-laid-out left→right by category order:
 *    TODO → IN_PROGRESS → DONE, then by status.order within each column.
 *    A synthetic "Start" node represents fromStatusId=null ("any status").
 *  - Edges = transitions, drawn as directed arrows.  Edges with gates show a
 *    small "G" badge on the midpoint.  Hover/focus → shows a (×) delete handle.
 *    Clicking an edge opens the WorkflowTransitionFormModal to edit its gates.
 *  - Create transition: click the "+" handle on a node (source) → that node
 *    highlights in "connecting" mode → click any other node (target) to POST the
 *    transition.  Clicking the source again cancels.  Keyboard-accessible.
 *  - Read-only mode for non-admins: no "+" handles or delete affordances.
 *
 * Accessibility:
 *  - Nodes and edges have aria-labels.
 *  - Connect handles are real <button>s with labels.
 *  - The visual graph is complemented by the List view (always available).
 *  - prefers-reduced-motion: transition/animation CSS classes use motion-safe.
 *
 * testids:
 *  workflow-graph, workflow-graph-node, workflow-graph-node-start,
 *  workflow-graph-node-${statusId}, workflow-graph-connect-${statusId},
 *  workflow-graph-edge-${from}-${to}, workflow-graph-edge-delete.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { StatusDto, WorkflowTransitionDto } from '@next-lane/shared';
import { StatusCategory } from '@next-lane/shared';
import {
  useAddWorkflowTransition,
  useDeleteWorkflowTransition,
} from '@/api/workflows';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Design tokens (matching DISPATCH system / CardStatusPicker)
// ---------------------------------------------------------------------------

const CATEGORY_DOT_CLASS: Record<string, string> = {
  TODO: 'fill-ink-400',
  IN_PROGRESS: 'fill-signal-600',
  DONE: 'fill-emerald-500',
};

const CATEGORY_STROKE_CLASS: Record<string, string> = {
  TODO: 'stroke-ink-400',
  IN_PROGRESS: 'stroke-signal-400',
  DONE: 'stroke-emerald-400',
};

const CATEGORY_BG_CLASS: Record<string, string> = {
  TODO: 'fill-ink-50 stroke-ink-200',
  IN_PROGRESS: 'fill-signal-50/60 stroke-signal-200',
  DONE: 'fill-emerald-50 stroke-emerald-200',
};

// Note: edge color by source category is not currently used;
// all edges use the neutral ink-400 / signal-500 (hovered) scheme.

const CATEGORY_ORDER: Record<string, number> = {
  TODO: 0,
  IN_PROGRESS: 1,
  DONE: 2,
};

// ---------------------------------------------------------------------------
// Layout constants (SVG coordinate space)
// ---------------------------------------------------------------------------

const NODE_W = 130;
const NODE_H = 52;
const NODE_RX = 8;
const START_R = 22; // radius of the "Start" circle

const COL_GAP = 60;   // horizontal gap between category columns
const ROW_GAP = 24;   // vertical gap between nodes in the same column
const PAD_X = 48;     // left/right padding in SVG
const PAD_Y = 40;     // top/bottom padding in SVG

const ARROW_SIZE = 8;  // arrowhead marker size
const HANDLE_R = 9;    // connect-handle radius

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NodeLayout {
  id: string; // status id or '__start__'
  label: string;
  category: string | null;
  cx: number; // center x
  cy: number; // center y
  isStart: boolean;
}

interface EdgeLayout {
  id: string; // transition id
  fromId: string;
  toId: string;
  transition: WorkflowTransitionDto;
  // midpoint for badge / interaction
  mx: number;
  my: number;
  // path d
  d: string;
}

// ---------------------------------------------------------------------------
// Layout computation
// ---------------------------------------------------------------------------

const START_ID = '__start__';

function computeLayout(statuses: StatusDto[]): NodeLayout[] {
  // Group statuses by category, sort within group by order.
  const byCategory = new Map<string, StatusDto[]>();
  for (const s of statuses) {
    const cat = s.category as string;
    const arr = byCategory.get(cat) ?? [];
    arr.push(s);
    byCategory.set(cat, arr);
  }
  const categories = [StatusCategory.TODO, StatusCategory.IN_PROGRESS, StatusCategory.DONE];
  for (const [key, arr] of byCategory) {
    if (!categories.includes(key as StatusCategory)) {
      categories.push(key as StatusCategory);
    }
    arr.sort((a, b) => a.order - b.order);
  }

  // Build column x-positions (one column per category, plus a "Start" column at left)
  const catCols = categories.filter((c) => byCategory.has(c));
  const colX: number[] = [];
  let x = PAD_X + START_R * 2 + COL_GAP;
  for (let i = 0; i < catCols.length; i++) {
    colX.push(x + NODE_W / 2);
    x += NODE_W + COL_GAP;
  }

  // Compute max column height to center columns vertically.
  const colHeights = catCols.map((cat) => {
    const nodes = byCategory.get(cat) ?? [];
    return nodes.length * NODE_H + Math.max(0, nodes.length - 1) * ROW_GAP;
  });
  const maxH = Math.max(...colHeights, NODE_H);

  const nodes: NodeLayout[] = [];

  // Start node
  const startCy = PAD_Y + maxH / 2;
  nodes.push({
    id: START_ID,
    label: 'Start',
    category: null,
    cx: PAD_X + START_R,
    cy: startCy,
    isStart: true,
  });

  // Status nodes
  for (let ci = 0; ci < catCols.length; ci++) {
    const cat = catCols[ci];
    const statGroup = byCategory.get(cat) ?? [];
    const colHeight =
      statGroup.length * NODE_H + Math.max(0, statGroup.length - 1) * ROW_GAP;
    const colTopY = PAD_Y + (maxH - colHeight) / 2;

    for (let ri = 0; ri < statGroup.length; ri++) {
      const s = statGroup[ri];
      nodes.push({
        id: s.id,
        label: s.name,
        category: s.category as string,
        cx: colX[ci],
        cy: colTopY + ri * (NODE_H + ROW_GAP) + NODE_H / 2,
        isStart: false,
      });
    }
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Arrow path between two nodes
// ---------------------------------------------------------------------------

/** Port on the bounding box of a node that an edge exits/enters from. */
function edgePorts(
  from: NodeLayout,
  to: NodeLayout,
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const isSelf = from.id === to.id;

  if (isSelf) {
    // Self-loop: exit top-right, re-enter top of node
    const isStart = from.isStart;
    const hw = isStart ? START_R : NODE_W / 2;
    const hh = isStart ? START_R : NODE_H / 2;
    return {
      x1: from.cx + hw,
      y1: from.cy - hh / 2,
      x2: from.cx + hw / 2,
      y2: from.cy - hh,
    };
  }

  // Determine which side of 'from' to exit and 'to' to enter.
  // Prefer horizontal if dx is dominant.
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  let x1: number, y1: number, x2: number, y2: number;

  const fromHW = from.isStart ? START_R : NODE_W / 2;
  const fromHH = from.isStart ? START_R : NODE_H / 2;
  const toHW = to.isStart ? START_R : NODE_W / 2;
  const toHH = to.isStart ? START_R : NODE_H / 2;

  if (adx >= ady) {
    // Horizontal
    x1 = from.cx + (dx > 0 ? fromHW : -fromHW);
    y1 = from.cy;
    x2 = to.cx + (dx > 0 ? -toHW : toHW);
    y2 = to.cy;
  } else {
    // Vertical
    x1 = from.cx;
    y1 = from.cy + (dy > 0 ? fromHH : -fromHH);
    x2 = to.cx;
    y2 = to.cy + (dy > 0 ? -toHH : toHH);
  }

  return { x1, y1, x2, y2 };
}

function buildEdgePath(from: NodeLayout, to: NodeLayout): { d: string; mx: number; my: number } {
  if (from.id === to.id) {
    // Self-loop as a small arc above the node
    const r = from.isStart ? START_R : NODE_H / 2;
    const cx = from.cx;
    const cy = from.cy - r;
    const loopR = 20;
    const d = `M ${cx} ${cy} C ${cx + loopR} ${cy - loopR * 2}, ${cx + loopR * 2} ${cy - loopR * 2}, ${cx + loopR * 2} ${cy}`;
    return { d, mx: cx + loopR * 1.5, my: cy - loopR * 1.5 };
  }

  const { x1, y1, x2, y2 } = edgePorts(from, to);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  // Quadratic bezier with a slight curve
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const curveAmt = Math.min(40, len * 0.25);
  // Perpendicular offset
  const px = -dy / (len || 1) * curveAmt;
  const py = dx / (len || 1) * curveAmt;
  const cpx = mx + px;
  const cpy = my + py;

  const d = `M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`;
  return { d, mx: cpx, my: cpy };
}

function computeEdges(
  transitions: WorkflowTransitionDto[],
  nodeMap: Map<string, NodeLayout>,
): EdgeLayout[] {
  return transitions.map((t) => {
    const fromNode = nodeMap.get(t.fromStatusId ?? START_ID);
    const toNode = nodeMap.get(t.toStatusId);
    if (!fromNode || !toNode) {
      return {
        id: t.id,
        fromId: t.fromStatusId ?? START_ID,
        toId: t.toStatusId,
        transition: t,
        mx: 0,
        my: 0,
        d: '',
      };
    }
    const { d, mx, my } = buildEdgePath(fromNode, toNode);
    return {
      id: t.id,
      fromId: t.fromStatusId ?? START_ID,
      toId: t.toStatusId,
      transition: t,
      mx,
      my,
      d,
    };
  });
}

// ---------------------------------------------------------------------------
// SVG viewBox computation
// ---------------------------------------------------------------------------

function computeViewBox(nodes: NodeLayout[]): { viewBox: string; width: number; height: number } {
  if (nodes.length === 0) return { viewBox: '0 0 400 200', width: 400, height: 200 };
  const xs = nodes.flatMap((n) =>
    n.isStart ? [n.cx - START_R, n.cx + START_R] : [n.cx - NODE_W / 2, n.cx + NODE_W / 2],
  );
  const ys = nodes.flatMap((n) =>
    n.isStart ? [n.cy - START_R, n.cy + START_R] : [n.cy - NODE_H / 2, n.cy + NODE_H / 2],
  );
  const minX = Math.min(...xs) - PAD_X;
  const minY = Math.min(...ys) - PAD_Y;
  const maxX = Math.max(...xs) + PAD_X;
  const maxY = Math.max(...ys) + PAD_Y;
  const w = maxX - minX;
  const h = maxY - minY;
  return { viewBox: `${minX} ${minY} ${w} ${h}`, width: w, height: h };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WorkflowGraphProps {
  workflowId: string;
  statuses: StatusDto[];
  transitions: WorkflowTransitionDto[];
  isAdmin: boolean;
  /** Called when user wants to edit a transition (opens form modal). */
  onEditTransition: (t: WorkflowTransitionDto) => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WorkflowGraph({
  workflowId,
  statuses,
  transitions,
  isAdmin,
  onEditTransition,
}: WorkflowGraphProps) {
  const toast = useToast();
  const addTransition = useAddWorkflowTransition(workflowId);
  const deleteTransition = useDeleteWorkflowTransition(workflowId);

  // Connecting-mode state: id of the node the user clicked "+" on.
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  // Hovered edge id
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  // Delete confirm for an edge
  const [deleteTarget, setDeleteTarget] = useState<WorkflowTransitionDto | null>(null);

  // Build layout
  const nodes = computeLayout(statuses);
  const nodeMap = new Map<string, NodeLayout>(nodes.map((n) => [n.id, n]));
  const edges = computeEdges(transitions, nodeMap);
  const { viewBox } = computeViewBox(nodes);

  // SVG ref for keyboard escape
  const svgRef = useRef<SVGSVGElement>(null);

  // Cancel connecting mode on Escape
  useEffect(() => {
    if (!connectingFrom) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setConnectingFrom(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [connectingFrom]);

  const handleConnectHandleClick = useCallback(
    (nodeId: string) => {
      if (!isAdmin) return;
      if (connectingFrom === null) {
        setConnectingFrom(nodeId);
      } else if (connectingFrom === nodeId) {
        // Cancel
        setConnectingFrom(null);
      } else {
        // Create transition
        const fromStatusId = connectingFrom === START_ID ? null : connectingFrom;
        const toStatusId = nodeId === START_ID ? null : nodeId;
        if (!toStatusId) {
          toast.error('Cannot transition to the Start node.');
          setConnectingFrom(null);
          return;
        }
        addTransition.mutate(
          { fromStatusId, toStatusId },
          {
            onSuccess: () => {
              toast.success('Transition added.');
              setConnectingFrom(null);
            },
            onError: (err) => {
              const msg = /409|already|duplicate/i.test(String(err))
                ? 'That transition already exists.'
                : errorMessage(err, 'Could not create the transition.');
              toast.error(msg);
              setConnectingFrom(null);
            },
          },
        );
      }
    },
    [connectingFrom, isAdmin, addTransition, toast],
  );

  function handleDeleteEdge() {
    if (!deleteTarget) return;
    deleteTransition.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success('Transition deleted.');
        setDeleteTarget(null);
      },
      onError: (err) => {
        toast.error(errorMessage(err, 'Could not delete the transition.'));
        setDeleteTarget(null);
      },
    });
  }

  const hasNodes = nodes.length > 0;
  const isConnecting = connectingFrom !== null;

  return (
    <div
      data-testid="workflow-graph"
      className="relative overflow-hidden rounded-xl border border-ink-200 bg-ink-50"
      style={{
        backgroundImage: 'radial-gradient(circle, #c4cad6 1px, transparent 1px)',
        backgroundSize: '20px 20px',
      }}
    >
      {/* Graph area with horizontal scroll containment on mobile */}
      <div className="w-full overflow-x-auto">
        {!hasNodes ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
            <svg className="h-6 w-6 text-ink-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" />
            </svg>
            <p className="text-sm text-ink-500">No statuses defined for this project.</p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={viewBox}
            role="img"
            aria-label="Workflow transition graph"
            className="h-auto w-full min-w-[400px]"
            style={{ display: 'block' }}
          >
            {/* Arrowhead marker definition */}
            <defs>
              <marker
                id={`wg-arrow-${workflowId}`}
                markerWidth={ARROW_SIZE}
                markerHeight={ARROW_SIZE}
                refX={ARROW_SIZE - 1}
                refY={ARROW_SIZE / 2}
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path
                  d={`M 0 0 L ${ARROW_SIZE} ${ARROW_SIZE / 2} L 0 ${ARROW_SIZE} z`}
                  className="fill-ink-400"
                />
              </marker>
              <marker
                id={`wg-arrow-active-${workflowId}`}
                markerWidth={ARROW_SIZE}
                markerHeight={ARROW_SIZE}
                refX={ARROW_SIZE - 1}
                refY={ARROW_SIZE / 2}
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path
                  d={`M 0 0 L ${ARROW_SIZE} ${ARROW_SIZE / 2} L 0 ${ARROW_SIZE} z`}
                  className="fill-signal-500"
                />
              </marker>
              {/* Drop shadow filter for nodes */}
              <filter id={`wg-shadow-${workflowId}`} x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="rgb(17 24 39)" floodOpacity="0.08" />
              </filter>
            </defs>

            {/* Edges (drawn first so they appear behind nodes) */}
            {edges.map((edge) => {
              if (!edge.d) return null;
              const isHovered = hoveredEdge === edge.id;
              const fromLabel =
                edge.fromId === START_ID
                  ? 'Start'
                  : (nodeMap.get(edge.fromId)?.label ?? edge.fromId);
              const toLabel = nodeMap.get(edge.toId)?.label ?? edge.toId;
              const hasGates = edge.transition.gates.length > 0;

              return (
                <g
                  key={edge.id}
                  data-testid={`workflow-graph-edge-${edge.fromId}-${edge.toId}`}
                  aria-label={`Transition from ${fromLabel} to ${toLabel}${hasGates ? ' (has gates)' : ''}`}
                  role="group"
                  onMouseEnter={() => setHoveredEdge(edge.id)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  onFocus={() => setHoveredEdge(edge.id)}
                  onBlur={() => setHoveredEdge(null)}
                  onClick={() => onEditTransition(edge.transition)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Wider invisible hit-target */}
                  <path
                    d={edge.d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                  />
                  {/* Visible path */}
                  <path
                    d={edge.d}
                    fill="none"
                    strokeWidth={isHovered ? 2.5 : 1.5}
                    strokeLinecap="round"
                    className={
                      isHovered
                        ? 'stroke-signal-500 motion-safe:transition-all'
                        : 'stroke-ink-400 motion-safe:transition-all'
                    }
                    markerEnd={`url(#${isHovered ? `wg-arrow-active-${workflowId}` : `wg-arrow-${workflowId}`})`}
                  />

                  {/* Gate badge at midpoint */}
                  {hasGates && (
                    <g>
                      <circle
                        cx={edge.mx}
                        cy={edge.my}
                        r={8}
                        className={
                          isHovered
                            ? 'fill-signal-100 stroke-signal-400'
                            : 'fill-brand-50 stroke-brand-300'
                        }
                        strokeWidth={1}
                      />
                      <text
                        x={edge.mx}
                        y={edge.my + 4}
                        textAnchor="middle"
                        fontSize={8}
                        fontWeight={700}
                        className={isHovered ? 'fill-signal-700' : 'fill-brand-700'}
                      >
                        G
                      </text>
                    </g>
                  )}

                  {/* Delete handle — always in DOM for admin.
                      Visually shown on hover but always focusable/clickable for keyboard + testing.
                      Uses foreignObject so it's a real <button> for a11y. */}
                  {isAdmin && (
                    <foreignObject
                      x={edge.mx + 6}
                      y={edge.my - 20}
                      width={24}
                      height={24}
                      overflow="visible"
                    >
                      <button
                        type="button"
                        data-testid="workflow-graph-edge-delete"
                        aria-label="Delete transition"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(edge.transition);
                        }}
                        style={{ opacity: isHovered ? 1 : 0 }}
                        className={cn(
                          'flex h-6 w-6 items-center justify-center rounded-full',
                          'bg-red-50 border border-red-300 text-red-600 text-xs font-bold',
                          'hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400',
                          'motion-safe:transition-opacity',
                        )}
                      >
                        ×
                      </button>
                    </foreignObject>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {nodes.map((node) => {
              const isSourceNode = connectingFrom === node.id;
              const isTargetCandidate = isConnecting && connectingFrom !== node.id && !node.isStart;
              const catKey = node.category ?? '';

              return (
                <g
                  key={node.id}
                  data-testid={
                    node.isStart
                      ? 'workflow-graph-node-start'
                      : `workflow-graph-node-${node.id}`
                  }
                  aria-label={node.isStart ? 'Start node' : `Status: ${node.label}`}
                  role="group"
                >
                  {/* Target candidate highlight ring */}
                  {isTargetCandidate && (
                    <rect
                      x={node.cx - NODE_W / 2 - 4}
                      y={node.cy - NODE_H / 2 - 4}
                      width={NODE_W + 8}
                      height={NODE_H + 8}
                      rx={NODE_RX + 4}
                      className="fill-signal-100 stroke-signal-400 motion-safe:animate-pulse"
                      strokeWidth={2}
                      fillOpacity={0.7}
                    />
                  )}

                  {node.isStart ? (
                    /* Start node: filled circle with shadow */
                    <circle
                      cx={node.cx}
                      cy={node.cy}
                      r={START_R}
                      className="fill-ink-800 stroke-ink-700"
                      strokeWidth={1.5}
                      filter={`url(#wg-shadow-${workflowId})`}
                    />
                  ) : (
                    /* Status node: rounded rect with shadow */
                    <rect
                      x={node.cx - NODE_W / 2}
                      y={node.cy - NODE_H / 2}
                      width={NODE_W}
                      height={NODE_H}
                      rx={NODE_RX}
                      strokeWidth={isSourceNode ? 2 : 1.5}
                      className={cn(
                        CATEGORY_BG_CLASS[catKey] ?? 'fill-white stroke-ink-200',
                        isSourceNode &&
                          (CATEGORY_STROKE_CLASS[catKey] ?? 'stroke-ink-400'),
                        'motion-safe:transition-all',
                      )}
                      filter={`url(#wg-shadow-${workflowId})`}
                    />
                  )}

                  {/* Node label */}
                  {node.isStart ? (
                    <text
                      x={node.cx}
                      y={node.cy + 4}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={700}
                      className="fill-white select-none"
                    >
                      START
                    </text>
                  ) : (
                    <>
                      {/* Category dot */}
                      <circle
                        cx={node.cx - NODE_W / 2 + 14}
                        cy={node.cy - 8}
                        r={4}
                        className={CATEGORY_DOT_CLASS[catKey] ?? 'fill-ink-400'}
                      />
                      {/* Status name */}
                      <text
                        x={node.cx - NODE_W / 2 + 24}
                        y={node.cy - 4}
                        fontSize={11}
                        fontWeight={600}
                        className="fill-ink-900 select-none"
                      >
                        {truncateLabel(node.label, 13)}
                      </text>
                      {/* Category label */}
                      <text
                        x={node.cx - NODE_W / 2 + 14}
                        y={node.cy + 12}
                        fontSize={9}
                        className="fill-ink-500 select-none"
                      >
                        {catLabel(catKey)}
                      </text>
                    </>
                  )}

                  {/* Connect handle (+ button) — admin only, not in read-only */}
                  {isAdmin && (
                    <ConnectHandle
                      node={node}
                      isSource={isSourceNode}
                      isConnecting={isConnecting}
                      onClick={() => handleConnectHandleClick(node.id)}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Connecting-mode hint bar */}
      {isConnecting && (
        <div
          className={cn(
            'absolute bottom-0 left-0 right-0 rounded-b-xl',
            'bg-signal-50 border-t border-signal-200',
            'px-4 py-2 text-xs text-signal-700 flex items-center justify-between',
          )}
          role="status"
          aria-live="polite"
        >
          <span>
            Click a target node to create a transition from{' '}
            <strong>
              {connectingFrom === START_ID
                ? 'Start (any status)'
                : (nodeMap.get(connectingFrom)?.label ?? connectingFrom)}
            </strong>
            . Press Esc to cancel.
          </span>
          <button
            type="button"
            onClick={() => setConnectingFrom(null)}
            className="ml-4 shrink-0 text-xs font-medium text-signal-700 hover:text-signal-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 rounded"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Empty transitions hint */}
      {hasNodes && transitions.length === 0 && !isConnecting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="rounded-md bg-white/80 px-3 py-1.5 text-xs text-ink-500 shadow-xs">
            {isAdmin
              ? 'Click a node\'s \"+\" handle to draw a transition arrow.'
              : 'No transitions defined yet.'}
          </p>
        </div>
      )}

      {/* Delete confirm dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete transition"
        message={
          <>
            Delete this transition?
          </>
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteTransition.isPending}
        onConfirm={handleDeleteEdge}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connect handle sub-component
// ---------------------------------------------------------------------------

function ConnectHandle({
  node,
  isSource,
  isConnecting,
  onClick,
}: {
  node: NodeLayout;
  isSource: boolean;
  isConnecting: boolean;
  onClick: () => void;
}) {
  // Position the handle at the right edge of the node (or bottom-right for start)
  let hx: number, hy: number;
  if (node.isStart) {
    hx = node.cx + START_R + 2;
    hy = node.cy;
  } else {
    hx = node.cx + NODE_W / 2 + 2;
    hy = node.cy;
  }

  const label = isSource
    ? `Cancel connecting from ${node.label}`
    : `Connect from ${node.isStart ? 'Start' : node.label}`;

  return (
    <foreignObject
      x={hx - HANDLE_R}
      y={hy - HANDLE_R}
      width={HANDLE_R * 2}
      height={HANDLE_R * 2}
      overflow="visible"
    >
      <button
        type="button"
        data-testid={
          node.isStart
            ? 'workflow-graph-connect-start'
            : `workflow-graph-connect-${node.id}`
        }
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cn(
          'flex h-full w-full items-center justify-center rounded-full border text-[10px] font-bold',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400',
          'motion-safe:transition-all duration-100',
          isSource
            ? 'bg-signal-100 border-signal-400 text-signal-700'
            : isConnecting
              ? 'bg-signal-50 border-signal-300 text-signal-600 hover:bg-signal-100'
              : 'bg-white border-ink-300 text-ink-500 hover:bg-signal-50 hover:border-signal-300 hover:text-signal-600',
        )}
      >
        {isSource ? '×' : '+'}
      </button>
    </foreignObject>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CAT_LABELS: Record<string, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
};

function catLabel(cat: string): string {
  return CAT_LABELS[cat] ?? cat;
}

function truncateLabel(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Keep category order constant but suppress unused import warning
const _catOrder = CATEGORY_ORDER;
void _catOrder;
