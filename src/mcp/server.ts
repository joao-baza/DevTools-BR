import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { ZodError } from "zod/v4";
import * as z from "zod/v4";
import { DomainError } from "../domain/errors.js";
import { CepRepository, defaultCepDatabasePath } from "../domain/cep-repository.js";
import { brazilianStates } from "../schemas/common.js";
import {
  base64DecodeRequestSchema,
  cepLookupRequestSchema,
  citiesRequestSchema,
  cnpjGenerateRequestSchema,
  cpfGenerateRequestSchema,
  documentValueSchema,
  genericGenerateRequestSchema,
  seededOnlyRequestSchema,
  statesRequestSchema,
  textRequestSchema,
  urlDecodeRequestSchema
} from "../schemas/v1.js";
import { createV1Services, v1Services } from "../services/v1.js";

type StructuredContent = Record<string, unknown>;
type ToolHandler = (args: unknown) => unknown | Promise<unknown>;
type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: StructuredContent;
  isError: boolean;
};
type ResourcePayload = Record<string, unknown> | unknown[];

interface ToolRegistration {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  outputSchema: z.ZodObject<z.ZodRawShape>;
  handler: ToolHandler;
}

interface CatalogResource {
  uri: string;
  name: string;
  title: string;
  mimeType: string;
  text: string;
}

export const catalogUri = "4devs-clone://catalog/tools";
export const sdkCatalogUri = "devs-clone://catalog/tools";

export const resourceUris = [
  sdkCatalogUri,
  "devs-clone://schemas/rest-v1",
  "devs-clone://schemas/mcp-v1",
  "devs-clone://reference/states",
  "devs-clone://reference/algorithms"
] as const;

function toolRegistration<TSchema extends z.ZodObject<z.ZodRawShape>>(registration: Omit<ToolRegistration, "handler" | "inputSchema"> & {
  inputSchema: TSchema;
  handler: (args: z.output<TSchema>) => unknown | Promise<unknown>;
}): ToolRegistration {
  return {
    ...registration,
    handler: (args) => registration.handler(args as z.output<TSchema>)
  };
}

const cpfGeneratorOutputSchema = z.object({
  cpf: z.string(),
  formatted: z.string().optional(),
  valid: z.boolean()
});

const cpfValidatorOutputSchema = z.object({
  cpf: z.string(),
  formatted: z.string().optional(),
  valid: z.boolean(),
  message: z.string().optional()
});

const cnpjGeneratorOutputSchema = z.object({
  cnpj: z.string(),
  formatted: z.string().optional(),
  format: z.literal("numeric"),
  valid: z.boolean()
});

const cnpjValidatorOutputSchema = z.object({
  cnpj: z.string(),
  formatted: z.string().optional(),
  format: z.literal("numeric"),
  valid: z.boolean(),
  message: z.string().optional()
});

const cnhGeneratorOutputSchema = z.object({
  cnh: z.string(),
  valid: z.boolean()
});

const cnhValidatorOutputSchema = z.object({
  cnh: z.string(),
  valid: z.boolean(),
  message: z.string().optional()
});

const rgGeneratorOutputSchema = z.object({
  rg: z.string(),
  formatted: z.string().optional(),
  valid: z.boolean()
});

const rgValidatorOutputSchema = z.object({
  rg: z.string(),
  formatted: z.string().optional(),
  valid: z.boolean(),
  message: z.string().optional()
});

const pisPasepGeneratorOutputSchema = z.object({
  pisPasep: z.string(),
  formatted: z.string().optional(),
  valid: z.boolean()
});

const pisPasepValidatorOutputSchema = z.object({
  pisPasep: z.string(),
  formatted: z.string().optional(),
  valid: z.boolean(),
  message: z.string().optional()
});

const renavamGeneratorOutputSchema = z.object({
  renavam: z.string(),
  valid: z.boolean()
});

const renavamValidatorOutputSchema = z.object({
  renavam: z.string(),
  valid: z.boolean(),
  message: z.string().optional()
});

const encodedOutputSchema = z.object({
  encoded: z.string()
});

const decodedOutputSchema = z.object({
  decoded: z.string()
});

