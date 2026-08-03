import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.RUN_4DEVS_ORACLE !== "1", "4Devs oracle tests are opt-in");
test.setTimeout(60_000);

const allowed4DevsHosts = new Set(["www.4devs.com.br", "cdn.4devs.com.br"]);

async function goto4DevsPage(page: Page, path: string) {
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());

    if (allowed4DevsHosts.has(requestUrl.hostname)) {
      await route.continue();
      return;
    }

    await route.abort();
  });

  await page.goto(path, { waitUntil: "load" });
}

async function retryUserActionUntilAssertionPasses(
  page: Page,
  action: () => Promise<void>,
  assertion: () => Promise<void>,
  options: { timeoutMs?: number; intervalMs?: number } = {}
) {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await action();
      await assertion();
      return;
    } catch (error) {
      lastError = error;

      if (Date.now() >= deadline) {
        break;
      }

      await page.waitForTimeout(Math.min(intervalMs, Math.max(deadline - Date.now(), 0)));
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("Action did not run before retry deadline");
}

test("4Devs CPF generator still exposes a valid CPF-shaped output", async ({ page }) => {
  await goto4DevsPage(page, "/gerador_de_cpf");

  const generateCpfButton = page.locator("#bt_gerar_cpf");
  const cpfOutput = page.locator("#texto_cpf");

  await expect(generateCpfButton).toBeVisible();
  await expect(generateCpfButton).toBeEnabled();
  await retryUserActionUntilAssertionPasses(
    page,
    async () => {
      await generateCpfButton.click({ timeout: 10_000 });
    },
    async () => {
      await expect(cpfOutput).toContainText(/\d{3}\.\d{3}\.\d{3}-\d{2}/, { timeout: 2_000 });
    }
  );
});

test("4Devs MD5 encoder matches deterministic hash", async ({ page }) => {
  await goto4DevsPage(page, "/codificar_md5");

  const input = page.locator("#texto_digitado");
  const encodeButton = page.locator("#bt_codificar");
  const output = page.locator("#texto_resposta");

  await expect(input).toBeVisible();
  await expect(encodeButton).toBeVisible();
  await expect(encodeButton).toBeEnabled();
  await retryUserActionUntilAssertionPasses(
    page,
    async () => {
      await input.fill("abc");
      await encodeButton.click({ timeout: 10_000 });
    },
    async () => {
      await expect(output).toHaveValue("900150983cd24fb0d6963f7d28e17f72", { timeout: 2_000 });
    }
  );
});
