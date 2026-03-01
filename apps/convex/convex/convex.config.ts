import actionCache from "@convex-dev/action-cache/convex.config";
import workflow from "@convex-dev/workflow/convex.config.js";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(actionCache);
app.use(workflow);

export default app;