const md5OutputSchema = z.object({
  md5: z.string()
});

const sha1OutputSchema = z.object({
  sha1: z.string()
});

const textOutputSchema = z.object({
  text: z.string()
});

const analyzeTextOutputSchema = z.object({
  characters: z.number(),
  charactersWithoutSpaces: z.number(),
  words: z.number(),
  spaces: z.number(),
  lines: z.number(),
  vowels: z.number(),
  consonants: z.number()
});

export interface McpServerOptions {
  cepDatabasePath?: string;
}

function createCepServices(options: McpServerOptions) {
  return createV1Services(new CepRepository(options.cepDatabasePath ?? defaultCepDatabasePath()));
}

const numberValidationOutputSchema = z.object({
  number: z.number().nullable(),
  rule: z
    .object({
      minimum: z.number().nullable(),
      maximum: z.number().nullable(),
      parity: z.string().nullable()
    })
    .nullable(),
  status: z.string(),
  message: z.string()
});

const cepLookupOutputSchema = z.object({
  cep: z.string(),
  formatted: z.string(),
  valid: z.boolean(),
  message: z.string().optional(),
  address: z.string().optional(),
  complement: z.string().nullable().optional(),
  neighborhood: z.string().nullable().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  uf: z.string().optional(),
  numberValidation: numberValidationOutputSchema.optional()
});

const listStatesOutputSchema = z.object({
  states: z.array(z.object({ name: z.string(), abbreviation: z.string() }))
});

const listCitiesOutputSchema = z.object({
  uf: z.string(),
  query: z.string(),
  cities: z.array(z.string()),
  total: z.number(),
  hasMore: z.boolean()
});

function buildCepToolRegistrations(services: ReturnType<typeof createV1Services>): ToolRegistration[] {
  return [
    toolRegistration({
      name: "lookup_cep",
      title: "Lookup CEP",
      description: "Look up a Brazilian CEP in the local database and validate its address number against the complement range.",
      inputSchema: cepLookupRequestSchema,
      outputSchema: cepLookupOutputSchema,
      handler: services.lookupCep
    }),
    toolRegistration({
      name: "list_states",
      title: "List States",
      description: "List Brazilian states from the local CEP database.",
      inputSchema: statesRequestSchema,
      outputSchema: listStatesOutputSchema,
      handler: () => services.listStates()
    }),
    toolRegistration({
      name: "list_cities",
      title: "List Cities",
      description: "List cities of a Brazilian state with accent-insensitive search.",
      inputSchema: citiesRequestSchema,
      outputSchema: listCitiesOutputSchema,
      handler: services.listCities
    })
  ];
}

