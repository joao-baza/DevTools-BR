import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryTransport, Protocol, type BaseContext, type CallToolResult, type ReadResourceResult } from "@modelcontextprotocol/server";
import { buildMcpSdkServer, createMcpServer, sdkCatalogUri } from "../../src/mcp/server.js";
import { createCepFixture } from "../helpers/cep-fixture.js";

const expectedResourceUris = [
  sdkCatalogUri,
  "devs-clone://schemas/rest-v1",
  "devs-clone://schemas/mcp-v1",
  "devs-clone://reference/states",
  "devs-clone://reference/algorithms"
] as const;

const expectedDocumentOutputFields = {
  generate_cpf: ["cpf", "formatted", "valid"],
  validate_cpf: ["cpf", "formatted", "valid", "message"],
  generate_cnpj: ["cnpj", "formatted", "format", "valid"],
  validate_cnpj: ["cnpj", "formatted", "format", "valid", "message"],
  generate_cnh: ["cnh", "valid"],
  validate_cnh: ["cnh", "valid", "message"],
  generate_rg: ["rg", "formatted", "valid"],
  validate_rg: ["rg", "formatted", "valid", "message"],
  generate_pis_pasep: ["pisPasep", "formatted", "valid"],
  validate_pis_pasep: ["pisPasep", "formatted", "valid", "message"],
  generate_renavam: ["renavam", "valid"],
  validate_renavam: ["renavam", "valid", "message"],
  lookup_cep: ["cep", "formatted", "valid", "message", "address", "complement", "neighborhood", "city", "state", "uf", "numberValidation"],
  list_states: ["states"],
  list_cities: ["uf", "query", "cities", "total", "hasMore"]
} as const;

class TestMcpClient extends Protocol<BaseContext> {
  protected buildContext(ctx: BaseContext): BaseContext {
    return ctx;
  }

  protected assertCapabilityForMethod(): void {}
  protected assertNotificationCapability(): void {}
  protected assertRequestHandlerCapability(): void {}
}

function outputPropertyNames(tool: unknown): string[] {
  const outputSchema = (tool as { outputSchema?: { properties?: Record<string, unknown> } }).outputSchema;
  return Object.keys(outputSchema?.properties ?? {}).sort();
}

