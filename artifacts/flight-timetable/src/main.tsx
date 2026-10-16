import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";

// When deploying the frontend separately (e.g. Netlify), set VITE_API_BASE_URL
// to the URL of your API server (e.g. https://your-app.replit.app).
// In Replit's unified deployment this is left unset and relative paths are used.
const apiBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
if (apiBase) {
  setBaseUrl(apiBase.replace(/\/$/, ""));
}

createRoot(document.getElementById("root")!).render(<App />);
