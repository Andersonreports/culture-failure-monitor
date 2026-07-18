import { join } from "node:path";
import express from "express";
import config from "./config.ts";
import failuresRoute from "./routes/failures.ts";
import authRoute from "./routes/auth.ts";

const app = express();
app.use(express.json());
app.use(express.static(join(import.meta.dirname!, "..", "public")));

app.use("/api/failures", failuresRoute);
app.use("/auth", authRoute);

app.listen(Number(config.port), () => {
  console.log(`Culture Failure Monitor running at http://localhost:${config.port}`);
});
