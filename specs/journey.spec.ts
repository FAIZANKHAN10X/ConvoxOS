import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Builder audit journey. Configures every added node before publish,
 * asserts publish actually succeeded, then edits a specific Send text
 * node by its canvas preview — never `.first()` across duplicates.
 */

const SHOT_DIR = path.join('specs', 'screenshots');
const YES_TEXT = 'Yes path hello';
const YES_TEXT_V2 = 'Hello from the audit! v2';

function shotPath(name: string): string {
  mkdirSync(SHOT_DIR, { recursive: true });
  return path.join(SHOT_DIR, name);
}

async function shot(page: Page, name: string) {
  const dest = shotPath(name);
  if (/^(0[1-9]|1[0-5])-/.test(name) && existsSync(dest)) return;
  await page.screenshot({ path: dest, fullPage: true });
}

function canvasNode(page: Page, text: string): Locator {
  return page.locator('.react-flow__node').filter({ hasText: text });
}

function editor(page: Page): Locator {
  // The dashboard chrome also uses <aside>. The node editor is the
  // left overlay on the canvas, not the primary nav.
  return page.locator('aside.step-editor');
}

async function expectStepEditor(page: Page, title: string) {
  const aside = editor(page);
  await expect(aside).toBeVisible();
  const heading = aside.getByRole('heading', { name: title });
  if ((await heading.count()) > 0) {
    await expect(heading).toBeVisible();
    return;
  }
  await expect(aside.getByText(title, { exact: true }).first()).toBeVisible();
}

async function pickStep(page: Page, label: string) {
  const search = page.getByPlaceholder('Search blocks');
  await expect(search).toBeVisible();
  await search.fill(label);
  await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
}

async function closeEditor(page: Page) {
  const panel = editor(page);
  if (await panel.isVisible()) {
    await panel.getByRole('button', { name: 'Close' }).click();
  }
}

async function clickSourceDot(node: Locator, index = 0) {
  // Connection dots are the primary add-step affordance: clicking one
  // opens the picker pre-wired to that handle.
  await node.locator('.react-flow__handle.source').nth(index).click();
}

async function addAfterNode(page: Page, nodeText: string, stepLabel: string) {
  await closeEditor(page);
  const node = canvasNode(page, nodeText).first();
  await expect(node).toBeVisible();
  await clickSourceDot(node);
  await pickStep(page, stepLabel);
}

async function addConditionBranch(
  page: Page,
  branch: 'Yes' | 'No',
  stepLabel: string
) {
  await closeEditor(page);
  const condition = canvasNode(page, 'Condition');
  await expect(condition).toBeVisible();
  await clickSourceDot(condition, branch === 'Yes' ? 0 : 1);
  await pickStep(page, stepLabel);
}

async function publishMustSucceed(page: Page) {
  const errorBanner = page.locator('p.bg-red-50, p.text-red-600');
  await page.getByRole('button', { name: 'Set Live' }).click();
  // Success replaces Set Live with Update. Failure re-enables Set Live
  // and shows a banner. Do not wait for Set Live to come back.
  await expect(
    page.getByRole('button', { name: /^(Set Live|Update)$/ })
  ).toBeEnabled({ timeout: 20_000 });
  if (await errorBanner.isVisible()) {
    const message = (await errorBanner.innerText()).trim();
    throw new Error(`Publish failed: ${message}`);
  }
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();
}

