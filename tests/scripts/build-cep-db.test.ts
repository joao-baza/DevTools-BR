import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { generateCepDatabase } from "../../scripts/build-cep-db.js";

const TEST_REGIONS = { Teste: ["TT"] } as const;
const directories: string[] = [];

afterAll(() => {
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createTree(): { input: string; output: string } {
  const root = mkdtempSync(join(tmpdir(), "devtools-br-build-cep-"));
  directories.push(root);
  const input = join(root, "CEPs");
  const output = join(root, "ceps.sqlite");
  mkdirSync(join(input, "Teste", "TT"), { recursive: true });
  writeFileSync(join(input, "Estados.csv"), "1,Testelandia,TT\n");
  writeFileSync(join(input, "Cidades.csv"), "1,Alphaville,1\n2,Betaville,1\n");
  for (let part = 1; part <= 5; part += 1) {
    const cep = `0100100${part - 1}`;
    const line = `${cep},Praça Central,"Praça Central, s/n",Centro,1,1\n`;
    writeFileSync(join(input, "Teste", "TT", `tt.${part}.csv`), line);
  }
  return { input, output };
}

describe("generateCepDatabase", () => {
  it("generates the database with expected counts and parsed quoted commas", () => {
    const tree = createTree();
    const result = generateCepDatabase({ input: tree.input, output: tree.output, regions: TEST_REGIONS });

    expect(result).toEqual({ states: 1, cities: 2, ceps: 5 });

    const database = new DatabaseSync(tree.output, { readOnly: true });
    try {
      const row = database.prepare("SELECT complement FROM ceps WHERE cep = ?").get("01001000") as { complement: string };
      expect(row.complement).toBe("Praça Central, s/n");
      const violations = database.prepare("PRAGMA foreign_key_check").all();
      expect(violations).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("refuses to overwrite without the flag and succeeds with it", () => {
    const tree = createTree();
    generateCepDatabase({ input: tree.input, output: tree.output, regions: TEST_REGIONS });

    expect(() => generateCepDatabase({ input: tree.input, output: tree.output, regions: TEST_REGIONS })).toThrow(/já existe/);

    expect(() =>
      generateCepDatabase({ input: tree.input, output: tree.output, overwrite: true, regions: TEST_REGIONS })
    ).not.toThrow();
  });

  it("reports file and line for rows with wrong column count", () => {
    const tree = createTree();
    const badPath = join(tree.input, "Teste", "TT", "tt.1.csv");
    writeFileSync(badPath, "01001000,Praça Central,Centro,1,1\n");

    expect(() => generateCepDatabase({ input: tree.input, output: tree.output, regions: TEST_REGIONS })).toThrow(/tt\.1\.csv.*linha 1/);
    expect(readdirSync(dirname(tree.output)).filter((name) => name.includes(".tmp"))).toEqual([]);
  });

  it("requires every region, state and part folder", () => {
    const tree = createTree();
    rmSync(join(tree.input, "Teste", "TT", "tt.5.csv"));

    expect(() => generateCepDatabase({ input: tree.input, output: tree.output, regions: TEST_REGIONS })).toThrow(/tt\.5\.csv/);
  });
});
