import { useEffect, useState } from "react";
import { t } from "./copy.js";
import { ProjectList } from "./screens/ProjectList.js";
import { ProjectDetail } from "./screens/ProjectDetail.js";
import { Health } from "./screens/Health.js";

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
  const projectMatch = /^#\/projects\/([a-z0-9_]+)$/.exec(hash);

  let screen = <ProjectList />;
  if (projectMatch) screen = <ProjectDetail projectId={projectMatch[1] as string} />;
  else if (hash === "#/health") screen = <Health />;

  return (
    <main
      className="content"
      style={{ maxWidth: 720, margin: "0 auto", padding: "1.5rem 1rem 4rem" }}
    >
      <p>
        <a href="#/">{t("app.title")}</a>
      </p>
      {screen}
    </main>
  );
}
