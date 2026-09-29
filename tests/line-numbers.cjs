const { _electron: electron } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
(async () => {
 const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-lines-'));
 const launch = process.env.HARBOR_PACKAGED ? {executablePath:path.resolve('release/Cairn-darwin-arm64/Cairn.app/Contents/MacOS/Cairn'),args:[]} : {args:[process.cwd()]};
 const app = await electron.launch({...launch,args:[...launch.args,`--user-data-dir=${profile}`],env:{...process.env,ELECTRON_RUN_AS_NODE:''}});
 try {
  const page = await app.firstWindow();
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  const pane='.terminal-pane:not([hidden])';
  await page.locator(`${pane} .line-number`).first().waitFor();
  const id=await page.locator('.session-item.active').getAttribute('data-id');
  await page.evaluate(id=>window.harbor.input(id,"printf '\\033[3J\\033[H\\033[2J'; for i in {1..80}; do printf 'ROW_%03d\\n' $i; done\r"),id);
  await page.waitForFunction(()=>document.querySelector('.terminal-pane:not([hidden]) .xterm-screen').textContent.includes('ROW_080'));
  const verify=async()=>{
   await page.waitForFunction(()=>{
    const p=document.querySelector('.terminal-pane:not([hidden])');
    const rows=[...p.querySelectorAll('.xterm-rows > div')];
    const numbers=[...p.querySelectorAll('.line-number')];
    return rows.some(r=>/^ROW_\d+/.test(r.textContent)) && rows.every((r,i)=>{const match=r.textContent.match(/^ROW_(\d+)/);return !match || Number(match[1])===Number(numbers[i]?.textContent);});
   });
  };
  await verify();
  const firstBefore=Number(await page.locator(`${pane} .line-number`).first().textContent());
  assert(firstBefore>1);
  await page.locator(`${pane} .line-numbers`).hover(); await page.mouse.wheel(0,-300);
  await page.waitForFunction(n=>Number(document.querySelector('.terminal-pane:not([hidden]) .line-number').textContent)<n,firstBefore);
  await verify();
  await page.locator(`${pane} .xterm-screen`).hover(); await page.mouse.wheel(0,130);
  await verify();
  await page.locator('#settings-toggle').click(); await page.locator('#font-size').fill('19'); await page.locator('#font-size').dispatchEvent('change'); await page.keyboard.press('Escape');
  await verify();
  const alignment=await page.locator(pane).evaluate(p=>{const r=p.querySelector('.xterm-rows > div').getBoundingClientRect();const n=p.querySelector('.line-number').getBoundingClientRect();return {height:Math.abs(r.height-n.height),top:Math.abs(r.top-n.top)};});
  assert(alignment.height<1 && alignment.top<1,JSON.stringify(alignment));
  await page.locator('#settings-toggle').click(); await page.locator('#line-numbers-toggle').uncheck(); await page.keyboard.press('Escape');
  assert.equal(await page.locator(`${pane} .line-numbers`).isVisible(),false);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('harbor-appearance')).lineNumbers),false);
  await page.locator('#settings-toggle').click(); await page.locator('#line-numbers-toggle').check(); await page.keyboard.press('Escape'); await verify();
  await page.locator('#new-terminal').click(); await page.waitForFunction(()=>document.querySelectorAll('.session-item').length===2);
  assert.equal(await page.locator(`${pane} .line-number`).first().textContent(),'1');
  await page.locator('.session-item').first().click(); await verify();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,700)); await verify();
  await page.locator('#clear').click();
  await page.waitForFunction(()=>document.querySelector('.terminal-pane:not([hidden]) .line-number')?.textContent==='1');
  // Alternate-screen programs use their own row numbering and return to normal afterward.
  await page.evaluate(id=>window.harbor.input(id,"printf '\\033[?1049h\\033[HAPP_SCREEN'; sleep 1; printf '\\033[?1049l'\r"),id);
  await page.waitForFunction(()=>document.querySelector('.terminal-pane:not([hidden]) .xterm-screen').textContent.includes('APP_SCREEN'));
  assert.equal(await page.locator(`${pane} .line-number`).first().textContent(),'1');
  await page.waitForTimeout(1300);
  await page.evaluate(id=>window.harbor.input(id,"printf '\\033[3J\\033[H\\033[2J'; for i in {1..12}; do printf '示例输出，第 %s 行\\n' $i; done\r"),id);
  await page.waitForFunction(()=>document.querySelector('.terminal-pane:not([hidden]) .xterm-screen').textContent.includes('示例输出，第 12 行'));
  fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/line-numbers.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: visible line numbers match output, terminal/gutter scrolling, font alignment, toggle + stored preference, session switch, resize, clear and alternate screen.');
 } finally {
  const exited = new Promise(resolve => { const child=app.process(); if(child.exitCode !== null) resolve(); else child.once('exit',resolve); });
  await app.evaluate(({app})=>app.exit(0)); await exited;
  await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
