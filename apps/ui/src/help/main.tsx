import "@fontsource/jost/400.css";
import "@fontsource/jost/500.css";
import "@fontsource/jost/600.css";
import "./help.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HelpWindow } from "./HelpWindow";

const root = document.getElementById("root");
if (!root) throw new Error("ClipCat: #root is missing from help.html");

createRoot(root).render(
  <StrictMode>
    <HelpWindow />
  </StrictMode>,
);
