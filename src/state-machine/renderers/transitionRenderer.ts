import type { SmPlace, SmTransition } from '../types.js';
import { transitionSegment } from './geometry.js';
import { svgEl, SVG_NS } from './svg.js';

/**
 * transition (arrow) renderer + the shared arrowhead `<marker>`.
 *
 * Mirrors the bpmn-lite edge-renderer contract: a pure function taking
 * the transition + its resolved source/target places (the editor
 * resolves ids before calling) + the document + the per-instance
 * arrowhead marker URL, returning the root `<g>` for the transitions
 * paint group.
 *
 * Visual: a straight segment trimmed to the place borders with an
 * arrowhead at the target, plus the transition `name` painted at the
 * midpoint and a small "guard" marker `[ ]` glyph when a guard
 * expression is set. Self-transitions (from === to) draw a loop above
 * the node. Routing stays straight; orthogonal/waypoint routing
 * is a later enhancement (the renderer contract won't change).
 */
export type TransitionRenderer = (
    transition: SmTransition,
    source: SmPlace,
    target: SmPlace,
    doc: Document,
    markerEndUrl: string,
) => SVGGElement;

export const renderTransition: TransitionRenderer = (
    transition,
    source,
    target,
    doc,
    markerEndUrl,
) => {
    const g = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
    g.classList.add('coolms-designer__sm-transition');
    g.setAttribute('data-transition-id', transition.id);
    g.setAttribute('data-transition-name', transition.name);
    g.setAttribute('data-transition-from', transition.from);
    g.setAttribute('data-transition-to', transition.to);

    const seg = transitionSegment(source, target);
    const d = seg.selfLoop
        ? selfLoopPathD(seg.start)
        : `M ${seg.start.x} ${seg.start.y} L ${seg.end.x} ${seg.end.y}`;
    const path = svgEl(doc, 'path', { d, 'marker-end': markerEndUrl });
    path.classList.add('coolms-designer__sm-transition-path');
    g.appendChild(path);

    // Transition name (+ optional guard glyph) at the route midpoint.
    const label = svgEl(doc, 'text', {
        x: `${seg.mid.x}`,
        y: `${seg.mid.y - 6}`,
        'text-anchor': 'middle',
    });
    label.classList.add('coolms-designer__sm-transition-label');
    const hasGuard =
        transition.guard !== undefined && transition.guard.trim().length > 0;
    label.textContent = hasGuard ? `${transition.name} ⟨guard⟩` : transition.name;
    if (hasGuard) {
        label.classList.add('coolms-designer__sm-transition-label--guarded');
    }
    g.appendChild(label);

    return g;
};

/** A small loop above the place for a self-transition (from === to). */
function selfLoopPathD(top: { x: number; y: number }): string {
    const { x, y } = top;
    // Cubic that leaves the top, arcs up-and-over, returns just right of the exit.
    return `M ${x} ${y} C ${x - 36} ${y - 56}, ${x + 36} ${y - 56}, ${x + 6} ${y}`;
}

/**
 * The DOM id of the arrowhead `<marker>` for a given editor instance.
 * Suffixed with the per-instance counter so two editors sharing a
 * document don't collide on the marker URL.
 */
export function smArrowheadMarkerId(instanceId: number): string {
    return `coolms-designer-sm-arrowhead-${instanceId}`;
}

/**
 * Build the arrowhead `<marker>` ready for insertion into the editor's
 * `<defs>`. `orient="auto-start-reverse"` points it along the path's
 * end tangent; `refX` puts the tip exactly at the path endpoint.
 */
export function buildSmArrowheadMarker(
    doc: Document,
    instanceId: number,
): SVGMarkerElement {
    const marker = svgEl(doc, 'marker', {
        id: smArrowheadMarkerId(instanceId),
        viewBox: '0 0 10 10',
        refX: '9',
        refY: '5',
        markerWidth: '9',
        markerHeight: '9',
        orient: 'auto-start-reverse',
    });
    marker.classList.add('coolms-designer__sm-arrowhead');
    const tri = svgEl(doc, 'path', { d: 'M 0 0 L 10 5 L 0 10 Z' });
    marker.appendChild(tri);
    return marker;
}
