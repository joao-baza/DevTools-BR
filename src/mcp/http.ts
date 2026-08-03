import { createServer, type ServerResponse } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { buildMcpSdkServer } from "./server.js";

const port = Number(process.env.MCP_HTTP_PORT ?? 3001);
const host = process.env.MCP_HTTP_HOST ?? process.env.HOST ?? "127.0.0.1";
const handler = createMcpHandler(() => buildMcpSdkServer(), { responseMode: "json" });
const nodeHandler = toNodeHandler(handler);
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

function handleNodeHandlerError(error: unknown, response: ServerResponse) {
  if (!response.destroyed && !response.headersSent) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Internal server error");
    return;
  }

  if (!response.destroyed) {
    response.end();
  }

  console.error(error);
}

const server = createServer((request, response) => {
  if (request.url !== "/mcp") {
    response.statusCode = 404;
    response.end("Not found");
    return;
  }
  if (!validateHost(request, response) || !validateOrigin(request, response)) {
    return;
  }
  void nodeHandler(request, response).catch((error: unknown) => handleNodeHandlerError(error, response));
});

server.listen(port, host, () => {
  console.log(`MCP HTTP listening on http://${host}:${port}/mcp`);
});

async function shutdown() {
  try {
    await handler.close();
  } finally {
    server.close(() => process.exit(0));
  }
}

process.once("SIGINT", () => {
  void shutdown();
});

process.once("SIGTERM", () => {
  void shutdown();
});
