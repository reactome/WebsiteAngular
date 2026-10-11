import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

// The FAQ page. A category with sub-categories shows them as tabs, the first one
// active, and its questions below.
//
// The page chose the default tab while rendering: the template asked whether a
// tab was active, and the answer wrote the default into the state the question
// list had already read. A development build reports that as NG0100 (the
// suite's Angular-error guard fails any test that sees it); a production build
// just renders from a value that changed underneath it.
test.describe('FAQ', () => {
  test('a category with tabs opens on its first, and switches', async ({ page }) => {
    await page.goto('/documentation/faq');
    const analysis = page.locator('.faq-category-content').filter({
      has: page.locator('.faq-tab'),
    });
    const tabs = analysis.locator('.faq-tab');
    await expect(tabs.first()).toBeVisible({ timeout: 60_000 });
    await expect(tabs.first()).toHaveClass(/active/);
    const firstQuestions = analysis.locator('.faq-item a');
    await expect(firstQuestions.first()).toHaveAttribute(
      'href',
      /\/documentation\/faq\/analysis\/api-and-r\//
    );

    await tabs.filter({ hasText: 'Fiviz' }).click();
    await expect(tabs.filter({ hasText: 'Fiviz' })).toHaveClass(/active/);
    await expect(tabs.first()).not.toHaveClass(/active/);
    await expect(analysis.locator('.faq-item a').first()).toHaveAttribute(
      'href',
      /\/documentation\/faq\/analysis\/fiviz\//
    );
  });

  test('a category without tabs lists its questions', async ({ page }) => {
    await page.goto('/documentation/faq');
    await expect(
      page.locator('a[href^="/documentation/faq/general-website/"]').first()
    ).toBeVisible({ timeout: 60_000 });
  });

  const answerIndex = (page: Page, status: number) =>
    page.route('**/content/documentation/faq/index.json', (route) =>
      route.fulfill({ status, contentType: 'text/plain', body: 'index failed' })
    );

  test('says the questions could not be loaded, rather than showing none', async ({ page }) => {
    const crashes: string[] = [];
    page.on('pageerror', (error) => crashes.push(error.message));
    await answerIndex(page, 500);
    await page.goto('/documentation/faq');
    await expect(page.getByRole('alert')).toContainText("Couldn't load the questions", {
      timeout: 60_000,
    });
    expect(crashes).toEqual([]);
  });

  test('says nothing failed when there is no FAQ index', async ({ page }) => {
    await answerIndex(page, 404);
    const answered = page.waitForResponse('**/content/documentation/faq/index.json');
    await page.goto('/documentation/faq');
    await answered;
    await expect(page.getByRole('heading', { name: 'Frequently Asked Questions' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
