const { _electron: electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-directories-'));
 const target = path.join(fs.realpathSync(root), "中文 空格 ' 项目"); fs.mkdirSync(target);
 const launch = process.env.HARBOR_PACKAGED ? { executablePath: path.resolve('release/Cairn-darwin-arm64/Cairn.app/Contents/MacOS/Cairn'), args: [] } : { args: [process.cwd()] };
 const app = await electron.launch({...launch, args:[...launch.args, `--user-data-dir=${root}/profile`], env:{...process.env,ELECTRON_RUN_AS_NODE:''}});
 try {
  const page = await app.firstWindow(); const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.locator('.session-item').waitFor();
  const first=await page.locator('.session-item').getAttribute('data-id');
  const send=(id,data)=>page.evaluate(({id,data})=>window.harbor.input(id,data),{id,data});
  const quote=s=>"'"+s.replaceAll("'", "'\\''")+"'";
  await send(first, `cd ${quote(target)}\r`);
  await expect(page.locator('#cwd')).toHaveText(`当前目录 · ${target}`,{timeout:10000});
  await page.locator('#new-terminal').click();
  await expect(page.locator('.session-item')).toHaveCount(2);
  const second=await page.locator('.session-item.active').getAttribute('data-id');
  await expect(page.locator('#cwd')).toHaveText(`当前目录 · ${target}`,{timeout:10000});
  await send(second, "printf '\\nACTUAL_DIRECTORY=%s\\n' \"$PWD\"\r");
  await expect(page.locator('.terminal-pane:not([hidden]) .xterm-screen')).toContainText('ACTUAL_DIRECTORY='+target);
  await send(second,'cd /\r');
  await expect(page.locator('#cwd')).toHaveText('当前目录 · /',{timeout:10000});
  // The background row's action must use that row's directory, not the active row.
  await page.locator(`.session-more[data-id="${first}"]`).click();
  await page.locator('#session-menu-new').click();
  await expect(page.locator('.session-item')).toHaveCount(3);
  await expect(page.locator('#cwd')).toHaveText(`当前目录 · ${target}`,{timeout:10000});
  await app.evaluate(({shell})=>{global.openedDirectory=null; shell.openPath=async p=>{global.openedDirectory=p;return '';};});
  await page.locator('#cwd').click();
  await expect.poll(()=>app.evaluate(()=>global.openedDirectory)).toBe(target);
  // A deleted cwd reports an actionable error; choosing a folder can still recover.
  fs.rmdirSync(target);
  await page.locator('#new-terminal').click();
  await expect(page.locator('#toast')).toContainText('目录不存在或无法访问');
  await expect(page.locator('.session-item')).toHaveCount(3);
  await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:['/']});});
  await page.locator('#new-folder').click();
  await expect(page.locator('.session-item')).toHaveCount(4);
  await expect(page.locator('#cwd')).toHaveText('当前目录 · /',{timeout:10000});
  assert.deepEqual(errors,[]);
  fs.mkdirSync('test-results',{recursive:true});
  await page.screenshot({path:'test-results/directories.png'});
  console.log('PASS: actual cwd tracking, Unicode/spaces/quotes, inherited shell cwd, background menu, Finder IPC, removed directory and folder recovery.');
 } finally {
  const exited=new Promise(r=>app.process().once('exit',r)); await app.evaluate(({app})=>app.exit(0)); await exited;
  fs.rmSync(root,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
