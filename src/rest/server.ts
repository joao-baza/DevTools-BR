import Fastify from "fastify";
import { ZodError, type ZodType } from "zod/v4";
import { DomainError } from "../domain/errors.js";
import { CepRepository, defaultCepDatabasePath } from "../domain/cep-repository.js";
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
import { createV1Services } from "../services/v1.js";

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
    return { statusCode: error.statusCode, body: error.toEnvelope() };
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

export interface RestServerOptions {
  cepDatabasePath?: string;
}

export function createRestServer(options: RestServerOptions = {}) {
  const services = createV1Services(new CepRepository(options.cepDatabasePath ?? defaultCepDatabasePath()));
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

  post("/api/generators/cpf", cpfGenerateRequestSchema, services.generateCpf);
  post("/api/validators/cpf", documentValueSchema, services.validateCpf);
  post("/api/generators/cnpj", cnpjGenerateRequestSchema, services.generateCnpj);
  post("/api/validators/cnpj", documentValueSchema, services.validateCnpj);
  post("/api/generators/cnh", seededOnlyRequestSchema, services.generateCnh);
  post("/api/validators/cnh", documentValueSchema, services.validateCnh);
  post("/api/generators/rg", genericGenerateRequestSchema, services.generateRg);
  post("/api/validators/rg", documentValueSchema, services.validateRg);
  post("/api/generators/pis-pasep", genericGenerateRequestSchema, services.generatePisPasep);
  post("/api/validators/pis-pasep", documentValueSchema, services.validatePisPasep);
  post("/api/generators/renavam", seededOnlyRequestSchema, services.generateRenavam);
  post("/api/validators/renavam", documentValueSchema, services.validateRenavam);
  post("/api/encoders/base64/encode", textRequestSchema, services.encodeBase64);
  post("/api/encoders/base64/decode", base64DecodeRequestSchema, services.decodeBase64);
  post("/api/encoders/md5", textRequestSchema, services.encodeMd5);
  post("/api/encoders/sha1", textRequestSchema, services.encodeSha1);
  post("/api/encoders/url/encode", textRequestSchema, services.encodeUrl);
  post("/api/encoders/url/decode", urlDecodeRequestSchema, services.decodeUrl);
  post("/api/text/remove-accents", textRequestSchema, services.removeTextAccents);
  post("/api/text/reverse", textRequestSchema, services.reverseText);
  post("/api/text/analyze", textRequestSchema, services.analyzeText);
  post("/api/validators/cep", cepLookupRequestSchema, services.lookupCep);
  post("/api/lookups/states", statesRequestSchema, () => services.listStates());
  post("/api/lookups/cities", citiesRequestSchema, services.listCities);

  return app;
}
