import { createRestServer } from "./server.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const app = createRestServer();

await app.listen({ port, host });
console.log(`REST API listening on http://${host}:${port}`);
