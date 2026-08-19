import { Emitter } from '../internal/Emitter.js';

/**
 * A reversible operation against the editor's model. Surface-specific
 * code (BPMN add-element, DMN add-row, etc.) ships its own Command
 * implementations against the CommandStack — each must round-trip
 * `apply()` + `revert()` cleanly without side effects in the wrong
 * direction.
 *
 * Commands are responsible for capturing whatever inverse state they
 * need before `apply()` runs -- the stack does NOT serialize model
 * snapshots, so commands that delete data must hold onto the deleted
 * payload internally to restore it on `revert()`.
 */
export interface Command {
    /** Apply the command. Called on initial execute + redo. Must be idempotent w.r.t. apply→revert→apply. */
    apply(): void;
    /** Revert the command. Must restore the state apply() mutated. */
    revert(): void;
    /** Short human-readable label. Useful for tooltips + debugger output ("Undo: Delete user task"). */
    readonly label: string;
}

interface CommandStackEvents extends Record<string, unknown> {
    /** Fired after every execute/undo/redo/clear. Carries no payload — subscribers read state via the getters. */
    change: void;
}

/**
 * Undo/redo command stack with capped history. Standard memento pattern:
 * `execute(cmd)` runs apply() + records the command. `undo()` pops + reverts.
 * `redo()` pops the redo stack + re-applies.
 *
 * Any new `execute()` clears the redo stack — once you've branched off
 * the timeline, the future is gone.
 *
 * History size is bounded by `limit` (default 100). When exceeded, the
 * oldest entry is dropped (FIFO truncation). This keeps memory bounded
 * even for long editing sessions with many mutations.
 */
export class CommandStack {
    private readonly emitter = new Emitter<CommandStackEvents>();
    private undoStack: Command[] = [];
    private redoStack: Command[] = [];
    private readonly limit: number;

    constructor(options: { limit?: number } = {}) {
        this.limit = Math.max(1, options.limit ?? 100);
    }

    /**
     * Run + record a command. Throws if the command's `apply()` throws --
     * in that case the command is NOT recorded (the user sees the error
     * and the model stays in its pre-command state).
     */
    execute(command: Command): void {
        command.apply();
        this.undoStack.push(command);
        if (this.undoStack.length > this.limit) {
            this.undoStack.shift();
        }
        this.redoStack = [];
        this.emitter.emit('change', undefined);
    }

    /**
     * Undo the most recent command. Returns true if a command was reverted,
     * false if the stack was already empty.
     */
    undo(): boolean {
        const cmd = this.undoStack.pop();
        if (!cmd) return false;
        cmd.revert();
        this.redoStack.push(cmd);
        this.emitter.emit('change', undefined);
        return true;
    }

    /**
     * Redo the most recently undone command. Returns true if a command was
     * re-applied, false if the redo stack was empty.
     */
    redo(): boolean {
        const cmd = this.redoStack.pop();
        if (!cmd) return false;
        cmd.apply();
        this.undoStack.push(cmd);
        this.emitter.emit('change', undefined);
        return true;
    }

    /** Wipe both stacks. Used on model replace (load a different file). */
    clear(): void {
        const had = this.undoStack.length > 0 || this.redoStack.length > 0;
        this.undoStack = [];
        this.redoStack = [];
        if (had) {
            this.emitter.emit('change', undefined);
        }
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /** Label of the next undo step. `null` when empty — toolbar can render "Undo (Cmd+Z)" disabled. */
    get nextUndoLabel(): string | null {
        const top = this.undoStack[this.undoStack.length - 1];
        return top?.label ?? null;
    }

    /** Label of the next redo step. `null` when empty. */
    get nextRedoLabel(): string | null {
        const top = this.redoStack[this.redoStack.length - 1];
        return top?.label ?? null;
    }

    /** Subscribe to change events. Returns an unsubscribe thunk. */
    onChange(listener: () => void): () => void {
        return this.emitter.on('change', listener);
    }

    dispose(): void {
        this.undoStack = [];
        this.redoStack = [];
        this.emitter.dispose();
    }
}
