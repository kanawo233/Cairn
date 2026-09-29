const {_electron:electron}=require('@playwright/test');
const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cairn-appearance-'));
 let app;
 const launch=async()=>{
  const options=process.env.HARBOR_PACKAGED?{executablePath:path.resolve('release/Cairn-darwin-arm64/Cairn.app/Contents/MacOS/Cairn'),args:[]}:{args:[process.cwd()]};
  app=await electron.launch({...options,args:[...options.args,`--user-data-dir=${profile}`],env:{...process.env,ELECTRON_RUN_AS_NODE:''}});
  const page=await app.firstWindow();await page.emulateMedia({colorScheme:null});await page.locator('.session-item').waitFor();return page;
 };
 const quit=async()=>{const exited=new Promise(r=>app.process().once('exit',r));await app.evaluate(({app})=>app.exit(0));await exited;app=null;};
 try{
  let page=await launch();
  await page.locator('#settings-toggle').click();
  assert.equal(await page.locator('#theme').inputValue(),'system');
  for(const color of ['light','dark']){
   await app.evaluate(({nativeTheme},color)=>{nativeTheme.themeSource=color;},color);
   await page.waitForFunction(color=>document.documentElement.dataset.theme===color,color);
  }
  await page.locator('#theme').selectOption('light');
  await app.evaluate(({nativeTheme})=>{nativeTheme.themeSource='dark';});
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  await page.locator('#font-size').fill('19');await page.locator('#font-size').dispatchEvent('change');
  await page.locator('#line-numbers-toggle').uncheck();
  await quit();page=await launch();await page.locator('#settings-toggle').click();
  assert.equal(await page.locator('#theme').inputValue(),'light');
  assert.equal(await page.locator('#font-size').inputValue(),'19');
  assert.equal(await page.locator('#line-numbers-toggle').isChecked(),false);
  await page.locator('#theme').selectOption('system');await quit();page=await launch();
  await page.locator('#settings-toggle').click();assert.equal(await page.locator('#theme').inputValue(),'system');
  for(const color of ['dark','light']){
   await app.evaluate(({nativeTheme},color)=>{nativeTheme.themeSource=color;},color);
   await page.waitForFunction(color=>document.documentElement.dataset.theme===color,color);
  }
  console.log('PASS: OS theme updates, manual override, font/line-number/theme persistence across real restarts, restored system mode remains reactive.');
 }finally{if(app)await quit();await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
})().catch(e=>{console.error(e);process.exitCode=1;});