const toolRegistrations: ToolRegistration[] = [
  toolRegistration({
    name: "generate_cpf",
    title: "Generate CPF",
    description: "Generate a valid Brazilian CPF.",
    inputSchema: cpfGenerateRequestSchema,
    outputSchema: cpfGeneratorOutputSchema,
    handler: v1Services.generateCpf
  }),
  toolRegistration({
    name: "validate_cpf",
    title: "Validate CPF",
    description: "Validate a Brazilian CPF.",
    inputSchema: documentValueSchema,
    outputSchema: cpfValidatorOutputSchema,
    handler: v1Services.validateCpf
  }),
  toolRegistration({
    name: "generate_cnpj",
    title: "Generate CNPJ",
    description: "Generate a valid numeric Brazilian CNPJ.",
    inputSchema: cnpjGenerateRequestSchema,
    outputSchema: cnpjGeneratorOutputSchema,
    handler: v1Services.generateCnpj
  }),
  toolRegistration({
    name: "validate_cnpj",
    title: "Validate CNPJ",
    description: "Validate a Brazilian CNPJ.",
    inputSchema: documentValueSchema,
    outputSchema: cnpjValidatorOutputSchema,
    handler: v1Services.validateCnpj
  }),
  toolRegistration({
    name: "generate_cnh",
    title: "Generate CNH",
    description: "Generate a valid Brazilian CNH.",
    inputSchema: seededOnlyRequestSchema,
    outputSchema: cnhGeneratorOutputSchema,
    handler: v1Services.generateCnh
  }),
  toolRegistration({
    name: "validate_cnh",
    title: "Validate CNH",
    description: "Validate a Brazilian CNH.",
    inputSchema: documentValueSchema,
    outputSchema: cnhValidatorOutputSchema,
    handler: v1Services.validateCnh
  }),
  toolRegistration({
    name: "generate_rg",
    title: "Generate RG",
    description: "Generate a Brazilian RG.",
    inputSchema: genericGenerateRequestSchema,
    outputSchema: rgGeneratorOutputSchema,
    handler: v1Services.generateRg
  }),
  toolRegistration({
    name: "validate_rg",
    title: "Validate RG",
    description: "Validate a Brazilian RG.",
    inputSchema: documentValueSchema,
    outputSchema: rgValidatorOutputSchema,
    handler: v1Services.validateRg
  }),
  toolRegistration({
    name: "generate_pis_pasep",
    title: "Generate PIS/PASEP",
    description: "Generate a valid Brazilian PIS/PASEP.",
    inputSchema: genericGenerateRequestSchema,
    outputSchema: pisPasepGeneratorOutputSchema,
    handler: v1Services.generatePisPasep
  }),
  toolRegistration({
    name: "validate_pis_pasep",
    title: "Validate PIS/PASEP",
    description: "Validate a Brazilian PIS/PASEP.",
    inputSchema: documentValueSchema,
    outputSchema: pisPasepValidatorOutputSchema,
    handler: v1Services.validatePisPasep
  }),
  toolRegistration({
    name: "generate_renavam",
    title: "Generate RENAVAM",
    description: "Generate a valid Brazilian RENAVAM.",
    inputSchema: seededOnlyRequestSchema,
    outputSchema: renavamGeneratorOutputSchema,
    handler: v1Services.generateRenavam
  }),
  toolRegistration({
    name: "validate_renavam",
    title: "Validate RENAVAM",
    description: "Validate a Brazilian RENAVAM.",
    inputSchema: documentValueSchema,
    outputSchema: renavamValidatorOutputSchema,
    handler: v1Services.validateRenavam
  }),
  toolRegistration({
    name: "encode_base64",
    title: "Encode Base64",
    description: "Encode UTF-8 text as Base64.",
    inputSchema: textRequestSchema,
    outputSchema: encodedOutputSchema,
    handler: v1Services.encodeBase64
  }),
  toolRegistration({
    name: "decode_base64",
    title: "Decode Base64",
    description: "Decode Base64 text as UTF-8.",
    inputSchema: base64DecodeRequestSchema,
    outputSchema: decodedOutputSchema,
    handler: v1Services.decodeBase64
  }),
  toolRegistration({
    name: "encode_md5",
    title: "Encode MD5",
    description: "Hash text using MD5.",
    inputSchema: textRequestSchema,
    outputSchema: md5OutputSchema,
    handler: v1Services.encodeMd5
  }),
  toolRegistration({
    name: "encode_sha1",
    title: "Encode SHA1",
    description: "Hash text using SHA1.",
    inputSchema: textRequestSchema,
    outputSchema: sha1OutputSchema,
    handler: v1Services.encodeSha1
  }),
  toolRegistration({
    name: "encode_url",
    title: "Encode URL",
    description: "URL-encode text.",
    inputSchema: textRequestSchema,
    outputSchema: encodedOutputSchema,
    handler: v1Services.encodeUrl
  }),
  toolRegistration({
    name: "decode_url",
    title: "Decode URL",
    description: "URL-decode text.",
    inputSchema: urlDecodeRequestSchema,
    outputSchema: decodedOutputSchema,
    handler: v1Services.decodeUrl
  }),
  toolRegistration({
    name: "remove_text_accents",
    title: "Remove Text Accents",
    description: "Remove accents from text.",
    inputSchema: textRequestSchema,
    outputSchema: textOutputSchema,
    handler: v1Services.removeTextAccents
  }),
  toolRegistration({
    name: "reverse_text",
    title: "Reverse Text",
    description: "Reverse text by grapheme.",
    inputSchema: textRequestSchema,
    outputSchema: textOutputSchema,
    handler: v1Services.reverseText
  }),
  toolRegistration({
    name: "analyze_text",
    title: "Analyze Text",
    description: "Analyze text counts and letter statistics.",
    inputSchema: textRequestSchema,
    outputSchema: analyzeTextOutputSchema,
    handler: v1Services.analyzeText
  })
];

