const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cairn-docking-'));const file=path.join(root,'workspace.json');let app;let page;
 const errors=[];
 const launch=async()=>{
  const config=process.env.HARBOR_PACKAGED?{executablePath:path.resolve('release/Cairn-darwin-arm64/Cairn.app/Contents/MacOS/Cairn'),args:[]}:{args:[process.cwd()]};
  app=await electron.launch({...config,args:[...config.args,`--user-data-dir=${root}`],env:{...process.env,ELECTRON_RUN_AS_NODE:''}});
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await expect(page.locator('#new-terminal')).toBeEnabled();return page;
 };
 const quit=async()=>{const exited=new Promise(r=>app.process().once('exit',r));await app.evaluate(({app,dialog})=>{dialog.showMessageBoxSync=()=>1;app.quit();});await exited;app=null;};
 const drag=async(source,target,targetPosition)=>{
  await page.evaluate(()=>Promise.all(document.getAnimations().filter(animation=>animation.effect.getTiming().iterations !== Infinity).map(animation=>animation.finished.catch(()=>{}))));
  const from=await source.boundingBox(),to=await target.boundingBox();
  const x=from.x+Math.min(80,from.width/2),y=from.y+from.height/2;
  const endX=to.x+targetPosition.x,endY=to.y+targetPosition.y;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+12,y+3,{steps:4});
  await page.mouse.move(endX,endY,{steps:10});await page.mouse.move(endX+1,endY);
  await page.mouse.up();
 };
 const read=()=>JSON.parse(fs.readFileSync(file,'utf8'));
 try{
  page=await launch();await page.locator('#new-terminal').click();await expect(page.locator('.session-item')).toHaveCount(2);await page.locator('#new-terminal').click();await expect(page.locator('.session-item')).toHaveCount(3);
  const ids=await page.locator('.session-item').evaluateAll(items=>items.map(el=>el.dataset.id));
  const row=id=>page.locator(`.session-item[data-id="${id}"]`),slot=id=>page.locator(`.dock-slot[data-id="${id}"]`);
  await drag(row(ids[0]),row(ids[2]),{x:80,y:55});
  await expect(page.locator('.session-name')).toHaveText(['终端 2','终端 3','终端 1']);
  await expect.poll(()=>read().sessions.map(s=>s.name)).toEqual(['终端 2','终端 3','终端 1']);
  let box=await slot(ids[2]).boundingBox();
  const sourceBox=await row(ids[1]).boundingBox();
  await page.mouse.move(sourceBox.x+80,sourceBox.y+25);await page.mouse.down();
  await page.mouse.move(sourceBox.x+100,sourceBox.y+30,{steps:4});
  await page.mouse.move(box.x+20,box.y+box.height/2,{steps:10});
  await page.mouse.move(box.x+21,box.y+box.height/2);
  await expect(page.locator('#terminals')).toHaveClass(/live-dock-preview/);
  await expect.poll(async()=>(await slot(ids[2]).boundingBox()).x).toBeGreaterThan(box.x+box.width*.4);
  await expect(page.locator(`.terminal-pane[data-id="${ids[1]}"]`)).toBeVisible();
  await expect(page.locator('.snap-placeholder')).toBeVisible();
  await expect(page.locator('.snap-placeholder')).toContainText('松手放置');
  // Preview moves real panes but does not save a layout before mouse release.
  assert.equal(read().layout.id,1);
  fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/docking-preview.png'});
  // Moving from an edge into the center cancels the preview without replacing a pane.
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:4});
  await expect(page.locator('#terminals')).not.toHaveClass(/live-dock-preview/);
  await expect(page.locator('.snap-placeholder')).toHaveCount(0);
  await expect.poll(async()=>(await slot(ids[2]).boundingBox()).width).toBeCloseTo(box.width,0);
  await expect(page.locator(`.terminal-pane[data-id="${ids[1]}"]`)).toBeHidden();
  assert.equal(read().layout.id,1);
  await page.mouse.move(box.x+20,box.y+box.height/2,{steps:4});await page.mouse.move(box.x+21,box.y+box.height/2);
  await expect(page.locator('#terminals')).toHaveClass(/live-dock-preview/);
  await page.mouse.up();
  await expect(page.locator('.dock-slot')).toHaveCount(2);
  await expect(slot(ids[1])).toBeVisible();
  await expect.poll(async()=>(await slot(ids[2]).boundingBox()).x-(await slot(ids[1]).boundingBox()).x).toBeGreaterThan(0);
  box=await slot(ids[2]).boundingBox();
  await drag(row(ids[0]),slot(ids[2]),{x:box.width/2,y:10});
  await expect(page.locator('.dock-slot')).toHaveCount(3);
  await expect.poll(async()=>(await slot(ids[2]).boundingBox()).y-(await slot(ids[0]).boundingBox()).y).toBeGreaterThan(0);
  const splitLayout=read().layout;
  box=await slot(ids[2]).boundingBox();
  await drag(slot(ids[1]).locator('.pane-title'),slot(ids[2]),{x:box.width/2,y:box.height/2});
  await expect(page.locator('.dock-slot')).toHaveCount(3);
  await expect(page.locator('.snap-placeholder')).toHaveCount(0);
  assert.deepEqual(read().layout,splitLayout);
  for(const [index,id] of ids.entries()){
   await page.evaluate(({id,index})=>window.harbor.input(id,`export DOCK_TEST=${index}; printf '\\nPANE_%s\\n' $DOCK_TEST\r`),{id,index});
   await expect(slot(id).locator('.xterm-screen')).toContainText(`PANE_${index}`);
  }
  await slot(ids[1]).locator('.xterm-helper-textarea').click();
  await page.keyboard.type("printf '\\nFOCUSED_%s\\n' $DOCK_TEST");await page.keyboard.press('Enter');
  await expect(slot(ids[1]).locator('.xterm-screen')).toContainText('FOCUSED_1');
  await expect(page.locator('#active-title')).toHaveText('终端 2');
  await page.locator('#search-toggle').click();await page.locator('#search-input').fill('FOCUSED_1');
  await expect(page.locator('#search-count')).toHaveText('1 / 1');
  await slot(ids[0]).locator('.pane-title').click();await expect(page.locator('#search-count')).toHaveText('无匹配');
  await page.locator('#search-close').click();
  const separator=page.locator('.dock-canvas>.dock-branch>.dock-separator');
  const before=await slot(ids[1]).boundingBox(), handle=await separator.boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+90,handle.y+handle.height/2,{steps:12});await page.mouse.up();
  await expect.poll(async()=>(await slot(ids[1]).boundingBox()).width).toBeGreaterThan(before.width+40);
  await expect.poll(()=>read().layout.ratio).toBeGreaterThan(.55);
  // Move an existing pane by its header, keeping its original shell alive.
  box=await slot(ids[0]).boundingBox();
  await drag(slot(ids[1]).locator('.pane-title'),slot(ids[0]),{x:box.width-10,y:box.height/2});
  await expect(page.locator('.dock-slot')).toHaveCount(3);
  await expect.poll(async()=>(await slot(ids[1]).boundingBox()).x-(await slot(ids[0]).boundingBox()).x).toBeGreaterThan(0);
  await expect(slot(ids[1]).locator('.xterm-screen')).toContainText('FOCUSED_1');
  fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/docking.png'});
  await page.locator('#settings-toggle').click();await page.locator('#theme').selectOption('dark');await page.keyboard.press('Escape');
  await page.screenshot({path:'test-results/docking-dark.png'});
  const layout=read().layout;await quit();page=await launch();
  await expect(page.locator('.session-name')).toHaveText(['终端 2','终端 3','终端 1']);
  await expect(page.locator('.dock-slot')).toHaveCount(3);
  await expect.poll(()=>read().layout).toEqual(layout);
  // Closing a visible session collapses its slot and preserves the other panes.
  const closeId=await page.locator('.session-item.active').getAttribute('data-id');
  await page.evaluate(id=>window.harbor.input(id,'exit\r'),closeId);
  await expect(page.locator('#session-state')).toHaveAttribute('data-state','ended');
  await page.locator('#close-terminal').click();
  await expect(page.locator('.dock-slot')).toHaveCount(2);await expect(page.locator('.session-item')).toHaveCount(2);
  await page.locator('.pane-hide').first().click();await expect(page.locator('.dock-slot')).toHaveCount(1);await expect(page.locator('.session-item')).toHaveCount(2);
  // Bring the hidden session back, then maximize one pane.
  const hiddenId=await page.locator('.session-item:not(.active)').getAttribute('data-id');
  const visibleSlot=page.locator('.dock-slot');const visibleBox=await visibleSlot.boundingBox();
  await drag(page.locator(`.session-item[data-id="${hiddenId}"]`),visibleSlot,{x:visibleBox.width/2,y:visibleBox.height-10});
  await expect(page.locator('.dock-slot')).toHaveCount(2);
  await page.locator('.pane-maximize').first().click();await expect(page.locator('.dock-slot')).toHaveCount(1);await expect(page.locator('.session-item')).toHaveCount(2);
  assert.deepEqual(errors,[]);
  console.log('PASS: native drag sidebar order, edge docking, nested splits, focus/input isolation, separator resize, header redocking, retained PTYs, restart layout/order, hide and maximize.');
 }catch(error){console.error('TEST ERROR:',error);throw error;}finally{if(app){await page.keyboard.press('Escape');await page.mouse.up();await quit();}fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
