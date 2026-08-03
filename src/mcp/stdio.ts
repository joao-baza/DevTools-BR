import { createMcpServer } from "./server.js";

const server = createMcpServer();
await server.startStdio();
