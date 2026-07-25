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
`;

export function injectTheme(): void {
  if (document.getElementById("olive-folio")) return;
  const style = document.createElement("style");
  style.id = "olive-folio";
  style.textContent = css;
  document.head.appendChild(style);
}
