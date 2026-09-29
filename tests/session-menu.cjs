const {_electron:electron}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'harbor-menu-'));
 const launch=process.env.HARBOR_PACKAGED?{executablePath:path.resolve('release/Cairn-darwin-arm64/Cairn.app/Contents/MacOS/Cairn'),args:[]}:{args:[process.cwd()]};
 const app=await electron.launch({...launch,args:[...launch.args,`--user-data-dir=${profile}`],env:{...process.env,ELECTRON_RUN_AS_NODE:''}});
 try{
  const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.locator('.session-item').waitFor();
  const first=await page.locator('.session-item').getAttribute('data-id');
  await page.evaluate(id=>window.harbor.input(id,"printf '\\nPID=%s\\n' $$\r"),first);
  await page.waitForFunction(()=>/PID=\d+/.test(document.querySelector('.xterm-screen').textContent));
  const pid=await page.locator('.xterm-screen').evaluate(el=>Number(el.textContent.match(/PID=(\d+)/)[1]));
  await page.locator('#new-terminal').click();await page.waitForFunction(()=>document.querySelectorAll('.session-item').length===2);
  const second=await page.locator('.session-item.active').getAttribute('data-id');
  const more=()=>page.locator(`.session-more[data-id="${first}"]`);
  await more().click();
  assert.equal(await page.locator('.session-item.active').getAttribute('data-id'),second);
  await page.locator('#session-menu-rename').click();await page.locator('#name-input').fill('后台服务');await page.locator('.primary').click();
  assert.equal(await page.locator(`.session-item[data-id="${first}"] .session-name`).textContent(),'后台服务');
  assert.equal(await page.locator('.session-item.active').getAttribute('data-id'),second);
  await more().click();await page.keyboard.press('ArrowDown');assert.equal(await page.locator('#session-menu-delete').evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#session-menu').isVisible(),false);assert.equal(await more().evaluate(el=>el===document.activeElement),true);
  await more().click();await page.locator('.section-title').click();assert.equal(await page.locator('#session-menu').isVisible(),false);
  await page.locator(`.session-item[data-id="${first}"]`).click({button:'right'});await page.locator('#session-menu').waitFor();
  // A background output refresh must preserve the menu's target.
  await page.evaluate(id=>window.harbor.input(id,"printf '\\nMENU_%s\\n' background\r"),first);
  await page.waitForTimeout(150);assert.equal(await page.locator('#session-menu').isVisible(),true);
  fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/session-menu.png'});
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0});});
  await page.locator('#session-menu-delete').click();await page.waitForTimeout(150);
  assert.equal(await page.locator('.session-item').count(),2);
  assert(await app.evaluate((_,pid)=>{try{process.kill(pid,0);return true;}catch{return false;}},pid));
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
  await more().click();await page.locator('#session-menu-delete').click();
  await page.waitForFunction(()=>document.querySelectorAll('.session-item').length===1);
  assert.equal(await page.locator('.session-item.active').getAttribute('data-id'),second);
  assert.equal(await app.evaluate((_,pid)=>{try{process.kill(pid,0);return true;}catch{return false;}},pid),false);
  await page.locator('.session-more').click();await page.locator('#session-menu-delete').click();
  await page.locator('#empty').waitFor({state:'visible'});assert.equal(await page.locator('.session-item').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: inactive-session rename; right-click and keyboard menus; outside dismissal; background updates; cancel preserves shell; delete kills only target shell; active deletion and empty state.');
 }finally{
  const exited=new Promise(resolve=>{const c=app.process();if(c.exitCode!==null)resolve();else c.once('exit',resolve);});
  await app.evaluate(({app})=>app.exit(0));await exited;await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