const restEndpoints = [
  { method: "POST", path: "/api/generators/cpf", tool: "generate_cpf", inputs: ["formatted", "state", "seed"], outputs: ["cpf", "formatted", "valid"] },
  { method: "POST", path: "/api/validators/cpf", tool: "validate_cpf", inputs: ["value"], outputs: ["cpf", "formatted", "valid", "message"] },
  { method: "POST", path: "/api/generators/cnpj", tool: "generate_cnpj", inputs: ["formatted", "format", "seed"], outputs: ["cnpj", "formatted", "format", "valid"] },
  { method: "POST", path: "/api/validators/cnpj", tool: "validate_cnpj", inputs: ["value"], outputs: ["cnpj", "formatted", "format", "valid", "message"] },
  { method: "POST", path: "/api/generators/cnh", tool: "generate_cnh", inputs: ["seed"], outputs: ["cnh", "valid"] },
  { method: "POST", path: "/api/validators/cnh", tool: "validate_cnh", inputs: ["value"], outputs: ["cnh", "valid", "message"] },
  { method: "POST", path: "/api/generators/rg", tool: "generate_rg", inputs: ["formatted", "seed"], outputs: ["rg", "formatted", "valid"] },
  { method: "POST", path: "/api/validators/rg", tool: "validate_rg", inputs: ["value"], outputs: ["rg", "formatted", "valid", "message"] },
  { method: "POST", path: "/api/generators/pis-pasep", tool: "generate_pis_pasep", inputs: ["formatted", "seed"], outputs: ["pisPasep", "formatted", "valid"] },
  { method: "POST", path: "/api/validators/pis-pasep", tool: "validate_pis_pasep", inputs: ["value"], outputs: ["pisPasep", "formatted", "valid", "message"] },
  { method: "POST", path: "/api/generators/renavam", tool: "generate_renavam", inputs: ["seed"], outputs: ["renavam", "valid"] },
  { method: "POST", path: "/api/validators/renavam", tool: "validate_renavam", inputs: ["value"], outputs: ["renavam", "valid", "message"] },
  { method: "POST", path: "/api/encoders/base64/encode", tool: "encode_base64", inputs: ["text"], outputs: ["encoded"] },
  { method: "POST", path: "/api/encoders/base64/decode", tool: "decode_base64", inputs: ["base64"], outputs: ["decoded"] },
  { method: "POST", path: "/api/encoders/md5", tool: "encode_md5", inputs: ["text"], outputs: ["md5"] },
  { method: "POST", path: "/api/encoders/sha1", tool: "encode_sha1", inputs: ["text"], outputs: ["sha1"] },
  { method: "POST", path: "/api/encoders/url/encode", tool: "encode_url", inputs: ["text"], outputs: ["encoded"] },
  { method: "POST", path: "/api/encoders/url/decode", tool: "decode_url", inputs: ["url"], outputs: ["decoded"] },
  { method: "POST", path: "/api/text/remove-accents", tool: "remove_text_accents", inputs: ["text"], outputs: ["text"] },
  { method: "POST", path: "/api/text/reverse", tool: "reverse_text", inputs: ["text"], outputs: ["text"] },
  {
    method: "POST",
    path: "/api/text/analyze",
    tool: "analyze_text",
    inputs: ["text"],
    outputs: ["characters", "charactersWithoutSpaces", "words", "spaces", "lines", "vowels", "consonants"]
  },
  {
    method: "POST",
    path: "/api/validators/cep",
    tool: "lookup_cep",
    inputs: ["value", "number"],
    outputs: ["cep", "formatted", "valid", "message", "address", "complement", "neighborhood", "city", "state", "uf", "numberValidation"]
  },
  { method: "POST", path: "/api/lookups/states", tool: "list_states", inputs: [], outputs: ["states"] },
  { method: "POST", path: "/api/lookups/cities", tool: "list_cities", inputs: ["uf", "query", "limit"], outputs: ["uf", "query", "cities", "total", "hasMore"] }
] as const;