describe("MCP v1", () => {
  it("lists v1 tools", () => {
    const server = createMcpServer();
    const tools = server.listToolsForTests();
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toContain("generate_cpf");
    expect(toolNames).toContain("validate_cpf");
    expect(toolNames).toContain("encode_md5");
  });

  it("lists focused v1 tool coverage", () => {
    const server = createMcpServer();
    const toolNames = server.listToolsForTests().map((tool) => tool.name);

    expect(toolNames).toContain("validate_rg");
    expect(toolNames).toContain("decode_base64");
    expect(toolNames).toContain("remove_text_accents");
    expect(toolNames).toContain("analyze_text");
  });

  it("calls a tool with structured content", async () => {
    const server = createMcpServer();
    const result = await server.callToolForTests("generate_cpf", { formatted: true, seed: "mcp-cpf" });

    expect(result.isError).toBe(false);
    expect(result.structuredContent.cpf).toMatch(/^\d{11}$/);
    expect(result.content[0].type).toBe("text");
  });

  it("rejects invalid CPF state through the registered schema", async () => {
    const server = createMcpServer();
    const result = await server.callToolForTests("generate_cpf", { state: "XX" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: "invalid_parameter",
        field: "state"
      }
    });
  });

  it("validates formatted RG values", async () => {
    const server = createMcpServer();
    const result = await server.callToolForTests("validate_rg", { value: "12.345.678-X" });

    expect(result.isError).toBe(false);
    expect(result.structuredContent.valid).toBe(true);
  });

  it("decodes Base64 content with structured and text content", async () => {
    const server = createMcpServer();
    const result = await server.callToolForTests("decode_base64", { base64: "b2zDoQ==" });

    expect(result.isError).toBe(false);
    expect(result.structuredContent.decoded).toBe("olá");
    expect(JSON.parse(result.content[0].text)).toMatchObject({ decoded: "olá" });
  });

  it("removes text accents", async () => {
    const server = createMcpServer();
    const result = await server.callToolForTests("remove_text_accents", { text: "ação" });

    expect(result.isError).toBe(false);
    expect(result.structuredContent.text).toBe("acao");
  });

  it("analyzes text with representative counts", async () => {
    const server = createMcpServer();
    const result = await server.callToolForTests("analyze_text", { text: "Oi mundo\nAzul" });

    expect(result.isError).toBe(false);
    expect(result.structuredContent.words).toBe(3);
    expect(result.structuredContent.lines).toBe(2);
    expect(result.structuredContent.vowels).toBe(6);
  });

  it("returns MCP error results for domain errors", async () => {
    const server = createMcpServer();
    const result = await server.callToolForTests("generate_cnpj", { format: "alphanumeric" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: "invalid_parameter",
        field: "format"
      }
    });
  });

  it("throws local helper errors for unknown tools", async () => {
    const server = createMcpServer();

    await expect(server.callToolForTests("missing_tool", {})).rejects.toThrow("Unknown MCP tool: missing_tool");
  });

  it("reads catalog resource", async () => {
    const server = createMcpServer();
    const resource = await server.readResourceForTests(sdkCatalogUri);
    const legacyResource = await server.readResourceForTests("4devs-clone://catalog/tools");

    expect(resource.text).toContain("generate_cpf");
    expect(resource.mimeType).toBe("application/json");
    expect(JSON.parse(resource.text)).toMatchObject({ version: "v1" });
    expect(Array.isArray(JSON.parse(resource.text).tools)).toBe(true);
    expect(legacyResource.text).toBe(resource.text);
  });

  it("reads v1 resource documents through the local helper", async () => {
    const server = createMcpServer();

    for (const uri of expectedResourceUris.slice(1)) {
      const resource = await server.readResourceForTests(uri);
      expect(resource.uri).toBe(uri);
      expect(resource.mimeType).toBe("application/json");
      expect(() => JSON.parse(resource.text)).not.toThrow();
    }
  });

  it("returns SDK validation errors for invalid protocol tool arguments", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new TestMcpClient();
    const server = buildMcpSdkServer();

    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const result = await client.request({
        method: "tools/call",
        params: { name: "generate_cpf", arguments: { state: "XX" } }
      }) as CallToolResult;

      expect(result.isError).toBe(true);
      const content = result.content[0];
      expect(content.type).toBe("text");
      if (content.type === "text") {
        expect(content.text).toContain("Invalid arguments for tool generate_cpf");
        expect(content.text).toContain("state");
      }
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it("serves tools and resources through the SDK protocol path", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new TestMcpClient();
    const server = buildMcpSdkServer();

    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const listed = await client.request({ method: "tools/list" });
      expect(listed.tools.map((tool: { name: string }) => tool.name)).toContain("generate_cpf");
      const toolsByName = new Map(listed.tools.map((tool: { name: string }) => [tool.name, tool]));
      for (const [toolName, expectedFields] of Object.entries(expectedDocumentOutputFields)) {
        const propertyNames = outputPropertyNames(toolsByName.get(toolName));
        expect(propertyNames).toEqual([...expectedFields].sort());
      }
      expect(toolsByName.get("generate_cpf")).toMatchObject({
        outputSchema: {
          properties: {
            cpf: { type: "string" },
            formatted: { type: "string" },
            valid: { type: "boolean" }
          }
        }
      });
      expect(toolsByName.get("validate_rg")).toMatchObject({
        outputSchema: {
          properties: {
            rg: { type: "string" },
            formatted: { type: "string" },
            valid: { type: "boolean" },
            message: { type: "string" }
          }
        }
      });
      expect(toolsByName.get("encode_md5")).toMatchObject({
        outputSchema: {
          properties: {
            md5: { type: "string" }
          }
        }
      });
      expect(toolsByName.get("analyze_text")).toMatchObject({
        outputSchema: {
          properties: {
            characters: { type: "number" },
            charactersWithoutSpaces: { type: "number" },
            words: { type: "number" },
            spaces: { type: "number" },
            lines: { type: "number" },
            vowels: { type: "number" },
            consonants: { type: "number" }
          }
        }
      });

      const generated = await client.request({
        method: "tools/call",
        params: { name: "generate_cpf", arguments: { formatted: true, seed: "protocol-cpf" } }
      }) as CallToolResult;
      const generatedContent = generated.structuredContent as { cpf?: unknown };
      expect(generated.isError).toBe(false);
      expect(generatedContent.cpf).toMatch(/^\d{11}$/);

      const resources = await client.request({ method: "resources/list" });
      const listedUris = resources.resources.map((resource: { uri: string }) => resource.uri);
      expect(listedUris).toEqual(expect.arrayContaining([...expectedResourceUris]));
      expect(resources.resources).toHaveLength(expectedResourceUris.length);
      for (const listedUri of listedUris) {
        expect(() => new URL(listedUri)).not.toThrow();
      }

      for (const listedUri of listedUris) {
        const resource = await client.request({
          method: "resources/read",
          params: { uri: listedUri }
        }) as ReadResourceResult;
        expect(resource.contents[0].mimeType).toBe("application/json");
        const text = "text" in resource.contents[0] ? resource.contents[0].text : "";
        expect(() => JSON.parse(text)).not.toThrow();
        if (listedUri === "devs-clone://schemas/mcp-v1") {
          const mcpSchema = JSON.parse(text) as { tools: Array<{ name: string; outputSchema: { names: string[] } }> };
          const schemaToolsByName = new Map(mcpSchema.tools.map((tool) => [tool.name, tool]));
          for (const [toolName, expectedFields] of Object.entries(expectedDocumentOutputFields)) {
            expect(schemaToolsByName.get(toolName)?.outputSchema.names.sort()).toEqual([...expectedFields].sort());
          }
        }
      }

      const domainError = await client.request({
        method: "tools/call",
        params: { name: "generate_cnpj", arguments: { format: "alphanumeric" } }
      }) as CallToolResult;
      expect(domainError.isError).toBe(true);
      expect(domainError.structuredContent).toMatchObject({
        error: { code: "invalid_parameter", field: "format" }
      });
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});

