const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const assert = require('node:assert/strict');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cairn-workspace-'));
 const profile=path.join(root,'profile'), file=path.join(profile,'workspace.json');
 const target=path.join(fs.realpathSync(root),'恢复 项目'); fs.mkdirSync(target);
 let app; const errors=[];
 const launch=async()=>{
  const config=process.env.HARBOR_PACKAGED ? {executablePath:path.resolve('release/Cairn-darwin-arm64/Cairn.app/Contents/MacOS/Cairn'),args:[]} : {args:[process.cwd()]};
  app=await electron.launch({...config,args:[...config.args,`--user-data-dir=${profile}`],env:{...process.env,ELECTRON_RUN_AS_NODE:''}});
  const page=await app.firstWindow(); page.on('pageerror',e=>errors.push(e.message));
  await expect(page.locator('#new-terminal')).toBeEnabled(); return page;
 };
 const quit=async()=>{
  const exited=new Promise(r=>app.process().once('exit',r));
  await app.evaluate(({app,dialog})=>{dialog.showMessageBoxSync=()=>1;app.quit();});
  await exited; app=null;
 };
 const rename=async(page,name)=>{await page.locator('#rename').click();await page.locator('#name-input').fill(name);await page.locator('.primary').click();};
 const read=()=>JSON.parse(fs.readFileSync(file,'utf8'));
 try {
  let page=await launch();await expect(page.locator('.session-item')).toHaveCount(1);
  await rename(page,'前端开发');
  const first=await page.locator('.session-item').getAttribute('data-id');
  await page.evaluate(({id,cwd})=>window.harbor.input(id,`cd '${cwd}'; export CAIRN_RESTORE_TEST=old; printf '\\nOLD_SESSION_OUTPUT\\n'\r`),{id:first,cwd:target});
  await expect(page.locator('#cwd')).toHaveText(`当前目录 · ${target}`,{timeout:10000});
  await page.locator('#new-terminal').click();await expect(page.locator('.session-item')).toHaveCount(2);await rename(page,'后端服务');
  await expect.poll(()=>read().activeIndex).toBe(1);
  await quit();page=await launch();
  await expect(page.locator('.session-name')).toHaveText(['前端开发','后端服务']);
  await expect(page.locator('#active-title')).toHaveText('后端服务');
  await page.locator('.session-item').first().click();
  await expect(page.locator('#cwd')).toHaveText(`当前目录 · ${target}`,{timeout:10000});
  await expect(page.locator('.terminal-pane:not([hidden]) .xterm-screen')).not.toContainText('OLD_SESSION_OUTPUT');
  const restored=await page.locator('.session-item.active').getAttribute('data-id');assert.notEqual(restored,first);
  await page.evaluate(id=>window.harbor.input(id,"printf '\\nRESTORE_ENV_%s\\n' ${CAIRN_RESTORE_TEST:-fresh}\r"),restored);
  await expect(page.locator('.terminal-pane:not([hidden]) .xterm-screen')).toContainText('RESTORE_ENV_fresh');
  await quit();fs.rmdirSync(target);page=await launch();
  await expect(page.locator('.session-name')).toHaveText(['前端开发','后端服务']);
  await expect(page.locator('#toast')).toContainText('已回到主目录');
  await expect(page.locator('#cwd')).toContainText(os.homedir());
  await page.locator('#settings-toggle').click();await page.locator('#restore-workspace').uncheck();
  await expect.poll(()=>read().restoreEnabled).toBe(false);assert.deepEqual(read().sessions,[]);
  await quit();page=await launch();await expect(page.locator('.session-name')).toHaveText(['终端 1']);
  await page.locator('#settings-toggle').click();await expect(page.locator('#restore-workspace')).not.toBeChecked();
  await page.locator('#restore-workspace').check();await expect.poll(()=>read().restoreEnabled).toBe(true);
  fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/workspace-settings.png'});
  await page.keyboard.press('Escape');
  const last=await page.locator('.session-item').getAttribute('data-id');
  await page.evaluate(id=>window.harbor.input(id,'exit\r'),last);await expect(page.locator('#session-state')).toHaveAttribute('data-state','ended');
  await page.locator('#close-terminal').click();await expect(page.locator('.session-item')).toHaveCount(0);
  await quit();page=await launch();await expect(page.locator('.session-item')).toHaveCount(0);await expect(page.locator('#empty')).toBeVisible();
  await quit();fs.writeFileSync(file,'{broken');page=await launch();await expect(page.locator('.session-item')).toHaveCount(1);
  await expect(page.locator('#toast')).toContainText('无法读取');
  assert(fs.readdirSync(profile).some(n=>n.startsWith('workspace.json.invalid-')));assert.deepEqual(errors,[]);
  console.log('PASS: real quit/relaunch, names/order/active cwd, fresh processes and output, missing directory fallback, restore toggle, empty workspace, corrupt-file recovery.');
 } finally {if(app)await quit();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
