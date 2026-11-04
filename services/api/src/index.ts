import { openDatabase } from "./db/client.js";
import { buildServer } from "./http/server.js";

const DB_PATH = process.env.OBSCURA_DB_PATH ?? "./obscura.sqlite";
const PORT = Number(process.env.PORT ?? 8787);

const db = openDatabase(DB_PATH);
const app = await buildServer(db, { corsOrigin: process.env.CORS_ORIGIN });

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`OBSCURA API listening on :${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
