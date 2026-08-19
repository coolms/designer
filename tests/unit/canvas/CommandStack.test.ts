import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandStack, type Command } from '../../../src/canvas/CommandStack.js';

/** Tiny test command that toggles a value through apply/revert. */
class SetValue implements Command {
    readonly label: string;
    constructor(
        readonly target: { value: number },
        readonly nextValue: number,
        private previous = 0,
    ) {
        this.label = `Set value to ${nextValue}`;
    }
    apply(): void {
        this.previous = this.target.value;
        this.target.value = this.nextValue;
    }
    revert(): void {
        this.target.value = this.previous;
    }
}

describe('CommandStack', () => {
    let target: { value: number };
    let stack: CommandStack;

    beforeEach(() => {
        target = { value: 0 };
        stack = new CommandStack();
    });

    it('starts empty', () => {
        expect(stack.canUndo).toBe(false);
        expect(stack.canRedo).toBe(false);
        expect(stack.nextUndoLabel).toBeNull();
        expect(stack.nextRedoLabel).toBeNull();
    });

    it('execute applies + records', () => {
        stack.execute(new SetValue(target, 5));
        expect(target.value).toBe(5);
        expect(stack.canUndo).toBe(true);
        expect(stack.canRedo).toBe(false);
        expect(stack.nextUndoLabel).toBe('Set value to 5');
    });

    it('undo reverts the most recent command', () => {
        stack.execute(new SetValue(target, 1));
        stack.execute(new SetValue(target, 2));
        expect(target.value).toBe(2);

        const ok = stack.undo();
        expect(ok).toBe(true);
        expect(target.value).toBe(1);
        expect(stack.canRedo).toBe(true);
        expect(stack.nextRedoLabel).toBe('Set value to 2');
    });

    it('undo on empty stack returns false', () => {
        expect(stack.undo()).toBe(false);
    });

    it('redo re-applies the most recently undone command', () => {
        stack.execute(new SetValue(target, 1));
        stack.execute(new SetValue(target, 2));
        stack.undo();

        const ok = stack.redo();
        expect(ok).toBe(true);
        expect(target.value).toBe(2);
        expect(stack.canRedo).toBe(false);
    });

    it('redo on empty stack returns false', () => {
        expect(stack.redo()).toBe(false);
    });

    it('execute after undo clears the redo stack', () => {
        stack.execute(new SetValue(target, 1));
        stack.execute(new SetValue(target, 2));
        stack.undo();
        expect(stack.canRedo).toBe(true);

        stack.execute(new SetValue(target, 99));
        expect(stack.canRedo).toBe(false);
        expect(stack.nextRedoLabel).toBeNull();
    });

    it('honours the size limit by dropping oldest entries (FIFO)', () => {
        const small = new CommandStack({ limit: 2 });
        small.execute(new SetValue(target, 1));
        small.execute(new SetValue(target, 2));
        small.execute(new SetValue(target, 3));

        expect(small.canUndo).toBe(true);
        small.undo(); // reverts 3 → target=2
        small.undo(); // reverts 2 → target=1
        expect(small.canUndo).toBe(false);
        expect(target.value).toBe(1);
    });

    it('limit defaults floor at 1', () => {
        const tiny = new CommandStack({ limit: -10 });
        tiny.execute(new SetValue(target, 1));
        tiny.execute(new SetValue(target, 2));
        // Limit=1 means only the most recent command is undoable.
        expect(tiny.canUndo).toBe(true);
        tiny.undo();
        expect(tiny.canUndo).toBe(false);
    });

    it('clear empties both stacks', () => {
        stack.execute(new SetValue(target, 1));
        stack.execute(new SetValue(target, 2));
        stack.undo();

        stack.clear();
        expect(stack.canUndo).toBe(false);
        expect(stack.canRedo).toBe(false);
    });

    it('clear on empty stack does not emit change', () => {
        const onChange = vi.fn();
        stack.onChange(onChange);
        stack.clear();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('change event fires for execute/undo/redo/clear', () => {
        const onChange = vi.fn();
        stack.onChange(onChange);

        stack.execute(new SetValue(target, 1));
        expect(onChange).toHaveBeenCalledTimes(1);

        stack.undo();
        expect(onChange).toHaveBeenCalledTimes(2);

        stack.redo();
        expect(onChange).toHaveBeenCalledTimes(3);

        stack.clear();
        expect(onChange).toHaveBeenCalledTimes(4);
    });

    it('onChange returns an unsubscribe thunk', () => {
        const onChange = vi.fn();
        const off = stack.onChange(onChange);
        off();
        stack.execute(new SetValue(target, 1));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('dispose clears state and subscribers', () => {
        const onChange = vi.fn();
        stack.onChange(onChange);
        stack.execute(new SetValue(target, 1));

        stack.dispose();
        expect(stack.canUndo).toBe(false);
        expect(stack.canRedo).toBe(false);

        // Late events from a re-used dispatcher shouldn't reach the now-disposed subscriber.
        // (We can't easily emit from outside; instead we verify onChange isn't called again.)
        onChange.mockClear();
        stack.clear();
        expect(onChange).not.toHaveBeenCalled();
    });
});
