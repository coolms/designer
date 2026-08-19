/**
 * Types for the DMN DRD (Decision Requirements Diagram) editor.
 *
 * A DRD is the *graph* view of a DMN decision model: **Decision** nodes
 * (a rectangle, each ultimately backed by a decision table or other
 * logic) and **InputData** nodes (a stadium, the raw facts a decision
 * consumes), joined by **InformationRequirement** edges — a solid arrow
 * pointing INTO the decision that requires the source. This is the
 * second DMN surface in `@coolms/designer`: the first is the single
 * decision *table* editor, and this adds the requirements *diagram* that
 * stitches several decisions + their inputs together.
 *
 * The shapes mirror the state-machine model (id-keyed nodes +
 * id-keyed edges with `from`/`to`) so the editor + auto-layout +
 * (future) serializer reuse the same patterns. The eventual M4 backend
 * DRD parser (`DmnXmlParser` widened past single tables) + the DMN-XML
 * serializer round-trip against these shapes; the `decisionLogicRef`
 * slot is where a Decision points at its table-editor draft.
 *
 * Not part of the public package API; consumed by `DmnDrdEditor`, the
 * renderers, `autoLayoutDmnDrd`, and the future property panel /
 * serializer.
 */

/**
 * The node kinds the DRD foundation renders. DMN also defines
 * `businessKnowledgeModel` + `knowledgeSource`; those widen the union
 * (one renderer-registry entry each) when a tenant needs them — the
 * two core kinds below are what the M4 backend parser starts with.
 */
export type DmnDrdElementKind = 'decision' | 'inputData';

/** A point in the diagram's world space (pre-viewport-transform). */
export interface DmnDrdPosition {
    readonly x: number;
    readonly y: number;
}

/** A node's bounding-box dimensions. */
export interface DmnDrdSize {
    readonly width: number;
    readonly height: number;
}

/**
 * One DRG node — a Decision or an InputData. `id` is its stable DMN
 * identifier (keyed by the deployer + referenced by requirement edges);
 * `name` is the human-facing label painted inside the shape. `position`
 * + `size` are mutable so the (future) drag-to-move + auto-layout swap
 * them without rebuilding the whole element. `decisionLogicRef` — for a
 * Decision — names the decision-table draft/definition that supplies its
 * logic (the link between the DRD surface + the table surface); absent
 * for InputData.
 */
export interface DmnDrdElement {
    readonly id: string;
    readonly kind: DmnDrdElementKind;
    readonly name: string;
    position: DmnDrdPosition;
    size: DmnDrdSize;
    readonly decisionLogicRef?: string;
    readonly extras?: Readonly<Record<string, unknown>>;
}

/**
 * One InformationRequirement edge. In DMN the data flows FROM the
 * required source (`from` — a Decision or InputData) INTO the requiring
 * decision (`to` — always a Decision), and the arrowhead is drawn at
 * `to`. So `from` is the dependency + `to` the dependent; auto-layout
 * follows this direction left-to-right (inputs on the left, the
 * top-level decision on the right).
 */
export interface DmnInformationRequirement {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly extras?: Readonly<Record<string, unknown>>;
}

/** The DRD model — the full editable surface state. */
export interface DmnDrdModel {
    /** definitionKey — matches the deployed DecisionDefinition.definitionKey. */
    readonly name: string;
    readonly elements: ReadonlyArray<DmnDrdElement>;
    readonly requirements: ReadonlyArray<DmnInformationRequirement>;
    readonly extras?: Readonly<Record<string, unknown>>;
}

/** Default Decision box — a wider rectangle so a table name fits. */
export const DEFAULT_DECISION_SIZE: DmnDrdSize = { width: 168, height: 72 };

/** Default InputData stadium — shorter (it carries just a fact name). */
export const DEFAULT_INPUT_DATA_SIZE: DmnDrdSize = { width: 144, height: 52 };

/** The default box size for a node of the given kind. */
export function defaultSizeForKind(kind: DmnDrdElementKind): DmnDrdSize {
    return kind === 'inputData' ? DEFAULT_INPUT_DATA_SIZE : DEFAULT_DECISION_SIZE;
}

/** An empty DRD model — no nodes, no edges. The scaffold banner shows until the first node lands. */
export function emptyDmnDrdModel(name = 'decision.unnamed'): DmnDrdModel {
    return { name, elements: [], requirements: [] };
}