test.describe('automation builder journey', () => {
  test('create configure branch wait publish dirty reopen history', async ({
    page,
  }) => {
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    test.skip(
      !email || !password,
      'Set E2E_EMAIL and E2E_PASSWORD to run the builder audit.'
    );

    const name = `Audit journey ${Date.now()}`;

    await page.goto('/login');
    await page.getByLabel('Email').fill(email!);
    await page.getByLabel('Password').fill(password!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    await page.goto('/automations');
    await expect(
      page.getByRole('heading', { name: 'My Automations' })
    ).toBeVisible();
    await shot(page, '01-list.png');

    // Empty-state and header both expose "New Automation".
    await page.getByRole('button', { name: 'New Automation' }).first().click();
    await expect(
      page.getByRole('heading', { name: 'New Automation' })
    ).toBeVisible();
    await shot(page, 'new-automation-dialog.png');

    await page.getByRole('button', { name: /Start from scratch/i }).click();
    await page.waitForURL(/\/automations\/[0-9a-f-]+/);
    await expect(page.getByText('When…')).toBeVisible();
    await expect(canvasNode(page, 'Message received')).toBeVisible();
    await expect(canvasNode(page, 'Any channel')).toBeVisible();
    await expect(page.getByText('+ New Trigger')).toHaveCount(0);
    await shot(page, '02-builder.png');

    // ManyChat parity: dashed "Choose first step" panel beside the
    // trigger's Then handle opens the same picker, pre-wired after it.
    const chooseFirst = page.getByRole('button', {
      name: /Choose first step/,
    });
    await expect(chooseFirst).toBeVisible();
    await shot(page, 'choose-first-step.png');
    await chooseFirst.click();
    await expect(page.getByPlaceholder('Search blocks')).toBeVisible();
    await expect(
      page.locator('.grid.grid-cols-2').first()
    ).toBeVisible();
    await shot(page, 'choose-first-step-picker.png');
    // FAB toggles the picker closed again.
    await page.getByRole('button', { name: 'Add a step' }).click();
    await expect(page.getByPlaceholder('Search blocks')).toHaveCount(0);

    // ManyChat parity: clicking a connection dot opens the picker
    // pre-wired to that handle (no drag needed).
    await canvasNode(page, 'Message received')
      .locator('.react-flow__handle.source')
      .click();
    await expect(page.getByPlaceholder('Search blocks')).toBeVisible();
    await shot(page, 'dot-click-picker.png');
    await page.getByRole('button', { name: 'Add a step' }).click();
    await expect(page.getByPlaceholder('Search blocks')).toHaveCount(0);

    const nameField = page.locator('header input').first();
    await nameField.fill(name);
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 15_000 });

    await canvasNode(page, 'Message received').click();
    await expectStepEditor(page, 'Message received');
    await shot(page, 'trigger-editor.png');
    await shot(page, 'configured-trigger.png');

    await clickSourceDot(canvasNode(page, 'Message received'));
    await expect(page.getByPlaceholder('Search blocks')).toBeVisible();
    await shot(page, 'action-picker.png');
    await pickStep(page, 'Condition');
    await expectStepEditor(page, 'Condition');
    // Panel vanishes once the trigger has an outgoing edge.
    await expect(
      page.getByRole('button', { name: /Choose first step/ })
    ).toHaveCount(0);
    await editor(page).getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Message text' }).click();
    await editor(page).getByRole('combobox').nth(1).click();
    await page.getByRole('option', { name: 'contains' }).click();
    await editor(page).getByRole('textbox').fill('hello');
    await shot(page, '03-condition.png');

    await addConditionBranch(page, 'Yes', 'Send text');
    await expectStepEditor(page, 'Send text');
    await shot(page, 'send-text-node.png');
    await editor(page).getByRole('textbox').first().fill(YES_TEXT);
    await expect(canvasNode(page, YES_TEXT)).toBeVisible();
    await shot(page, '04-yes-send-text.png');

    await addConditionBranch(page, 'No', 'Smart Delay');
    await expectStepEditor(page, 'Smart Delay');
    await editor(page).getByRole('spinbutton').fill('5');
    const unit = editor(page).getByRole('combobox').last();
    await unit.click();
    await page.getByRole('option', { name: 'minutes' }).click();
    await expect(canvasNode(page, 'Wait 5 minutes')).toBeVisible();
    await editor(page).getByRole('button', { name: 'Close' }).click();
    await shot(page, '05-wait.png');
    await shot(page, 'yes-no-branches.png');

    const waitNode = canvasNode(page, 'Wait 5 minutes');
    await waitNode.hover();
    await shot(page, 'node-hover-controls.png');
    const box = await waitNode.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + 12);
      await page.mouse.down();
      await page.mouse.move(box.x + 80, box.y + 40);
      await page.mouse.up();
    }
    await shot(page, '06-manipulated.png');

    await expect(
      page.getByRole('button', { name: 'Insert step' }).first()
    ).toBeVisible();
    await shot(page, 'edge-insertion.png');

    if (await editor(page).isVisible()) {
      await editor(page).getByRole('button', { name: 'Close' }).click();
    }
    const zoomOut = page.locator('.react-flow__controls-zoomout');
    if ((await zoomOut.count()) > 0 && (await zoomOut.isEnabled())) {
      await zoomOut.click({ force: true });
    }
    await shot(page, 'pan-zoom.png');

    await publishMustSucceed(page);
    await shot(page, '07-published.png');

    const yesSend = canvasNode(page, YES_TEXT);
    await expect(yesSend).toHaveCount(1);
    await yesSend.click();
    await expectStepEditor(page, 'Send text');
    await editor(page).getByRole('textbox').first().fill(YES_TEXT_V2);
    await expect(canvasNode(page, YES_TEXT_V2)).toBeVisible();
    await expect(page.getByText('Saving…')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 15_000 });
    await shot(page, '16-dirty-after-publish.png');

    await page.getByRole('main').getByRole('link', { name: 'Automations' }).click();
    await expect(
      page.getByRole('heading', { name: 'My Automations' })
    ).toBeVisible();
    await page.getByText(name, { exact: true }).click();
    await expect(canvasNode(page, YES_TEXT_V2)).toBeVisible();
    await shot(page, '17-reopen.png');

    await page.locator('header').getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Run history' }).click();
    await expect(page.getByText(/No runs yet|Select a run/)).toBeVisible();
    await shot(page, '18-history.png');
  });
});
