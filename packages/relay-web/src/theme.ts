/**
 * Olive Folio (design/theme.json). elementStyles is the operator's verbatim
 * content spec; palette/componentStyles are the derived chrome tokens — both
 * are emitted verbatim into one stylesheet, never edited here (design/README.md).
 * Content elements are scoped under `.content`; chrome gets utility classes.
 */
import theme from "../../../design/theme.json";

const e = theme.elementStyles;
const c = theme.componentStyles;

const css = `
body { margin: 0; ${theme.baseStyles} }
.content h1 { ${e.h1} }
.content h2 { ${e.h2} }
.content h3 { ${e.h3} }
.content h4 { ${e.h4} }
.content p { ${e.p} }
.content a { ${e.a} }
.content blockquote { ${e.blockquote} }
.content hr { ${e.hr} }
.content ul { ${e.ul} }
.content ol { ${e.ol} }
.content li { ${e.li} }
.content table { ${e.table} }
.content thead { ${e.thead} }
.content th { ${e.th} }
.content td { ${e.td} }
.content tbody tr:nth-child(odd) { ${e.tableOddRow} }
.content tbody tr:nth-child(even) { ${e.tableEvenRow} }
.content code { ${e.codeInline} }
.content pre { ${e.pre} }
.content pre code { ${e.codeBlock} }
.btn-primary { ${c.buttonPrimary} }
.btn-primary:hover { ${c.buttonPrimaryHover} }
.btn-secondary { ${c.buttonSecondary} }
.btn-secondary:hover { ${c.buttonSecondaryHover} }
.btn-primary:disabled, .btn-secondary:disabled { ${c.buttonDisabled} }
.input { ${c.input} }
.input:focus { ${c.inputFocus} }
.input::placeholder { ${c.inputPlaceholder} }
a:focus-visible, button:focus-visible, input:focus-visible { ${c.focusRing} }
.card { ${c.cardSurface} }
.status-error { ${c.statusError} }
.status-success { ${c.statusSuccess} }
.empty { ${c.emptyState} }
.loading { ${c.loadingState} }

/* App shell (expansion Phase 3). Layout is structural CSS; every color/font
   comes from the theme tokens above it. */
.shell { display: flex; min-height: 100vh; }
.shell-sidebar { ${c.sidebar} width: 180px; flex-shrink: 0; box-sizing: border-box; }
.shell-brand { ${c.brand} display: block; margin: 0 0.8em 1em; }
.shell-nav a { ${c.navItem} }
.shell-nav a:hover { ${c.navItemHover} }
.shell-nav a[aria-current="page"] { ${c.navItemActive} }
.shell-main { flex: 1; min-width: 0; padding: 1.5rem 1.5rem 4rem; box-sizing: border-box; }
.shell-context { ${c.contextHeader} margin-bottom: 1.2em; }
.surface-reading { max-width: 720px; margin: 0 auto; }
.surface-wide { max-width: 960px; margin: 0 auto; }
.surface-fluid { max-width: none; }
.terminal-panel { ${c.terminalPanel} }
.shell-menu-toggle { display: none; }
@media (max-width: 719px) {
  .shell { display: block; }
  .shell-sidebar { width: auto; border-right: none; border-bottom: 1px solid ${theme.palette.border}; padding: 0.7em 0.8em; }
  .shell-menu-toggle { display: inline-block; }
  .shell-nav { display: none; }
  .shell-nav.open { display: block; }
  .shell-main { padding: 1rem 1rem 3rem; }
}
@media (prefers-reduced-motion: no-preference) {
  .shell-nav a { transition: background-color 120ms ease; }
}
`;

export function injectTheme(): void {
  if (document.getElementById("olive-folio")) return;
  const style = document.createElement("style");
  style.id = "olive-folio";
  style.textContent = css;
  document.head.appendChild(style);
}