function asMcpResult(value: unknown): McpToolResult {
  const structuredContent = typeof value === "object" && value !== null && !Array.isArray(value) ? value as StructuredContent : { result: value };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent,
    isError: false
  };
}

function zodErrorToEnvelope(error: ZodError) {
  return {
    error: {
      code: "invalid_parameter" as const,
      message: error.issues[0]?.message ?? "Invalid request",
      ...(error.issues[0]?.path.length ? { field: error.issues[0].path.join(".") } : {})
    }
  };
}

function asMcpError(error: unknown): McpToolResult {
  const envelope =
    error instanceof DomainError
      ? error.toEnvelope()
      : error instanceof ZodError
        ? zodErrorToEnvelope(error)
        : { error: { code: "internal_error" as const, message: "Internal server error" } };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
    structuredContent: envelope as unknown as StructuredContent,
    isError: true
  };
}

async function callRegisteredTool(tool: ToolRegistration, args: Record<string, unknown>): Promise<McpToolResult> {
  try {
    const parsed = tool.inputSchema.parse(args);
    return asMcpResult(await tool.handler(parsed));
  } catch (error) {
    return asMcpError(error);
  }
}

function buildCatalogText(tools: ToolRegistration[]): string {
  const endpointsByTool = new Map<string, (typeof restEndpoints)[number]>(restEndpoints.map((endpoint) => [endpoint.tool, endpoint]));
  return JSON.stringify(
    {
      version: "v1",
      tools: tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        endpoint: endpointsByTool.get(tool.name)
      }))
    },
    null,
    2
  );
}

function jsonSchemaProperties(schema: z.ZodObject<z.ZodRawShape>): string[] {
  return Object.keys(schema.shape);
}

function toJsonSchema(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}

function buildRestSchemaResource(): ResourcePayload {
  return {
    version: "v1",
    endpoints: restEndpoints.map((endpoint) => ({
      method: endpoint.method,
      path: endpoint.path,
      inputNames: endpoint.inputs,
      outputNames: endpoint.outputs
    }))
  };
}

function buildMcpSchemaResource(tools: ToolRegistration[]): ResourcePayload {
  return {
    version: "v1",
    tools: tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: {
        names: jsonSchemaProperties(tool.inputSchema),
        jsonSchema: toJsonSchema(tool.inputSchema)
      },
      outputSchema: {
        names: jsonSchemaProperties(tool.outputSchema),
        jsonSchema: toJsonSchema(tool.outputSchema)
      }
    }))
  };
}

function buildStatesResource(): ResourcePayload {
  return {
    country: "BR",
    states: [...brazilianStates]
  };
}

function buildAlgorithmsResource(): ResourcePayload {
  return {
    version: "v1",
    algorithms: [
      { name: "CPF", policy: "Generate and validate numeric CPF check digits; optional UF-aware generation." },
      { name: "CNPJ", policy: "Generate and validate numeric-only CNPJ check digits; alphanumeric CNPJ is rejected in v1." },
      { name: "CNH", policy: "Generate and validate Brazilian CNH check digits." },
      { name: "RG", policy: "Generate Brazilian RG-shaped values and validate RG shape only." },
      { name: "PIS/PASEP", policy: "Generate and validate PIS/PASEP check digits." },
      { name: "RENAVAM", policy: "Generate and validate RENAVAM check digits." },
      { name: "Base64", policy: "Encode UTF-8 text and strictly decode Base64 with round-trip validation." },
      { name: "URL component", policy: "Encode and decode URL components with invalid escape rejection." },
      { name: "Text graphemes", policy: "Reverse and count text using grapheme-aware segmentation where available." },
      { name: "CEP", policy: "Look up CEPs in a local database; conservative complement range rules validate address numbers." }
    ]
  };
}

