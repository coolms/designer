import type {
    BpmnElement,
    BpmnPosition,
    BpmnSequenceFlow,
} from '../types.js';
import { computeOrthogonalRoute, waypointsToPathD } from './routing.js';
import { SVG_NS, svgEl } from './svg.js';

/**
 * SequenceFlow renderer.
 *
 * Reads the flow's source + target elements (the editor resolves the
 * ids before calling) + the flow's optional manual waypoints +
 * paints a single `<path>` with the `marker-end` attribute pointing
 * at a per-editor `<defs>`-mounted arrowhead. Returns the root `<g>`
 * the editor appends into the flows group.
 *
 * **Two paint paths**:
 *  - **Manual waypoints** (`flow.waypoints` set) -- the editor's
 *    user has explicitly routed the edge; we paint exactly what
 *    they set. The auto-router is bypassed.
 *  - **Auto-routed** (`flow.waypoints` absent or empty) -- the
 *    {@link computeOrthogonalRoute} algorithm produces a 4-waypoint
 *    Z-route from source-edge to target-edge.
 *
 * **Default-flow marker**: when `flow.isDefault === true` the
 * renderer adds a small diagonal "/" marker near the source-exit
 * waypoint (BPMN convention for the exclusive-gateway default
 * outgoing flow). The marker is a short `<path>` perpendicular to
 * the flow's first segment, ~6 px long.
 *
 * **Condition label**: the property panel
 * will surface `flow.condition` as an inline `[condition]` text
 * element placed at the route's midpoint. The base path renderer
 * paints without the label.
 */
export type EdgeRenderer = (
    flow: BpmnSequenceFlow,
    source: BpmnElement,
    target: BpmnElement,
    doc: Document,
    markerEndUrl: string,
) => SVGGElement;

/**
 * Resolve the waypoint chain for a flow -- manual override if the
 * model carries one, else the auto-router output. Always returns
 * at least the source-exit + target-entry points (the auto-router
 * guarantees 4 points; manual waypoints with fewer than 2 entries
 * fall back to auto-routing because there's no geometry to paint
 * otherwise).
 */
function resolveWaypoints(
    flow: BpmnSequenceFlow,
    source: BpmnElement,
    target: BpmnElement,
): BpmnPosition[] {
    if (flow.waypoints !== undefined && flow.waypoints.length >= 2) {
        return [...flow.waypoints];
    }
    return computeOrthogonalRoute(source, target);
}

/**
 * Paint the default-flow "/" marker -- a short diagonal at the
 * source-exit waypoint, oriented perpendicular to the first
 * segment. Mounted as a sibling `<path>` inside the flow's `<g>`
 * so CSS can target it independently of the main path.
 */
function appendDefaultMarker(
    g: SVGGElement,
    doc: Document,
    waypoints: ReadonlyArray<BpmnPosition>,
): void {
    if (waypoints.length < 2) return;
    const p0 = waypoints[0]!;
    const p1 = waypoints[1]!;
    // Vector along the first segment.
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    // Unit-perpendicular (rotate 90° CCW).
    const px = -dy / len;
    const py = dx / len;
    // Marker centered ~6 px along the segment past p0, total length 8 px.
    const cx = p0.x + (dx / len) * 8;
    const cy = p0.y + (dy / len) * 8;
    const half = 4;
    const x1 = cx - px * half;
    const y1 = cy - py * half;
    const x2 = cx + px * half;
    const y2 = cy + py * half;
    const marker = svgEl(doc, 'path', {
        d: `M ${x1},${y1} L ${x2},${y2}`,
    });
    marker.classList.add('coolms-designer__bpmn-flow-default-marker');
    g.appendChild(marker);
}

/**
 * The single default flow renderer. Painted into the
 * editor's flows group; the editor passes the marker URL so the
 * arrowhead `<defs>` reference is per-instance unique.
 *
 * **Condition rendering** -- when `flow.condition` is set (a non-empty
 * string), paints an inline `[<condition>]` label at the route
 * midpoint so BPMN authors can tell at a glance which exclusive-
 * gateway branch evaluates each expression. The label sits above
 * the route segment + uses a small monospace font. Empty / undefined
 * conditions paint no label.
 */
