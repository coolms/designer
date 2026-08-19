/**
 * requestAnimationFrame batcher. Renderers + viewport + every state-change
 * subscriber call `request()` whenever something visual might need to
 * update; the loop coalesces multiple requests within a single animation
 * frame into ONE invocation of the render callback.
 *
 * This is what keeps a multi-event flurry (e.g. a wheel-zoom that fires
 * viewport.change → renderer should redraw, plus a pointer-move that
 * also pings render) from rendering N times per frame. Coalesce now,
 * paint once.
 *
 * The loop owns its rAF token so `dispose()` correctly cancels pending
 * frames -- without this, a destroyed Canvas could still fire one final
 * render against a detached DOM tree, which is at best wasted work and
 * at worst a null-deref in the renderer's diff logic.
 */
export class RenderLoop {
    private readonly render: () => void;
    private rafToken: number | null = null;
    private disposed = false;

    constructor(render: () => void) {
        this.render = render;
    }

    /**
     * Schedule a render on the next animation frame. Subsequent calls
     * within the same frame are no-ops — the loop fires the render
     * callback exactly once per frame regardless of how many requests
     * arrived.
     */
    request(): void {
        if (this.disposed) return;
        if (this.rafToken !== null) return;
        this.rafToken = requestAnimationFrame(() => {
            this.rafToken = null;
            if (this.disposed) return;
            this.render();
        });
    }

    /**
     * Whether a render is scheduled but not yet fired. Test affordance +
     * a hook for synchronous "is everything settled" checks in future
     * benchmarks.
     */
    get isPending(): boolean {
        return this.rafToken !== null;
    }

    /** Cancel any pending render + release resources. Idempotent. */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.rafToken !== null) {
            cancelAnimationFrame(this.rafToken);
            this.rafToken = null;
        }
    }
}
