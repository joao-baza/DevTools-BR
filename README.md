# DevTools BR

API REST e servidor MCP com geradores, validadores, encoders e utilitários de texto inspirados no 4Devs.

O código de produção não chama o 4Devs. O projeto implementa os algoritmos localmente e usa o 4Devs apenas em testes de compatibilidade via browser, quando o oracle é ativado de forma explícita.

## O que o projeto entrega

- Geração e validação de documentos brasileiros: CPF, CNPJ, CNH, RG, PIS/PASEP e RENAVAM.
- Consulta de CEP em base local: endereço por CEP, validação do número contra a faixa do complemento, estados e cidades por UF.
- Encoders e decoders: Base64, MD5, SHA1 e URL encode/decode.
- Ferramentas de texto: remover acentos, inverter texto e analisar contagens.
- API REST v1 para uso por aplicações HTTP.
- Servidor MCP v1 para uso por clientes compatíveis com Model Context Protocol.
- Testes locais determinísticos e testes oracle opcionais contra o 4Devs via Playwright.

## Requisitos

- Node.js 22.13 ou superior.
- npm.
- Docker e Docker Compose, se quiser rodar em containers.

## Instalação

```bash
npm install
```

## REST

Inicie a API REST em desenvolvimento:

```bash
npm run dev:rest
```

Por padrão, a API escuta em `http://127.0.0.1:3000`.

Exemplo:

```bash
curl -s http://127.0.0.1:3000/api/generators/cpf \
  -H 'content-type: application/json' \
  -d '{"formatted":true,"state":"SP","seed":"demo"}'
```

Resposta:

```json
{
  "cpf": "12345678909",
  "formatted": "123.456.789-09",
  "valid": true
}
```

`seed` torna a geração determinística. Use esse campo em testes para obter sempre o mesmo resultado.

## Endpoints REST

Todos os endpoints usam `POST` e recebem JSON.

| Endpoint | Entrada | Saída |
| --- | --- | --- |
| `/api/generators/cpf` | `formatted`, `state`, `seed` | `cpf`, `formatted`, `valid` |
| `/api/validators/cpf` | `value` | `cpf`, `formatted`, `valid`, `message` |
| `/api/generators/cnpj` | `formatted`, `format`, `seed` | `cnpj`, `formatted`, `format`, `valid` |
| `/api/validators/cnpj` | `value` | `cnpj`, `formatted`, `format`, `valid`, `message` |
| `/api/generators/cnh` | `seed` | `cnh`, `valid` |
| `/api/validators/cnh` | `value` | `cnh`, `valid`, `message` |
| `/api/generators/rg` | `formatted`, `seed` | `rg`, `formatted`, `valid` |
| `/api/validators/rg` | `value` | `rg`, `formatted`, `valid`, `message` |
| `/api/generators/pis-pasep` | `formatted`, `seed` | `pisPasep`, `formatted`, `valid` |
| `/api/validators/pis-pasep` | `value` | `pisPasep`, `formatted`, `valid`, `message` |
| `/api/generators/renavam` | `seed` | `renavam`, `valid` |
| `/api/validators/renavam` | `value` | `renavam`, `valid`, `message` |
| `/api/encoders/base64/encode` | `text` | `encoded` |
| `/api/encoders/base64/decode` | `base64` | `decoded` |
| `/api/encoders/md5` | `text` | `md5` |
| `/api/encoders/sha1` | `text` | `sha1` |
| `/api/encoders/url/encode` | `text` | `encoded` |
| `/api/encoders/url/decode` | `url` | `decoded` |
| `/api/text/remove-accents` | `text` | `text` |
| `/api/text/reverse` | `text` | `text` |
| `/api/text/analyze` | `text` | `characters`, `charactersWithoutSpaces`, `words`, `spaces`, `lines`, `vowels`, `consonants` |
| `/api/validators/cep` | `value`, `number?` | `cep`, `formatted`, `valid`, `message?`, `address?`, `complement?`, `neighborhood?`, `city?`, `state?`, `uf?`, `numberValidation?` |
| `/api/lookups/states` | `{}` | `states` |
| `/api/lookups/cities` | `uf`, `query?`, `limit?` | `uf`, `query`, `cities`, `total`, `hasMore` |

No v1, `format: "alphanumeric"` para CNPJ é rejeitado. A implementação atual gera CNPJ numérico.

## Erros REST

Erros retornam um envelope estável:

```json
{
  "error": {
    "code": "invalid_parameter",
    "message": "Invalid request",
    "field": "state"
  }
}
```

Códigos comuns:

- `invalid_parameter`: payload inválido ou parâmetro fora do domínio aceito.
- `invalid_input`: entrada malformada, como Base64 inválido.
- `internal_error`: falha inesperada.

