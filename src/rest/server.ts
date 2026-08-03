import Fastify from "fastify";
import { ZodError, type ZodType } from "zod/v4";
import { DomainError } from "../domain/errors.js";
import {
  base64DecodeRequestSchema,
  cnpjGenerateRequestSchema,
  cpfGenerateRequestSchema,
  documentValueSchema,
  genericGenerateRequestSchema,
  seededOnlyRequestSchema,
  textRequestSchema,
  urlDecodeRequestSchema
} from "../schemas/v1.js";
import { v1Services } from "../services/v1.js";

function parse<T>(schema: ZodType<T>, payload: unknown): T {
  return schema.parse(payload);
}

function mapError(error: unknown) {
  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: "invalid_parameter",
          message: error.issues[0]?.message ?? "Invalid request",
          field: error.issues[0]?.path.join(".")
        }
      }
    };
  }
  if (error instanceof DomainError) {
    return { statusCode: 400, body: error.toEnvelope() };
  }
  return {
    statusCode: 500,
    body: {
      error: {
        code: "internal_error",
        message: "Internal server error"
      }
    }
  };
}

function getFrameworkStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : undefined;
}

function getFrameworkMessage(error: unknown): string {
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" && error.message.length > 0 ? error.message : "Invalid request";
}

function mapFrameworkError(error: unknown) {
  if (getFrameworkStatus(error) === 400) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: "invalid_parameter",
          message: getFrameworkMessage(error)
        }
      }
    };
  }

  return mapError(error);
}

export function createRestServer() {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    const mapped = mapFrameworkError(error);
    reply.code(mapped.statusCode);
    return mapped.body;
  });

  const post = <T>(url: string, schema: ZodType<T>, handler: (input: T) => unknown) => {
    app.post(url, async (request, reply) => {
      try {
        return handler(parse(schema, request.body));
      } catch (error) {
        const mapped = mapError(error);
        reply.code(mapped.statusCode);
        return mapped.body;
      }
    });
  };

  post("/api/generators/cpf", cpfGenerateRequestSchema, v1Services.generateCpf);
  post("/api/validators/cpf", documentValueSchema, v1Services.validateCpf);
  post("/api/generators/cnpj", cnpjGenerateRequestSchema, v1Services.generateCnpj);
  post("/api/validators/cnpj", documentValueSchema, v1Services.validateCnpj);
  post("/api/generators/cnh", seededOnlyRequestSchema, v1Services.generateCnh);
  post("/api/validators/cnh", documentValueSchema, v1Services.validateCnh);
  post("/api/generators/rg", genericGenerateRequestSchema, v1Services.generateRg);
  post("/api/validators/rg", documentValueSchema, v1Services.validateRg);
  post("/api/generators/pis-pasep", genericGenerateRequestSchema, v1Services.generatePisPasep);
  post("/api/validators/pis-pasep", documentValueSchema, v1Services.validatePisPasep);
  post("/api/generators/renavam", seededOnlyRequestSchema, v1Services.generateRenavam);
  post("/api/validators/renavam", documentValueSchema, v1Services.validateRenavam);
  post("/api/encoders/base64/encode", textRequestSchema, v1Services.encodeBase64);
  post("/api/encoders/base64/decode", base64DecodeRequestSchema, v1Services.decodeBase64);
  post("/api/encoders/md5", textRequestSchema, v1Services.encodeMd5);
  post("/api/encoders/sha1", textRequestSchema, v1Services.encodeSha1);
  post("/api/encoders/url/encode", textRequestSchema, v1Services.encodeUrl);
  post("/api/encoders/url/decode", urlDecodeRequestSchema, v1Services.decodeUrl);
  post("/api/text/remove-accents", textRequestSchema, v1Services.removeTextAccents);
  post("/api/text/reverse", textRequestSchema, v1Services.reverseText);
  post("/api/text/analyze", textRequestSchema, v1Services.analyzeText);

  return app;
}
