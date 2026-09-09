import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import Presence from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Presence />
  </React.StrictMode>
);