function buildResourceDefinitions(tools: ToolRegistration[]) {
  return [
    {
      uri: sdkCatalogUri,
      name: "tools-catalog",
      title: "DevTools BR Tools Catalog",
      description: "JSON catalog of DevTools BR MCP v1 tools and REST endpoints.",
      text: () => JSON.stringify(buildCatalogText(tools), null, 2)
    },
    {
      uri: "devs-clone://schemas/rest-v1",
      name: "rest-v1-schema",
      title: "DevTools BR REST v1 Schema",
      description: "JSON description of REST v1 endpoints, methods, inputs, and outputs.",
      text: () => JSON.stringify(buildRestSchemaResource(), null, 2)
    },
    {
      uri: "devs-clone://schemas/mcp-v1",
      name: "mcp-v1-schema",
      title: "DevTools BR MCP v1 Schema",
      description: "JSON description of MCP v1 tools and their input/output schemas.",
      text: () => JSON.stringify(buildMcpSchemaResource(tools), null, 2)
    },
    {
      uri: "devs-clone://reference/states",
      name: "brazilian-states",
      title: "Brazilian States",
      description: "JSON list of Brazilian UFs accepted by v1 generators.",
      text: () => JSON.stringify(buildStatesResource(), null, 2)
    },
    {
      uri: "devs-clone://reference/algorithms",
      name: "algorithm-reference",
      title: "DevTools BR Algorithm Reference",
      description: "JSON notes naming v1 algorithms and validation policies.",
      text: () => JSON.stringify(buildAlgorithmsResource(), null, 2)
    }
  ] as const;
}

function getResource(uri: string, resources: ReadonlyArray<{ uri: string; name: string; title: string; description: string; text: () => string }>): CatalogResource {
  const lookupUri = uri === catalogUri ? sdkCatalogUri : uri;
  const resource = resources.find((definition) => definition.uri === lookupUri);
  if (!resource) {
    throw new Error(`Unknown MCP resource: ${uri}`);
  }

  return {
    uri,
    name: resource.name,
    title: resource.title,
    mimeType: "application/json",
    text: resource.text()
  };
}

function registerJsonResource(
  server: McpServer,
  resource: { uri: string; name: string; title: string; description: string; text: () => string },
  resources: ReadonlyArray<{ uri: string; name: string; title: string; description: string; text: () => string }>
) {
  server.registerResource(
    resource.name,
    resource.uri,
    {
      title: resource.title,
      description: resource.description,
      mimeType: "application/json"
    },
    (resourceUri) => {
      const resolved = getResource(resourceUri.href, resources);
      return {
        contents: [
          {
            uri: resolved.uri,
            mimeType: resolved.mimeType,
            text: resolved.text
          }
        ]
      };
    }
  );
}

export function buildMcpSdkServer(options: McpServerOptions = {}) {
  const tools: ToolRegistration[] = [...toolRegistrations, ...buildCepToolRegistrations(createCepServices(options))];
  const resources = buildResourceDefinitions(tools);
  const server = new McpServer({ name: "devtools-br", version: "0.1.0" });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema
      },
      // SDK v2 types widen tool handlers to CallToolResult | InputRequiredResult;
      // this adapter only returns complete CallToolResult envelopes.
      async (args) => (await callRegisteredTool(tool, args)) as CallToolResult
    );
  }

  for (const resource of resources) {
    registerJsonResource(server, resource, resources);
  }

  return server;
}

export function createMcpServer(options: McpServerOptions = {}) {
  const tools: ToolRegistration[] = [...toolRegistrations, ...buildCepToolRegistrations(createCepServices(options))];
  const resources = buildResourceDefinitions(tools);
  return {
    startStdio: async () => {
      const server = buildMcpSdkServer(options);
      const transport = new StdioServerTransport();
      await server.connect(transport);
    },
    listToolsForTests: () => tools,
    callToolForTests: async (name: string, args: Record<string, unknown>) => {
      const tool = tools.find((registration) => registration.name === name);
      if (!tool) {
        throw new Error(`Unknown MCP tool: ${name}`);
      }
      return callRegisteredTool(tool, args);
    },
    readResourceForTests: async (uri: string) => getResource(uri, resources)
  };
}