describe("MCP v1 CEP tools", () => {
  it("lists CEP tools", () => {
    const server = createMcpServer();
    const toolNames = server.listToolsForTests().map((tool) => tool.name);

    expect(toolNames).toContain("lookup_cep");
    expect(toolNames).toContain("list_states");
    expect(toolNames).toContain("list_cities");
  });

  it("looks up a CEP through the tool", async () => {
    const fixture = createCepFixture();
    try {
      const server = createMcpServer({ cepDatabasePath: fixture.databasePath });
      const result = await server.callToolForTests("lookup_cep", { value: "01310930", number: 1200 });

      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({
        cep: "01310930",
        valid: true,
        city: "São Paulo",
        uf: "SP",
        numberValidation: { status: "compatible" }
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("lists states and cities through the tools", async () => {
    const fixture = createCepFixture();
    try {
      const server = createMcpServer({ cepDatabasePath: fixture.databasePath });
      const states = await server.callToolForTests("list_states", {});
      expect(states.isError).toBe(false);
      expect(states.structuredContent.states).toEqual([
        { name: "Minas Gerais", abbreviation: "MG" },
        { name: "São Paulo", abbreviation: "SP" }
      ]);

      const cities = await server.callToolForTests("list_cities", { uf: "SP", query: "sao" });
      expect(cities.isError).toBe(false);
      expect(cities.structuredContent).toMatchObject({ total: 1, cities: ["São Paulo"] });
    } finally {
      fixture.cleanup();
    }
  });

  it("returns cep_database_unavailable error without the database", async () => {
    const server = createMcpServer({ cepDatabasePath: join(tmpdir(), `missing-${process.pid}-${Date.now()}.sqlite`) });
    const result = await server.callToolForTests("lookup_cep", { value: "01001000" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: "cep_database_unavailable" } });
  });

  it("includes CEP tools in the catalog resource", async () => {
    const fixture = createCepFixture();
    try {
      const server = createMcpServer({ cepDatabasePath: fixture.databasePath });
      const resource = await server.readResourceForTests(sdkCatalogUri);

      expect(resource.text).toContain("lookup_cep");
      expect(resource.text).toContain("/api/validators/cep");
    } finally {
      fixture.cleanup();
    }
  });

  it("calls lookup_cep through the SDK protocol path with output validation", async () => {
    const fixture = createCepFixture();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new TestMcpClient();
    const server = buildMcpSdkServer({ cepDatabasePath: fixture.databasePath });

    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const found = await client.request({
        method: "tools/call",
        params: { name: "lookup_cep", arguments: { value: "01310930", number: 1200 } }
      }) as CallToolResult;

      expect(found.isError).toBe(false);
      expect(found.structuredContent).toMatchObject({
        cep: "01310930",
        valid: true,
        city: "São Paulo",
        numberValidation: { status: "compatible", number: 1200 }
      });

      const absent = await client.request({
        method: "tools/call",
        params: { name: "lookup_cep", arguments: { value: "99999999" } }
      }) as CallToolResult;

      expect(absent.isError).toBe(false);
      expect(absent.structuredContent).toMatchObject({ cep: "99999999", valid: false });
    } finally {
      await Promise.all([client.close(), server.close()]);
      fixture.cleanup();
    }
  });
});
