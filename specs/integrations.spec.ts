import { expect, test } from '@playwright/test';

test.describe('integration picker', () => {
  test('HTTP request and n8n live under Integrations, not Conditions', async ({
    page,
  }) => {
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    test.skip(
      !email || !password,
      'Set E2E_EMAIL and E2E_PASSWORD to run the builder audit.'
    );

    await page.goto('/login');
    await page.getByLabel('Email').fill(email!);
    await page.getByLabel('Password').fill(password!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    await page.goto('/automations');
    await page.getByRole('button', { name: 'New Automation' }).first().click();
    await page.getByRole('button', { name: /Start from scratch/i }).click();
    await page.waitForURL(/\/automations\/[0-9a-f-]+/);

    await page.getByRole('button', { name: /Choose first step/ }).click();
    await expect(page.getByPlaceholder('Search blocks')).toBeVisible();
    await expect(page.getByText('Integrations')).toBeVisible();
    await expect(page.getByText('Conditions')).toBeVisible();

    const integrations = page
      .locator('div.mb-4')
      .filter({ hasText: 'Integrations' });
    await expect(integrations.getByRole('button', { name: /HTTP request/ })).toBeVisible();
    await expect(integrations.getByRole('button', { name: /n8n workflow/ })).toBeVisible();

    const conditions = page
      .locator('div.mb-4')
      .filter({ hasText: 'Conditions' });
    await expect(conditions.getByRole('button', { name: /^Condition$/ })).toBeVisible();
    await expect(
      conditions.getByRole('button', { name: /HTTP request/ })
    ).toHaveCount(0);
  });
});
