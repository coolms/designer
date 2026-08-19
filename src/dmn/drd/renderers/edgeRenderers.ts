import type { DmnDrdElement, DmnInformationRequirement } from '../types.js';
import { requirementSegment } from './geometry.js';
import { svgEl, SVG_NS } from './svg.js';

/**
 * M4.j DRD requirement (arrow) renderer + the shared arrowhead
 * `<marker>`.
 *
 * Mirrors the transition-renderer contract: a pure function taking
 * the requirement + its resolved source/target nodes (the editor
 * resolves ids before calling) + the document + the per-instance
 * arrowhead marker URL, returning the root `<g>` for the requirements
 * paint group.
 *
 * Visual: a straight segment trimmed to the node borders with a filled
 * arrowhead at the target (the requiring decision). DMN information
 * requirements carry no label, so — unlike a state-machine transition —
 * none is painted. M4.j keeps routing straight; orthogonal/waypoint
 * routing is a later enhancement (the renderer contract won't change).
 */
export type RequirementRenderer = (
    requirement: DmnInformationRequirement,
    source: DmnDrdElement,
    target: DmnDrdElement,
    doc: Document,
    markerEndUrl: string,
) => SVGGElement;

export const renderRequirement: RequirementRenderer = (
    requirement,
    source,
    target,
    doc,
    markerEndUrl,
) => {
    const g = doc.createElementNS(SVG_NS, 'g') as SVGGElement;
    g.classList.add('coolms-designer__drd-requirement');
    g.setAttribute('data-requirement-id', requirement.id);
    g.setAttribute('data-requirement-from', requirement.from);
    g.setAttribute('data-requirement-to', requirement.to);

    const seg = requirementSegment(source, target);
    const path = svgEl(doc, 'path', {
        d: `M ${seg.start.x} ${seg.start.y} L ${seg.end.x} ${seg.end.y}`,
        'marker-end': markerEndUrl,
    });
    path.classList.add('coolms-designer__drd-requirement-path');
    g.appendChild(path);

    return g;
};

/**
 * The DOM id of the arrowhead `<marker>` for a given editor instance.
 * Suffixed with the per-instance counter so two editors sharing a
 * document don't collide on the marker URL.
 */
export function drdArrowheadMarkerId(instanceId: number): string {
    return `coolms-designer-drd-arrowhead-${instanceId}`;
}

/**
 * Build the arrowhead `<marker>` ready for insertion into the editor's
 * `<defs>`. `orient="auto-start-reverse"` points it along the path's end
 * tangent; `refX` puts the tip exactly at the path endpoint.
 */
export function buildDrdArrowheadMarker(
    doc: Document,
    instanceId: number,
): SVGMarkerElement {
    const marker = svgEl(doc, 'marker', {
        id: drdArrowheadMarkerId(instanceId),
        viewBox: '0 0 10 10',
        refX: '9',
        refY: '5',
        markerWidth: '9',
        markerHeight: '9',
        orient: 'auto-start-reverse',
    });
    marker.classList.add('coolms-designer__drd-arrowhead');
    const tri = svgEl(doc, 'path', { d: 'M 0 0 L 10 5 L 0 10 Z' });
    marker.appendChild(tri);
    return marker;
}
