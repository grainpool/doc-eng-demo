import { useEffect, useState, type ReactNode } from "react";
import { AppShell } from "./shell/AppShell.js";
import { resolveRoute } from "./shell/routes.js";
import { ProjectList } from "./screens/ProjectList.js";
import { ProjectDetail } from "./screens/ProjectDetail.js";
import { Session } from "./screens/Session.js";
import { ArtifactDetail } from "./screens/ArtifactDetail.js";
import { ChatPlaceholder } from "./screens/ChatPlaceholder.js";
import { TerminalPlaceholder } from "./screens/TerminalPlaceholder.js";
import { AnalysisEntry } from "./screens/AnalysisEntry.js";
import { ArtifactsBrowse } from "./screens/ArtifactsBrowse.js";
import { Settings } from "./screens/Settings.js";

function useHashRoute(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export function App() {
  const hash = useHashRoute();
  const route = resolveRoute(hash);

  useEffect(() => {
    if ("redirect" in route) location.hash = route.redirect;
  }, [route]);
  if ("redirect" in route) return null;

  let screen: ReactNode;
  switch (route.screen.kind) {
    case "chat":
      screen = <ChatPlaceholder />;
      break;
    case "projects":
      screen = <ProjectList />;
      break;
    case "project":
      screen = <ProjectDetail projectId={route.screen.id} />;
      break;
    case "analysis":
      screen = <AnalysisEntry />;
      break;
    case "session":
      screen = <Session sessionId={route.screen.id} />;
      break;
    case "terminal":
      screen = <TerminalPlaceholder />;
      break;
    case "artifacts":
      screen = <ArtifactsBrowse />;
      break;
    case "artifact":
      screen = <ArtifactDetail artifactId={route.screen.id} />;
      break;
    case "settings":
      screen = <Settings />;
      break;
  }

  return (
    <AppShell section={route.section} width={route.width}>
      {screen}
    </AppShell>
  );
}
