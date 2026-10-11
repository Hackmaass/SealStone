import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Fonts are bundled (offline). Only the weights the design uses.
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./ui/tokens.css";
import "./ui/app.css";
import "./ui/extra.css";
import "./ui/vault.css";
import "./ui/theme.css";
import "./ui/pages.css";
import "./ui/responsive.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
