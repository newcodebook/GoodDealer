import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";

const root = document.getElementById("root");
if (root === null) throw new Error("desktop root element is missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
