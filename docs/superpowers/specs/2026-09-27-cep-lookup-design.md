# Design: CEP Lookup no DevTools-BR

Data: 2026-09-27
Origem: porte do [validador-cep](https://github.com/joao-baza/validador-cep) (Python/FastAPI) para a arquitetura do DevTools-BR (TypeScript/Fastify/MCP).

## Contexto

O validador-cep consulta CEPs brasileiros em uma base SQLite local (~115 MB) gerada a partir de 137 CSVs (63 MB, dados do CEP Aberto), valida o número do endereço contra faixas descritas no complemento e lista estados e cidades por UF. O DevTools-BR é stateless: geradores, validadores, encoders e ferramentas de texto expostos via REST e MCP, sem dependência de dados externos.

Decisões tomadas em brainstorm com o autor:

- Os CSVs entram versionados no repo do DevTools-BR (`data/ceps/`); o SQLite é artefato gerado, fora do git.
- Escopo: consulta de CEP com validação de número, estados e cidades por UF, tools MCP equivalentes. Frontend web do validador-cep não é portado.
- Integração pelas camadas existentes (domain → schemas → services → rest/mcp); endpoints sempre registrados; sem banco, endpoints de CEP respondem 503 com erro explícito.
- Toda a implementação em TypeScript, incluindo o gerador do banco, com driver `node:sqlite` nativo (zero dependências novas). `engines` sobe para `>=22.5`.

## Não-objetivos

- Portar o frontend estático do validador-cep.
- Gerar CEPs aleatórios ou consultar serviços externos de CEP.
- Oracle 4Devs para CEP (não há equivalente a consultar).
- API GET: os endpoints novos seguem a convenção do projeto (POST + JSON).

## Dados

- `data/ceps/` recebe cópia fiel da pasta `CEPs/` do validador-cep: `Estados.csv`, `Cidades.csv` e `{Região}/{UF}/{uf}.{1..5}.csv` (5 regiões × 27 UFs × 5 partes). CSVs sem cabeçalho, mesmas colunas do projeto de origem.
- `data/ceps/ceps.sqlite` (saída do gerador) entra no `.gitignore`.
- Env var `CEP_DATABASE` aponta um arquivo alternativo; o padrão é `data/ceps/ceps.sqlite` resolvido a partir da raiz do projeto.
- O README mantém o crédito aos dados do CEP Aberto, como no validador-cep.

## Gerador do banco

`scripts/build-cep-db.ts`, porte do `gerar_sqlite_ceps.py`:

- CLI: `npm run build:cep-db -- [--input data/ceps] [--output data/ceps/ceps.sqlite] [--overwrite]`.
- Mesmo esquema SQLite: tabelas `states`, `cities`, `ceps` com chaves primárias/estrangeiras e índices `idx_ceps_city_id` e `idx_ceps_state_city_id`.
- Leituras em lotes de 10.000 linhas, validação de número de colunas por arquivo, conversão estrita de identificadores numéricos e mensagens de erro com arquivo e linha.
- Valida contagens por tabela e `PRAGMA foreign_key_check` antes de publicar; escreve em arquivo temporário e faz rename atômico; `ANALYZE` ao final.
- A lista de regiões/UFs é parâmetro injetável (default: as 5 regiões e 27 UFs reais), para permitir teste com árvore fixture sintética.

## Domain

### `src/domain/cep.ts` (puro, porte do `number_rules.py`)

- `normalizeCep(value: string): string` — remove não-dígitos; devolve os 8 dígitos.
- `formatCep(cep: string): string` — `XXXXX-XXX`.
- `parseRule(complement: string | null | undefined): NumberRule | null` — reconhece, em texto casefoldado: `de X a Y` (mínimo/máximo), `de X ao fim` (mínimo), `até Y` (máximo), `lado par|ímpar` (paridade). Valores `X/Y` são interpretados como faixa (min/max das duas partes). Só retorna regra para faixas inequívocas; texto livre não gera regra.
- `validateNumber(number: number | null | undefined, complement: string | null | undefined): NumberValidation` — `{ number, rule, status, message }` com os mesmos quatro statuses e mensagens do original: `not_provided`, `range_unavailable`, `incompatible` (faixa ou paridade) e `compatible`.

### `src/domain/cep-repository.ts` (porte do `database.py`)

- `class CepRepository(databasePath: string)` — abre `node:sqlite` `DatabaseSync` em modo somente leitura a cada consulta.
- `assertSchema()` — verifica a existência das tabelas esperadas.
- `findCep(cep)` — join de `ceps`/`cities`/`states` retornando `{cep, address, complement, neighborhood, city, state, uf}`.
- `states()` — `{name, abbreviation}` em ordem alfabética de nome.
- `cities(uf)` — nomes de cidades da UF em ordem alfabética, ou `null` para UF inexistente na base.
- `normalizeText(value)` — NFD, remoção de diacríticos e casefold, para busca de cidades sem acentos.
- Falhas de abertura/esquema viram `DomainError` `cep_database_unavailable`.

## Erros

- `DomainError` ganha `statusCode?: number` (default permanece 400) e o código `cep_database_unavailable` entra no `ErrorCode` e no schema do envelope.
- REST: banco ausente/inválido → HTTP 503 com envelope `{error: {code: "cep_database_unavailable", message, ...}}`; a mensagem instrui rodar `npm run build:cep-db`.
- MCP: a tool retorna `isError: true` com o mesmo envelope.
- CEP com tamanho inválido (≠ 8 dígitos) → 400 `invalid_parameter` com `field: "value"`.
- Os endpoints existentes não dependem do banco e continuam funcionando sem ele.

## Services

- `createV1Services(cepRepository: CepRepository)` — factory que espalha os handlers atuais de `v1Services` e adiciona `lookupCep`, `listStates`, `listCities`.
- `createRestServer(options?)` e `createMcpServer(options?)` aceitam `cepDatabasePath` opcional; default: `CEP_DATABASE` ou `data/ceps/ceps.sqlite`. Testes injetam caminho de fixture.

### Contratos

`lookupCep({value, number?})`:

- `value`: CEP com ou sem formatação; `number`: inteiro ≥ 1 opcional.
- CEP encontrado: `{cep, formatted, valid: true, address, complement, neighborhood, city, state, uf, numberValidation}` — `numberValidation` presente sempre (com `status: "not_provided"` quando `number` não é enviado), como no original.
- CEP com 8 dígitos mas ausente da base: `{cep, formatted, valid: false, message: "CEP não encontrado na base local."}`. Diferença deliberada contra o 404 do validador-cep, para seguir o padrão dos validators do DevTools-BR (200 + `valid: false`).

`listStates()`: `{states: [{name, abbreviation}]}`.

`listCities({uf, query?, limit?})`: `{uf, query, cities: string[], total, hasMore}` — filtro normalizado (sem acentos, casefold), `limit` 1–100 (default 20), `total` = correspondências totais, `hasMore` = `total > limit`. UF válida sem cidades na base retorna lista vazia.

## REST

| Endpoint | Entrada | Saída |
| --- | --- | --- |
| `POST /api/validators/cep` | `value`, `number?` | `cep`, `formatted`, `valid`, `message?`, `address?`, `complement?`, `neighborhood?`, `city?`, `state?`, `uf?`, `numberValidation?` |
| `POST /api/lookups/states` | `{}` | `states` |
| `POST /api/lookups/cities` | `uf`, `query?`, `limit?` | `uf`, `query`, `cities`, `total`, `hasMore` |

## MCP

Tools registradas no mesmo padrão (input/output schemas zod, título e descrição):

- `lookup_cep` — "Look up a Brazilian CEP in the local database and validate its address number against the complement range."
- `list_states` — "List Brazilian states from the local CEP database."
- `list_cities` — "List cities of a Brazilian state, with accent-insensitive search."

O catálogo (`devs-clone://catalog/tools`) e os resources de schema REST/MCP são atualizados automaticamente pelas listas `toolRegistrations` e `restEndpoints`. O resource de algoritmos ganha uma nota sobre a política de CEP (consulta à base local; number rules conservadoras).

## Docker

- Estágio de build: copia `data/ceps` e roda o gerador com tsx (disponível nas devDependencies do estágio).
- Estágio runtime: recebe apenas `dist/`, `node_modules/` e `data/ceps/ceps.sqlite`; os CSVs não vão para a imagem final.
- `docker compose up` continua funcionando sem passos extras; o README documenta o aumento de ~115 MB na imagem.

## Testes (vitest, grupos existentes)

- `tests/domain/cep.test.ts` — `parseRule`/`validateNumber` com os casos do `test_number_rules.py` (faixa com dois limites, faixa aberta + paridade, limite superior, texto sem regra) e extras: número não fornecido, só paridade, valores com barra (`353/354`), normalização/formatação de CEP.
- `tests/domain/cep-repository.test.ts` — SQLite fixture mínimo criado em `tmp` pelo teste: `assertSchema` ok/falha, `findCep` encontrado/não encontrado, `states`, `cities` por UF existente/inexistente, `normalizeText`.
- `tests/rest/` — lookup válido com e sem `number`, compatível/incompatível/`range_unavailable`, formato inválido (400), ausente na base (`valid: false`), `states`, `cities` com query sem acento, `limit` e `hasMore`, 503 com banco inexistente.
- `tests/mcp/` — `lookup_cep`/`list_states`/`list_cities` com output schema validado, envelope de erro sem banco.
- `tests/scripts/build-cep-db.test.ts` — gera a partir de árvore fixture sintética (regiões/UFs injetadas): contagens, `foreign_key_check`, recusa de saída existente sem `--overwrite`, erro de colunas com arquivo/linha.

## README

Nova seção sobre as ferramentas de CEP: origem dos dados (CEP Aberto), geração do banco (`npm run build:cep-db`), env var `CEP_DATABASE`, endpoints REST e tools MCP novos, nota sobre imagem Docker, e atualização das tabelas de endpoints/tools.
