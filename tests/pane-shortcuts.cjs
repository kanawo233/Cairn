const { _electron: electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
(async () => {
 const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-pane-keys-'));
 const launch = process.env.HARBOR_PACKAGED ? { executablePath: path.resolve('release/Cairn-darwin-arm64/Cairn.app/Contents/MacOS/Cairn'), args: [] } : { args: [process.cwd()] };
 const app = await electron.launch({ ...launch, args: [...launch.args, `--user-data-dir=${profile}`], env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
 try {
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.session-item')).toHaveCount(1);
  const first = await page.locator('.session-item').getAttribute('data-id');
  const slot = id => page.locator(`.dock-slot[data-id="${id}"]`);
  const active = () => page.locator('.session-item.active').getAttribute('data-id');
  const command = async (id, data) => {
   await slot(id).locator('.xterm-helper-textarea').focus();
   await page.keyboard.type(data); await page.keyboard.press('Enter');
  };
  await command(first, 'cd /tmp');
  await page.keyboard.press('Meta+d');
  await expect(page.locator('.dock-slot')).toHaveCount(2);
  const second = await active(); assert.notEqual(second, first);
  await expect(slot(second).locator('.xterm-helper-textarea')).toBeFocused();
  await expect.poll(async () => (await slot(second).boundingBox()).x - (await slot(first).boundingBox()).x).toBeGreaterThan(0);
  await command(second, "printf '\\nKEY_CWD_%s\\n' $PWD");
  await expect(slot(second).locator('.xterm-screen')).toContainText('KEY_CWD_' + fs.realpathSync('/tmp'));
  await app.evaluate(({BrowserWindow}) => {
   const contents = BrowserWindow.getAllWindows()[0].webContents;
   contents.sendInputEvent({type:'keyDown',keyCode:'D',modifiers:['meta','shift']});
   contents.sendInputEvent({type:'keyUp',keyCode:'D',modifiers:['meta','shift']});
  });
  await expect(page.locator('.dock-slot')).toHaveCount(3);
  const third = await active();
  await expect.poll(async () => (await slot(third).boundingBox()).y - (await slot(second).boundingBox()).y).toBeGreaterThan(0);
  for (const [key, id] of [['Up', second], ['Down', third], ['Left', first], ['Right', second]]) {
   await page.keyboard.press(`Meta+Alt+Arrow${key}`);
   await expect.poll(active).toBe(id);
   await expect(slot(id).locator('.xterm-helper-textarea')).toBeFocused();
  }
  // Native accelerators must not split the workspace while editing a dialog.
  await page.locator('#settings-toggle').click();
  await page.keyboard.press('Meta+d');
  await expect(page.locator('.dock-slot')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+Alt+w');
  await expect(page.locator('.dock-slot')).toHaveCount(2);
  await expect(page.locator('.session-item')).toHaveCount(3);
  await page.evaluate(id => window.harbor.input(id, "printf '\\nSTILL_ALIVE_%s\\n' yes\r"), second);
  await page.locator(`.session-item[data-id="${second}"]`).click();
  await expect(slot(second).locator('.xterm-screen')).toContainText('STILL_ALIVE_yes');
  // Verify switching arrows do not insert escape sequences or characters into the shell.
  await command(second, "printf '\\nCLEAN_KEYS_%s\\n' ok");
  await expect(slot(second).locator('.xterm-screen')).toContainText('CLEAN_KEYS_ok');
  await page.keyboard.press('Meta+Alt+w');
  await expect(page.locator('.dock-slot')).toHaveCount(1);
  await page.keyboard.press('Meta+Alt+w');
  await expect(page.locator('.dock-slot')).toHaveCount(1);
  await expect(page.locator('.session-item')).toHaveCount(3);
  const visible = await active();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(740, 600));
  await page.keyboard.press('Meta+d');
  await expect(page.locator('.dock-slot')).toHaveCount(2);
  const last = await active();
  await page.keyboard.press('Meta+d');
  await expect(page.locator('#toast')).toContainText('当前区域太小');
  await expect(page.locator('.session-item')).toHaveCount(4);
  assert.equal(await active(), last); assert.notEqual(last, visible);
  const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === '分屏').submenu.items.filter(item => item.accelerator).map(item => item.accelerator));
  assert.equal(menu.length, 7);
  assert.deepEqual(errors, []);
  console.log('PASS: real split shortcuts, spatial focus, inherited directory, shell input isolation, dialog guard, retained sessions, single-pane and minimum-size guards, native menu.');
 } finally {
  const exited = new Promise(resolve => app.process().once('exit', resolve));
  await app.evaluate(({ app }) => app.exit(0)); await exited;
  fs.rmSync(profile, { recursive: true, force: true });
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
