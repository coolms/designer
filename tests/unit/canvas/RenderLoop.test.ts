import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RenderLoop } from '../../../src/canvas/RenderLoop.js';

describe('RenderLoop', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not fire render until a frame elapses', () => {
        const render = vi.fn();
        const loop = new RenderLoop(render);

        loop.request();
        expect(render).not.toHaveBeenCalled();

        vi.advanceTimersByTime(20);
        expect(render).toHaveBeenCalledOnce();
    });

    it('coalesces multiple requests within the same frame', () => {
        const render = vi.fn();
        const loop = new RenderLoop(render);

        loop.request();
        loop.request();
        loop.request();
        loop.request();

        vi.advanceTimersByTime(20);
        expect(render).toHaveBeenCalledOnce();
    });

    it('a new request after a fired frame schedules another render', () => {
        const render = vi.fn();
        const loop = new RenderLoop(render);

        loop.request();
        vi.advanceTimersByTime(20);
        expect(render).toHaveBeenCalledTimes(1);

        loop.request();
        vi.advanceTimersByTime(20);
        expect(render).toHaveBeenCalledTimes(2);
    });

    it('isPending reflects scheduled state', () => {
        const render = vi.fn();
        const loop = new RenderLoop(render);

        expect(loop.isPending).toBe(false);
        loop.request();
        expect(loop.isPending).toBe(true);

        vi.advanceTimersByTime(20);
        expect(loop.isPending).toBe(false);
    });

    it('dispose cancels a pending render', () => {
        const render = vi.fn();
        const loop = new RenderLoop(render);

        loop.request();
        loop.dispose();
        vi.advanceTimersByTime(20);

        expect(render).not.toHaveBeenCalled();
        expect(loop.isPending).toBe(false);
    });

    it('dispose is idempotent', () => {
        const loop = new RenderLoop(() => {});
        loop.dispose();
        expect(() => loop.dispose()).not.toThrow();
    });

    it('request after dispose is a no-op', () => {
        const render = vi.fn();
        const loop = new RenderLoop(render);
        loop.dispose();
        loop.request();
        vi.advanceTimersByTime(20);
        expect(render).not.toHaveBeenCalled();
    });
});
