import "@gooddealer/ui/tokens.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { CatalogApp } from "./catalog/catalog-app";
import "./visual-fixtures.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Visual fixture root is missing");

createRoot(root).render(
  <StrictMode>
    <CatalogApp />
  </StrictMode>,
);