## MCP

O projeto expõe as mesmas operações via MCP.

Para rodar via stdio:

```bash
npm run dev:mcp:stdio
```

Para rodar via Streamable HTTP:

```bash
npm run dev:mcp:http
```

Por padrão, o endpoint HTTP escuta em:

```text
http://127.0.0.1:3001/mcp
```

Ferramentas MCP disponíveis:

- `generate_cpf`, `validate_cpf`
- `generate_cnpj`, `validate_cnpj`
- `generate_cnh`, `validate_cnh`
- `generate_rg`, `validate_rg`
- `generate_pis_pasep`, `validate_pis_pasep`
- `generate_renavam`, `validate_renavam`
- `encode_base64`, `decode_base64`
- `encode_md5`, `encode_sha1`
- `encode_url`, `decode_url`
- `remove_text_accents`, `reverse_text`, `analyze_text`
- `lookup_cep`, `list_states`, `list_cities`

Recursos MCP disponíveis:

- `devs-clone://catalog/tools`
- `devs-clone://schemas/rest-v1`
- `devs-clone://schemas/mcp-v1`
- `devs-clone://reference/states`
- `devs-clone://reference/algorithms`

## Base de CEP

A consulta de CEP usa uma base SQLite local gerada a partir dos CSVs versionados em `data/ceps/`, com dados do [CEP Aberto](https://www.cepaberto.com/). A base cobre 27 estados, 10.663 cidades e 1.137.150 CEPs. O banco (~118 MB) não é versionado; gere-o com:

```bash
npm run build:cep-db
```

Opções: `--input` (padrão `data/ceps`), `--output` (padrão `<input>/ceps.sqlite`) e `--overwrite`. Sem o banco, os endpoints de CEP respondem `503` com `cep_database_unavailable`; os demais endpoints funcionam normalmente. A variável `CEP_DATABASE` aponta um arquivo alternativo.

Sem `number`, a resposta traz `numberValidation.status: "not_provided"`; sem regra no complemento, `"range_unavailable"`; com regra, `"compatible"` ou `"incompatible"` (faixa e/ou lado par/ímpar).

## Docker

Suba a API REST e o MCP HTTP com Docker Compose:

```bash
docker compose up --build
```

O Compose publica:

- REST: `http://127.0.0.1:3000`
- MCP HTTP: `http://127.0.0.1:3001/mcp`

A imagem inclui o banco de CEP gerado no build (~118 MB adicionais). Os CSVs não vão para a imagem final.

Serviços:

- `rest`: executa `npm run start:rest`.
- `mcp-http`: executa `npm run start:mcp:http`.

## Build de produção

Compile o TypeScript:

```bash
npm run build
```

Depois rode os entrypoints compilados:

```bash
npm run start:rest
npm run start:mcp:http
```

Variáveis úteis:

- `HOST`: host da API REST. Padrão: `127.0.0.1`.
- `PORT`: porta da API REST. Padrão: `3000`.
- `MCP_HTTP_HOST`: host do MCP HTTP. Padrão: `HOST` ou `127.0.0.1`.
- `MCP_HTTP_PORT`: porta do MCP HTTP. Padrão: `3001`.

## Testes

Rode a suíte local:

```bash
npm run typecheck
npm run test
```

Rode grupos específicos:

```bash
npm run test:unit
npm run test:rest
npm run test:mcp
```

Os testes oracle via browser ficam desativados por padrão:

```bash
npm run test:oracle
```

Para comparar fluxos reais com o 4Devs, ative o oracle:

```bash
RUN_4DEVS_ORACLE=1 npm run test:oracle
```

Esses testes dependem da rede e da interface atual do 4Devs. Use-os como referência de compatibilidade, não como dependência de produção.

## Estrutura

```text
src/domain      Algoritmos e regras de domínio
src/schemas     Schemas de entrada e saída
src/services    Casos de uso v1
src/rest        Servidor REST
src/mcp         Servidor MCP
tests/domain    Testes unitários de domínio
tests/rest      Testes da API REST
tests/mcp       Testes do MCP
tests/oracle    Testes opcionais contra o 4Devs via browser
scripts         Scripts de build (gerador do SQLite de CEPs)
data/ceps       CSVs de CEP (CEP Aberto); o SQLite gerado fica fora do git
```

## Escopo atual

O v1 cobre uma parte selecionada do 4Devs: documentos brasileiros, encoders, ferramentas de texto e consulta de CEP. O objetivo é expandir esse contrato aos poucos, mantendo entradas, saídas e testes claros antes de adicionar novas ferramentas.
