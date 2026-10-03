import DialogProvider from "./components/Dialogs";
import LegalGate from "./components/LegalGate";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./ui.css";
import "./redesign.css";

ReactDOM.createRoot(
    document.getElementById("root")!
).render(
    <React.StrictMode>
        <DialogProvider><LegalGate><App /></LegalGate></DialogProvider>
    </React.StrictMode>
);