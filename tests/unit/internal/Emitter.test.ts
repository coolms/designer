import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../../src/internal/Emitter.js';

interface Events extends Record<string, unknown> {
    data: string;
    count: number;
    ready: void;
}

describe('Emitter', () => {
    it('delivers payloads to subscribed listeners', () => {
        const emitter = new Emitter<Events>();
        const handler = vi.fn();
        emitter.on('data', handler);

        emitter.emit('data', 'hello');

        expect(handler).toHaveBeenCalledWith('hello');
    });

    it('unsubscribes via the returned thunk', () => {
        const emitter = new Emitter<Events>();
        const handler = vi.fn();
        const off = emitter.on('data', handler);

        off();
        emitter.emit('data', 'hello');

        expect(handler).not.toHaveBeenCalled();
    });

    it('unsubscribe is idempotent', () => {
        const emitter = new Emitter<Events>();
        const off = emitter.on('data', () => {});
        off();
        expect(() => off()).not.toThrow();
        expect(emitter.listenerCount('data')).toBe(0);
    });

    it('emit with no listeners is a no-op', () => {
        const emitter = new Emitter<Events>();
        expect(() => emitter.emit('data', 'orphan')).not.toThrow();
    });

    it('allows subscribe-during-emit without disturbing the in-flight pass', () => {
        const emitter = new Emitter<Events>();
        const lateHandler = vi.fn();
        const earlyHandler = vi.fn(() => emitter.on('data', lateHandler));
        emitter.on('data', earlyHandler);

        emitter.emit('data', 'first');

        // earlyHandler fired; lateHandler did NOT because it subscribed mid-pass.
        expect(earlyHandler).toHaveBeenCalledOnce();
        expect(lateHandler).not.toHaveBeenCalled();

        emitter.emit('data', 'second');
        expect(lateHandler).toHaveBeenCalledWith('second');
    });

    it('allows unsubscribe-during-emit without skipping subsequent listeners', () => {
        const emitter = new Emitter<Events>();
        const second = vi.fn();
        let offSelf: (() => void) | null = null;
        offSelf = emitter.on('data', () => offSelf?.());
        emitter.on('data', second);

        emitter.emit('data', 'go');

        expect(second).toHaveBeenCalledWith('go');
    });

    it('rethrows a single listener error after running every listener', () => {
        const emitter = new Emitter<Events>();
        const later = vi.fn();
        emitter.on('data', () => {
            throw new Error('boom');
        });
        emitter.on('data', later);

        expect(() => emitter.emit('data', 'x')).toThrow('boom');
        expect(later).toHaveBeenCalledOnce();
    });

    it('aggregates multiple listener errors into AggregateError', () => {
        const emitter = new Emitter<Events>();
        emitter.on('data', () => {
            throw new Error('a');
        });
        emitter.on('data', () => {
            throw new Error('b');
        });

        try {
            emitter.emit('data', 'x');
            expect.fail('should have thrown');
        } catch (e) {
            expect(e).toBeInstanceOf(AggregateError);
            expect((e as AggregateError).errors).toHaveLength(2);
        }
    });

    it('dispose drops every listener', () => {
        const emitter = new Emitter<Events>();
        const handler = vi.fn();
        emitter.on('data', handler);
        emitter.on('count', () => {});

        emitter.dispose();

        expect(emitter.listenerCount('data')).toBe(0);
        expect(emitter.listenerCount('count')).toBe(0);
        emitter.emit('data', 'after dispose');
        expect(handler).not.toHaveBeenCalled();
    });

    it('reports listenerCount correctly', () => {
        const emitter = new Emitter<Events>();
        expect(emitter.listenerCount('data')).toBe(0);
        emitter.on('data', () => {});
        emitter.on('data', () => {});
        emitter.on('count', () => {});
        expect(emitter.listenerCount('data')).toBe(2);
        expect(emitter.listenerCount('count')).toBe(1);
    });
});
