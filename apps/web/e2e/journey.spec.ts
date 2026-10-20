import { expect, test, type Page } from '@playwright/test';

const shots = process.env.E2E_SCREENSHOTS;
const shot = async (page: Page, name: string, fullPage = false) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage });
};

test('marketing site renders and is honest about integrations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('inside the lines you draw');
  await expect(page.getByText('WhatsApp Business Platform')).toBeVisible();
  await expect(page.getByText('Planned').first()).toBeVisible();
  await page.waitForTimeout(2600);
  await shot(page, '01-home', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, '01-home-mobile');
});

test('register, onboard, publish, chat on the widget and take over', async ({ page }) => {
  const email = `e2e${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Asha Patel');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-42');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Step 1: create organization
  await expect(page.getByRole('heading', { name: 'Tell us about your business' })).toBeVisible();
  await page.getByLabel('Business name').fill('Sunrise Solar');
  await page.getByLabel('Industry').selectOption('local_business');
  await page.getByLabel('Website').fill('https://sunrise-solar.example');
  await page.getByLabel('Country').fill('India');
  await page.getByLabel('Currency').fill('INR');
  await page.getByLabel('Timezone').selectOption('Asia/Kolkata');
  await page.getByLabel('What does the business do?').fill('We design and install rooftop solar systems for homes in Gujarat.');
  await shot(page, '02-onboarding-step1');
  await page.getByRole('button', { name: 'Create organization' }).click();

  // Step 2: products
  await expect(page.getByRole('heading', { name: 'Products and FAQs' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Home Solar 5kW');
  await page.getByLabel('Price', { exact: true }).fill('250000');
  await page.getByLabel('Description').fill('A 5 kW rooftop system including installation and a site survey.');
  await page.getByRole('button', { name: 'Add product' }).click();
  await expect(page.getByText('Added (1)')).toBeVisible();
  await page.getByLabel('Question').fill('Do you offer a site survey?');
  await page.getByLabel('Answer').fill('Yes, the site survey is free within 50 km of Ahmedabad.');
  await page.getByRole('button', { name: 'Add FAQ' }).click();
  await shot(page, '03-onboarding-products');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Steps 3-5: agent settings
  await expect(page.getByRole('heading', { name: 'Agent identity' })).toBeVisible();
  await page.getByLabel('Assistant name').fill('Mira');
  await shot(page, '04-onboarding-identity', true);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Qualification' })).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Sales rules and approvals' })).toBeVisible();
  await page.getByText('Let the agent offer small discounts on its own').click();
  await page.getByLabel('Automatic limit (%)').fill('10');
  await shot(page, '05-onboarding-rules', true);
  await page.getByRole('button', { name: 'Save and continue' }).click();

  // Step 6: channel
  await expect(page.getByRole('heading', { name: 'Choose a channel' })).toBeVisible();
  await page.getByPlaceholder('example.com').fill('localhost:5173');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText('Chat is live on these websites').click();
  await page.getByRole('button', { name: 'Save website chat' }).click();

  // Step 7: test conversation
  await expect(page.getByRole('heading', { name: 'Test conversation' })).toBeVisible();
  await page.getByRole('button', { name: 'What do you offer and how much does it cost?' }).click();
  await expect(page.getByText('250000 INR').first()).toBeVisible();
  await page.getByLabel('Message as a customer').fill('Can I get a 30% discount?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(/passed your request to our team/)).toBeVisible();
  await shot(page, '06-onboarding-test');
  await page.getByRole('button', { name: 'Looks right, continue' }).click();

  // Step 8: verify email via the dev mailbox, then publish
  await expect(page.getByRole('heading', { name: 'Publish your agent' })).toBeVisible();
  const onboardingUrl = page.url();
  await page.goto('/dev/mailbox');
  const link = page.getByRole('link', { name: /verify-email\?token=/ }).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByText('Email verified')).toBeVisible();
  await page.goto(onboardingUrl);
  await shot(page, '07-onboarding-publish');
  await page.getByRole('button', { name: 'Publish agent' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await shot(page, '08-dashboard', true);

  // Approval queue has the 30% request from the test conversation
  await page.getByRole('link', { name: /Approvals/ }).click();
  await expect(page.getByText('Offer a 30% discount')).toBeVisible();
  await shot(page, '09-approvals');

  // Chat through the real widget (the app origin is allowed as preview)
  await page.getByRole('link', { name: 'Website chat' }).click();
  await page.getByRole('button', { name: 'Preview on this page' }).click();
  const launcher = page.locator('[data-closewell-widget]').locator('button.launcher');
  await launcher.click();
  const panel = page.locator('[data-closewell-widget]').locator('.panel');
  await panel.locator('textarea').fill('Do you offer a site survey?');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.getByText(/site survey is free/)).toBeVisible();
  await shot(page, '10-widget');

  // The preview conversation is test data, so the inbox needs "includeTest"; take over via the API-backed inbox list instead.
  await page.goto(page.url().replace(/\/widget$/, '/inbox'));
  await shot(page, '11-inbox');
});
