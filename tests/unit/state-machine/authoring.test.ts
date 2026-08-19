import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    StateMachineEditor,
    AddPlaceCommand,
    AddTransitionCommand,
    DEFAULT_PLACE_SIZE,
    SVG_NS,
} from '../../../src/state-machine/index.js';

/**
 * Authoring a state machine FROM SCRATCH.
 *
 * The editor shipped rename / set-initial / property-edit / remove
 * but **no create path at all** — no `AddPlace`, no `AddTransition`, and
 * a single `click` listener for selection. So a machine could be pruned
 * and re-pointed but never BUILT, while the blank canvas told the author
 * to "Add a place to start modelling your state machine". New machines
 * were only creatable by hand-editing VFS JSON. These cases pin the
 * create half.
 */
describe('state machine authoring (create path)', () => {
    let host: HTMLElement;
    let svg: SVGSVGElement;
    let svgGroup: SVGGElement;
    let editor: StateMachineEditor;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
        svgGroup = document.createElementNS(SVG_NS, 'g') as SVGGElement;
        svg.appendChild(svgGroup);
        document.body.appendChild(svg);
        // No initialModel -> the blank machine an author actually starts from.
        editor = new StateMachineEditor({ host, svgGroup });
    });

    afterEach(() => {
        editor.dispose();
        host.remove();
        svg.remove();
    });

    function addPlace(): string {
        const id = editor.suggestPlaceId();
        editor.commandStack.execute(
            new AddPlaceCommand(editor, {
                id,
                position: editor.suggestPlacePosition(),
                size: DEFAULT_PLACE_SIZE,
            }),
        );
        return id;
    }

    it('builds a deployable machine from an empty canvas', () => {
        expect(editor.state.places).toHaveLength(0);

        const a = addPlace();
        const b = addPlace();
        editor.commandStack.execute(
            new AddTransitionCommand(editor, {
                id: editor.suggestTransitionId(),
                name: `${a}_to_${b}`,
                from: a,
                to: b,
            }),
        );

        expect(editor.state.places.map((p) => p.id)).toEqual([a, b]);
        expect(editor.state.transitions).toHaveLength(1);
        expect(editor.state.transitions[0]).toMatchObject({ from: a, to: b });
    });

    /**
     * A `state_machine` must declare exactly ONE initial place —
     * `validate()` rejects a machine without it. Defaulting the first
     * place keeps a just-built machine deployable instead of failing
     * validation with an error the author has to decode.
     */
    it('marks the FIRST place initial and only the first', () => {
        const a = addPlace();
        expect(editor.findPlace(a)?.initial).toBe(true);

        const b = addPlace();
        expect(editor.findPlace(b)?.initial).toBeUndefined();
        expect(editor.state.places.filter((p) => p.initial === true)).toHaveLength(1);
    });

    it('mints unique ids that do not collide with existing ones', () => {
        const first = addPlace();
        const second = addPlace();
        expect(first).not.toBe(second);

        // Rename to squat on the id the next suggestion would take, and
        // confirm the minter skips past it.
        const squatted = editor.suggestPlaceId();
        editor.renamePlace(second, squatted);
        expect(editor.suggestPlaceId()).not.toBe(squatted);
    });

    it('places a new state clear of existing content', () => {
        addPlace();
        const before = editor.contentBbox()!;
        addPlace();
        const placed = editor.state.places[1]!;
        expect(placed.position.x).toBeGreaterThanOrEqual(before.right);
    });

    it('undo removes what was added, redo puts it back', () => {
        const a = addPlace();
        const b = addPlace();
        editor.commandStack.execute(
            new AddTransitionCommand(editor, {
                id: 't_1', name: 'go', from: a, to: b,
            }),
        );
        expect(editor.state.transitions).toHaveLength(1);

        editor.commandStack.undo();
        expect(editor.state.transitions).toHaveLength(0);
        expect(editor.state.places).toHaveLength(2);

        editor.commandStack.undo();
        expect(editor.state.places).toHaveLength(1);
        // The surviving place must still be the initial one.
        expect(editor.state.places[0]!.initial).toBe(true);

        editor.commandStack.redo();
        expect(editor.state.places).toHaveLength(2);
    });

    it('undoing the first place leaves a genuinely empty machine', () => {
        addPlace();
        editor.commandStack.undo();
        expect(editor.state.places).toHaveLength(0);
        expect(editor.state.transitions).toHaveLength(0);
    });
});
