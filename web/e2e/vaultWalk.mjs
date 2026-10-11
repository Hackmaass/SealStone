// Demo steps 6-9 on the vault screen, shared by vault.e2e.mjs (pre-seeded vault) and wizard.e2e.mjs (fresh vault).
// Roles are switched with the 1-4 keys, exactly as a judge would.

export async function walkVault(page, { seeded, shot = async () => {}, log = console.log }) {
  const fail = (m) => {
    throw new Error(m);
  };
  const role = async (n) => {
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press(String(n));
    await page.waitForTimeout(500);
  };
  const row = (i) => page.locator(`[data-milestone="${i}"]`);
  const state = (i, s) => page.waitForSelector(`[data-milestone="${i}"][data-state="${s}"]`, { timeout: 20000 });
  const ledgerOk = async (why) => {
    const t = await page.locator(".ledger .stamp").innerText();
    if (!/Reconciled/.test(t) || /Does not/.test(t)) fail(`ledger must stay reconciled ${why}, saw: ${t}`);
  };
  const eqValue = async (label) => (await page.locator(`.eq tr:has(td:nth-child(2):text-is("${label}")) td:last-child`).first().innerText()).replace(/[^0-9.]/g, "");
  // The ledger counts up over ~250 ms, so poll instead of reading once.
  const eqIs = async (label, expected) => {
    let last = "";
    for (let i = 0; i < 40; i++) {
      last = await eqValue(label);
      if (last === expected) return;
      await page.waitForTimeout(150);
    }
    fail(`ledger "${label}" should read ${expected}, saw ${last}`);
  };
  const pickDemo = (name) => page.locator(`.sheet label.file:has-text("${name}") input`).check();
  const timeline = () => page.locator(".activity li").allInnerTexts();

  await page.waitForSelector('[data-testid="terms-badge"][data-result]', { timeout: 20000 });
  await page.waitForSelector(".ms-row");
  const badge = await page.locator('[data-testid="terms-badge"]').innerText();
  if (!/match the signed seal/.test(badge)) fail(`terms should verify against the chain, saw: ${badge}`);
  log(`terms verified: ${badge}`);
  await ledgerOk("at the start");
  await shot("v1-start");

  // ── M1: the provider submits (the seeded vault already has it submitted) ──
  if (!seeded) {
    await role(2);
    await row(0).locator('[data-action="markComplete"]').click();
    await pickDemo("m1-report.pdf");
    await page.click('.sheet button:has-text("Submit work")');
    await state(0, "Completed");
    log("provider submitted milestone 1 with the demo report (real SHA-256)");
  }
  await row(0).locator("text=Submitted file").waitFor();

  // ── a stranger tries things: the contract's own refusals, in plain words ──
  await role(4);
  await row(0).locator("summary:has-text('Try anyway')").click();
  await row(0).locator('[data-try="approve"]').click();
  await page.waitForSelector('.ms-row .revert:has-text("Only the client can")');
  await page.waitForSelector('.ms-row .revert:has-text("Nothing changed")');
  await ledgerOk("after a stranger's refused approval");
  log("a stranger's approval is refused: 'Only the client can approve'");

  // ── step 7: the swapped file ──
  await role(1);
  await row(0).locator('[data-action="approve"]').click();
  await pickDemo("m1-report-v2.pdf");
  await page.waitForSelector('.sheet .verdict:has-text("Different files")');
  const label = await page.locator('.sheet button:has-text("Send anyway")').innerText();
  if (!/contract decides/.test(label)) fail(`mismatch button label wrong: ${label}`);
  await shot("v2-approve-mismatch");
  await page.click('.sheet button:has-text("Send anyway")');
  await page.waitForSelector(`.ms-row .revert:has-text("isn't the file that was submitted")`);
  await page.waitForSelector('.ms-row .compare.mini .verdict:has-text("Different files")');
  const rawErr = await page.locator(".ms-row .revert .raw").innerText();
  if (!/DeliverableHashMismatch\(expected: 0x[0-9a-f]{64}, provided: 0x[0-9a-f]{64}\)/.test(rawErr)) fail(`raw error should show both hashes: ${rawErr}`);
  await ledgerOk("after the swapped-file approval");
  await shot("v3-mismatch-refused");
  log("swapped file refused with DeliverableHashMismatch; both hashes shown; ledger still reconciled");
  const tl = (await timeline()).join("\n");
  if (!/Rejected: this isn't the file that was submitted/.test(tl)) fail(`timeline should list the rejected attempt:\n${tl}`);
  log("the rejected attempt is in the activity timeline");

  // ── step 8: approve the right file, then the provider withdraws ──
  await row(0).locator('[data-action="approve"]').click();
  await pickDemo("m1-report.pdf");
  await page.waitForSelector('.sheet .verdict:has-text("Seals match")');
  await page.click('.sheet button:has-text("Approve and release 1.000 ETH")');
  await state(0, "Released");
  await ledgerOk("after the real approval");
  await eqIs("Owed, not yet withdrawn", "1.000");
  log("matching file approved; 1.000 ETH is owed to the provider");

  await role(2);
  await page.click('[data-action="withdraw"]');
  await page.waitForSelector('.activity li:has-text("withdrew 1.000 ETH")');
  await ledgerOk("after the withdrawal");
  await eqIs("Withdrawn", "1.000");
  log("provider withdrew 1.000 ETH; books balance");

  // ── step 9: milestone 2 is submitted, disputed, and refunded by the arbiter ──
  await row(1).locator('[data-action="markComplete"]').click();
  await pickDemo("m1-report.pdf");
  await page.click('.sheet button:has-text("Submit work")');
  await state(1, "Completed");
  await role(1);
  await row(1).locator('[data-action="dispute"]').click();
  await page.fill('.sheet textarea[aria-label]', "The app only recognised 1 of the 3 sample diseases in our test.");
  await page.click('.sheet button:has-text("Send to the arbiter")');
  await state(1, "Disputed");
  await role(3);
  const ctx = await row(1).innerText();
  if (!/Client's reason/.test(ctx) || !/only recognised 1 of the 3/.test(ctx)) fail(`the arbiter must see the client's reason next to the milestone:\n${ctx}`);
  if ((await row(1).locator("details.conditions").getAttribute("open")) === null) fail("what was agreed should be open for the arbiter on a disputed milestone");
  await row(1).locator('[data-action="refund"]').click();
  await page.fill('.sheet textarea[aria-label]', "The prototype did not meet the three-disease condition, so the money goes back.");
  await page.click('.sheet button:has-text("Refund 2.500 ETH")');
  await state(1, "Refunded");
  await ledgerOk("after the refund");
  log("dispute: arbiter saw the client's reason and refunded 2.500 ETH");
  await role(1);
  await page.click('[data-action="withdraw"]');
  await page.waitForSelector('.activity li:has-text("withdrew 2.500 ETH")');
  await ledgerOk("after the client withdrew the refund");

  // ── escalation with the time-control ──
  await role(2);
  await row(2).locator('[data-action="markComplete"]').click();
  await pickDemo("m1-report.pdf");
  await page.click('.sheet button:has-text("Submit work")');
  await state(2, "Completed");
  const esc = row(2).locator("button:has-text('Escalate to arbiter')");
  if (!(await esc.isDisabled())) fail("escalate must be locked during the review window");
  const why = await row(2).locator(".act-disabled .muted").innerText();
  if (!/Available in/.test(why)) fail(`a disabled escalate must say why: ${why}`);
  await row(2).locator("button:has-text('Demo control: skip the review window')").click();
  await page.waitForSelector("[data-milestone='2'] [data-action='escalate']:not([disabled])", { timeout: 15000 });
  await shot("v4-escalate-unlocked");
  await row(2).locator("[data-action='escalate']").click();
  await state(2, "Disputed");
  await role(3);
  if (!/client gave no reason/.test(await row(2).innerText())) fail("the arbiter should be told the client gave no reason");
  await row(2).locator('[data-action="release"]').click();
  await page.fill('.sheet textarea[aria-label]', "The deliverable meets the pilot conditions, so the team is paid.");
  await page.click('.sheet button:has-text("Release 1.500 ETH")');
  await state(2, "Released");
  await ledgerOk("after the escalated milestone was released");
  await page.waitForSelector("text=All milestones are settled");
  await shot("v5-closed");
  log("escalation worked after the time-advance control; arbiter released; the vault is closed");
  await role(2);
  await page.click('[data-action="withdraw"]');
  await page.waitForSelector('.activity li:has-text("withdrew 1.500 ETH")');
  await ledgerOk("after the last withdrawal");
  await eqIs("Contract balance", "0.000");
  log("all milestones settled; the contract balance is 0.000 and the ledger is still green");

  // ── Verify: ✓ for the real JSON, ✗ after changing one character ──
  await page.locator(".terms-panel summary").click();
  const headerBefore = await page.locator('[data-testid="terms-badge"]').innerText();
  await page.click('.terms-panel button:has-text("Check this text")');
  await page.waitForSelector('[data-testid="probe-result"][data-result="verified"]');
  const json = await page.inputValue('textarea[aria-label="Confirmed terms JSON"]');
  const edited = json.replace("Problem validation report", "Problem validation reporT");
  if (edited === json) fail("could not find the text to edit");
  await page.fill('textarea[aria-label="Confirmed terms JSON"]', edited);
  await page.click('.terms-panel button:has-text("Check this text")');
  await page.waitForSelector('[data-testid="probe-result"][data-result="mismatch"]');
  await page.waitForSelector('.terms-panel .verdict:has-text("Different terms")');
  // the experiment stays inside the panel: the page header still shows the verdict on the real stored terms
  if ((await page.locator('[data-testid="terms-badge"]').innerText()) !== headerBefore) fail("editing the verify text must not change the header badge");
  await shot("v6-verify-mismatch");
  log("Verify: one changed character turns the badge to a mismatch with two different seals");
  await page.click('.terms-panel button:has-text("Re-check the stored terms")');
  await page.waitForSelector('[data-testid="probe-result"][data-result="verified"]');
  log("Verify: re-checking the stored terms is a match again");
}