export const renderSequenceFlow: EdgeRenderer = (
    flow,
    source,
    target,
    doc,
    markerEndUrl,
) => {
    const g = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
    g.classList.add(
        'coolms-designer__bpmn-flow',
        'coolms-designer__bpmn-sequence-flow',
    );
    g.setAttribute('data-flow-id', flow.id);
    g.setAttribute('data-flow-source', flow.source);
    g.setAttribute('data-flow-target', flow.target);

    const waypoints = resolveWaypoints(flow, source, target);
    const d = waypointsToPathD(waypoints);
    const path = svgEl(doc, 'path', {
        d,
        'marker-end': markerEndUrl,
    });
    path.classList.add('coolms-designer__bpmn-flow-path');
    // The path is the click target for interactions; the
    // marker stroke + per-segment thickness live in CSS.
    g.appendChild(path);

    if (flow.isDefault === true) {
        appendDefaultMarker(g, doc, waypoints);
    }

    appendConditionLabel(g, doc, flow, waypoints);

    return g;
};

/**
 * paint the `[<condition>]` inline label at the route's
 * midpoint when `flow.condition` is set. The label sits ABOVE the
 * route segment (y - 6) + is centered horizontally on the midpoint
 * waypoint. Skipped when:
 *  - `condition` is `undefined` or an empty string after trimming
 *    (an empty input field's value rounds-trips back to undefined
 *    via the command, but defensive trim catches the
 *    in-flight typing case)
 *  - `waypoints.length < 2` (no geometry to anchor on)
 *
 * The midpoint is computed as the midpoint between waypoints[1]
 * and waypoints[N-2] when N >= 4 (the route's main horizontal /
 * vertical segment); for N === 2 or 3 the midpoint of the full
 * span is used. The result is approximate but stable -- BPMN
 * modeler convention places condition labels somewhere on the
 * middle of the route + lets authors tweak.
 */
function appendConditionLabel(
    g: SVGGElement,
    doc: Document,
    flow: BpmnSequenceFlow,
    waypoints: ReadonlyArray<BpmnPosition>,
): void {
    if (flow.condition === undefined) return;
    if (flow.condition.trim().length === 0) return;
    if (waypoints.length < 2) return;
    const midpoint = computeRouteMidpoint(waypoints);
    const text = svgEl(doc, 'text', {
        x: `${midpoint.x}`,
        y: `${midpoint.y - 6}`,
        'text-anchor': 'middle',
    });
    text.classList.add('coolms-designer__bpmn-flow-condition');
    text.textContent = `[${flow.condition}]`;
    g.appendChild(text);
}

function computeRouteMidpoint(
    waypoints: ReadonlyArray<BpmnPosition>,
): BpmnPosition {
    if (waypoints.length >= 4) {
        const a = waypoints[1]!;
        const b = waypoints[waypoints.length - 2]!;
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    const a = waypoints[0]!;
    const b = waypoints[waypoints.length - 1]!;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * The DOM id of the arrowhead `<marker>` mounted into the editor's
 * `<defs>`. Suffixed with the editor's per-instance counter so two
 * editors sharing a document don't collide.
 */
export function arrowheadMarkerId(instanceId: number): string {
    return `coolms-designer-arrowhead-${instanceId}`;
}

/**
 * Build the arrowhead `<marker>` element + return it ready for
 * insertion into the editor's `<defs>`. The marker uses
 * `orient="auto-start-reverse"` so it points along the path's end
 * tangent; `refX` is set to the marker tip so the arrowhead's
 * point sits exactly at the path's endpoint (otherwise the tip
 * would land past the endpoint).
 */
export function buildArrowheadMarker(
    doc: Document,
    instanceId: number,
): SVGMarkerElement {
    const marker = svgEl(doc, 'marker', {
        id: arrowheadMarkerId(instanceId),
        viewBox: '0 0 10 10',
        refX: '9',
        refY: '5',
        markerWidth: '10',
        markerHeight: '10',
        orient: 'auto-start-reverse',
    });
    marker.classList.add('coolms-designer__bpmn-arrowhead');
    const tri = svgEl(doc, 'path', {
        d: 'M 0 0 L 10 5 L 0 10 Z',
    });
    marker.appendChild(tri);
    return marker;
}
