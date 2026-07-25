import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { injectTheme } from "./theme.js";

injectTheme();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
