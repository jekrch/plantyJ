import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@jekrch/react-viewport-lightbox/styles.css";
import "./index.css";
import App from "./App";
import { registerSW } from "./registerSW.ts";

registerSW();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
