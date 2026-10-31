import "@gooddealer/ui/tokens.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { DesignHost } from "./design-host";
import "./design-host.css";

const root = document.getElementById("root");
if (root === null) throw new Error("design host root element is missing");

createRoot(root).render(
  <StrictMode>
    <DesignHost />
  </StrictMode>,
);
