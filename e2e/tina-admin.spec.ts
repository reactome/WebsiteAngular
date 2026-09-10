import { test, expect } from '@playwright/test';

// The content editor, and the one thing about it that matters more than the
// editing: it must not be reachable from the public internet. Authors reach it
// locally; on beta the origin refuses it, and nothing in this repository enforces
// that -- it is an Apache rule, so the only way to know it still holds is to ask.
//
// Written alongside the Tina dependency upgrades. An admin that stops loading is
// a broken authoring tool, and an admin that starts answering in public is worse
// than a broken one, so both directions are pinned.

/** Whether the suite is pointed at a real deployment rather than a dev server. */
function isPublicOrigin(baseURL: string | undefined) {
  return !!baseURL && !/localhost|127\.0\.0\.1|\[::1\]/.test(baseURL);
}

test.describe('Tina admin', () => {
  test('the editor is served for authors', async ({ page, baseURL }) => {
    test.skip(
      isPublicOrigin(baseURL),
      'the editor is deliberately refused on a public origin; the next test asserts that'
    );

    const response = await page.goto('/admin/index.html');
    expect(response?.status(), 'the admin entry point').toBe(200);

    // Its own markup, not the application's index.html served by the catch-all.
    // Tina boots into a #root and pulls its bundle from /admin/assets.
    const html = await page.content();
    expect(html, 'the admin page rather than the app shell').toMatch(/tina|admin/i);
  });

  test('the editor is not reachable from the public internet', async ({ request, baseURL }) => {
    test.skip(
      !isPublicOrigin(baseURL),
      'only meaningful against a deployment; a dev server serves the editor on purpose'
    );

    for (const path of ['/admin/index.html', '/admin/', '/admin']) {
      const response = await request.get(path, { maxRedirects: 0 }).catch(() => null);
      // Anything but a served page. 403 is what the origin does today; a redirect
      // to a login would also be fine. A 200 would mean the editor is open.
      expect(response?.status(), `${path} must not serve the editor`).not.toBe(200);
    }
  });
});
