import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@jekrch/react-viewport-lightbox/styles.css";
import "./index.css";
import App from "./App";
import { registerSW } from "./registerSW.ts";

// Clickjacking guard. A `<meta>` CSP can't set `frame-ancestors` and GitHub
// Pages can't send X-Frame-Options, so framing is otherwise unmitigated — which
// matters because signed-in users can trigger irreversible, sensitive actions
// (publish a garden to the public, delete a garden). If we're framed by a
// different origin, break out to the top. Wrapped in try/catch: reading
// `top.location` cross-origin throws, and that throw is itself proof we're
// framed by a foreign origin, so treat it the same as a mismatch.
try {
  if (window.top && window.top !== window.self) {
    window.top.location = window.self.location.href;
  }
} catch {
  window.location.href = "about:blank";
}

registerSW();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
