import { useEffect, useRef } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { t } from "../copy.js";
import { ApiFault } from "../api.js";
import { commandAt } from "../terminal/grammar.js";
import { parseLine } from "../terminal/parse.js";
import { BINDINGS } from "../terminal/bindings.js";

/**
 * The browser terminal (expansion Phase 5): xterm is a RENDERER over the
 * bounded Relay command surface — the fixture grammar and the bindings map.
 * There is no shell, no PTY, and no path from input to evaluation: a line
 * becomes tokens, tokens match a fixture command, and the binding calls the
 * same scoped API the rest of the app uses.
 */

const PROMPT = "relay> ";
const BACKSPACE = "\x7f";
const CTRL_C = "\x03";
const ESC = "\x1b";
const CLEAR_LINE = "\x1b[2K\r";

function themeColors() {
  // Derived terminalPanel palette (design/theme.json _provenance).
  return {
    background: "#22241e",
    foreground: "#ece8dc",
    cursor: "#ece8dc",
    selectionBackground: "#4a4f2c",
  };
}

export default function TerminalScreen() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Xterm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
      fontSize: 14,
      theme: themeColors(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();
    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);

    let buffer = "";
    let running = false;
    const history: string[] = [];
    let historyIndex = -1;

    const rewriteLine = (next: string) => {
      term.write(`${CLEAR_LINE}${PROMPT}${next}`);
      buffer = next;
    };

    term.writeln(t("terminal.welcome"));
    term.write(PROMPT);

    const dispatch = async (line: string) => {
      const parsed = parseLine(line);
      switch (parsed.kind) {
        case "empty":
          break;
        case "local": {
          if (parsed.name === "clear") {
            term.clear();
            break;
          }
          if (parsed.name === "history") {
            for (const entry of history) term.writeln(entry);
            break;
          }
          // help [command]
          const target = parsed.args.join(" ");
          if (target) {
            const command = commandAt(target);
            if (command) {
              // The fixture usage text VERBATIM — same bytes as `--help` (I3).
              for (const usageLine of command.usage.split("\n")) term.writeln(usageLine);
            } else {
              term.writeln(t("terminal.unknown", { command: target }));
            }
          } else {
            term.writeln(t("terminal.help.heading"));
            for (const path of Object.keys(BINDINGS)) {
              const command = commandAt(path);
              term.writeln(`  ${path.padEnd(22)} ${command?.summary ?? ""}`);
            }
            term.writeln(t("terminal.help.locals"));
          }
          break;
        }
        case "unknown":
          term.writeln(t("terminal.unknown", { command: parsed.word }));
          if (parsed.suggestion) {
            term.writeln(t("terminal.suggestion", { command: parsed.suggestion }));
          }
          break;
        case "run": {
          const binding = BINDINGS[parsed.command.path];
          if (!binding) {
            term.writeln(
              parsed.command.path === "files upload"
                ? t("terminal.upload_pointer")
                : t("terminal.unbound", { command: parsed.command.path }),
            );
            break;
          }
          if (parsed.flagError || parsed.positionals.length < binding.positionals.length) {
            term.writeln(t("terminal.bad_args"));
            for (const usageLine of parsed.command.usage.split("\n").slice(0, 2)) {
              term.writeln(usageLine);
            }
            break;
          }
          try {
            const lines = await binding.run(parsed.positionals, parsed.flags);
            for (const outputLine of lines) term.writeln(outputLine);
          } catch (e) {
            // API errors surface their registry copy, same as every screen.
            term.writeln(t(e instanceof ApiFault ? e.copyId : "error.generic.internal"));
          }
          break;
        }
      }
    };

    const disposable = term.onData((data) => {
      if (running) return; // one command at a time
      if (data.startsWith(ESC)) {
        // Arrow keys arrive as one escape-sequence chunk.
        if (data.includes("[A") && history.length > 0) {
          historyIndex = Math.max(0, historyIndex - 1);
          rewriteLine(history[historyIndex] ?? "");
        } else if (data.includes("[B")) {
          historyIndex = Math.min(history.length, historyIndex + 1);
          rewriteLine(history[historyIndex] ?? "");
        }
        return;
      }
      for (const ch of data) {
        if (ch === "\r") {
          const line = buffer;
          buffer = "";
          term.writeln("");
          if (line.trim().length > 0) {
            history.push(line);
            historyIndex = history.length;
          }
          running = true;
          void dispatch(line).finally(() => {
            running = false;
            term.write(PROMPT);
          });
        } else if (ch === BACKSPACE) {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            term.write("\b \b");
          }
        } else if (ch === CTRL_C) {
          buffer = "";
          term.write(`^C\r\n${PROMPT}`);
        } else if (ch >= " ") {
          buffer += ch;
          term.write(ch);
        }
      }
    });

    return () => {
      window.removeEventListener("resize", onResize);
      disposable.dispose();
      term.dispose();
    };
  }, []);

  return (
    <section>
      <h1>{t("nav.terminal")}</h1>
      <div className="terminal-panel">
        <div ref={containerRef} style={{ height: "60vh" }} />
      </div>
    </section>
  );
}
