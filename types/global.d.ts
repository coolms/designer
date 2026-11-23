// The <script>-tag build (dist/coolms-designer.global.js) puts the package's whole public API on window.CoolmsDesigner:
// the same exports as the module entry. Copied into dist/ by the build.
export {};

declare global {
    var CoolmsDesigner: typeof import('./index.js');
}
