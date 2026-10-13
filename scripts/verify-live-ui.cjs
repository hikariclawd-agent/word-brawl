const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({headless:true});
 const errors=[];
 async function pageFor(width,name){
  const page=await browser.newPage({viewport:{width,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(name=>{localStorage.setItem('animal-name-place/rules-seen/v1','true');localStorage.setItem('animal-name-place/player-name/v1',name);},name);
  await page.goto('http://127.0.0.1:8091');
  await page.getByText('Play Live Brawl',{exact:true}).waitFor({timeout:30000});
  return page;
 }
 try {
  for(const width of [390,1440]) {
   const p=await pageFor(width,'QA Edit '+width);
   let created, saved;
   p.on('response',async r=>{if(r.url().endsWith('/rpc/create_managed_room')&&r.ok())created=await r.json();if(r.url().endsWith('/rpc/update_online_room_settings')&&r.ok()){ saved=true; assert.equal(r.request().postDataJSON().p_room_id,created.roomId); }});
   await p.getByText('Practice',{exact:true}).click();
   await p.getByRole('button',{name:'Read More',exact:true}).click();
   assert(await p.getByText('5. The highest total',{exact:false}).isVisible());
   await p.getByRole('button',{name:'Show Less',exact:true}).click();
   assert.equal(await p.getByText('5. The highest total',{exact:false}).count(),0);
   await p.getByText('Start Practice',{exact:true}).click();
   await p.getByRole('button',{name:'Edit Brawl',exact:true}).click();
   assert.equal(await p.getByLabel('Brawl name',{exact:true}).inputValue(),'Practice');
   await p.getByLabel('More rounds',{exact:true}).click();
   await p.getByLabel('Brawl name',{exact:true}).fill('Cancelled name');
   await p.getByRole('button',{name:'Cancel changes'}).click();
   assert.equal(saved,undefined);
   assert(await p.getByText('5 rounds',{exact:true}).count()>0);
   await p.getByRole('button',{name:'Edit Brawl',exact:true}).click();
   assert.equal(await p.getByLabel('Brawl name',{exact:true}).inputValue(),'Practice');
   await p.getByLabel('More rounds',{exact:true}).click();
   await p.getByLabel('Brawl name',{exact:true}).fill('Play Live Brawl');
   await p.getByRole('button',{name:'Save Brawl',exact:true}).click();
   await p.getByRole('button',{name:'Edit Brawl',exact:true}).waitFor();
   assert(saved);assert(created.roomId);assert(await p.getByText('6 rounds',{exact:true}).count()>0);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await p.screenshot({path:'docs/live-edit-'+width+'.png',fullPage:true});
   console.log('PASS edit/save/cancel/help',width,'same room',created.roomId);
   await p.close();
  }
  const a=await pageFor(390,'QA Live A');const b=await pageFor(1440,'QA Live B');
  let joinA,joinB;let startCalls=0;
  for(const [p,set] of [[a,x=>joinA=x],[b,x=>joinB=x]]) {
   p.on('response',async r=>{if(r.url().endsWith('/rpc/find_or_create_public_room')&&r.ok())set(await r.json());});
   // Hold the actual advance request briefly to exercise the otherwise transient settings screen.
   await p.route('**/rpc/advance_live_brawl_session',async route=>{startCalls++;await new Promise(resolve=>setTimeout(resolve,8000));await route.continue();});
  }
  await Promise.all([a.getByText('Play Live Brawl',{exact:true}).click(),b.getByText('Play Live Brawl',{exact:true}).click()]);
  for(const [p,width] of [[a,390],[b,1440]]) {
   await p.getByText('Settings',{exact:true}).click();
   assert(await p.getByText('Live Brawl setup is locked for fair matchmaking.',{exact:true}).isVisible());
   assert.equal(await p.getByRole('button',{name:'Edit Brawl',exact:true}).count(),0);
   await p.getByText('Live Brawl setup is locked for fair matchmaking.',{exact:true}).scrollIntoViewIfNeeded();
   await p.screenshot({path:'docs/live-settings-'+width+'.png',fullPage:true});
  }
  await a.getByText('Submit Answers',{exact:true}).waitFor({timeout:20000});
  await b.getByText('Submit Answers',{exact:true}).waitFor({timeout:20000});
  assert.equal(joinA.roomId,joinB.roomId);assert.notEqual(joinA.playerId,joinB.playerId);
  console.log('PASS two-client match',joinA.roomId,'advances',startCalls);
  await Promise.all([a.getByText('Submit Answers',{exact:true}).click(),b.getByText('Submit Answers',{exact:true}).click()]);
  await Promise.all([a.getByText('Score the Round',{exact:true}).waitFor({timeout:20000}), b.getByText('Score the Round',{exact:true}).waitFor({timeout:20000})]);
  await a.bringToFront(); await a.getByText('Score the Round',{exact:true}).click();
  await b.bringToFront(); await b.getByText('Score the Round',{exact:true}).click();
  await a.waitForTimeout(1000);
  console.log('REVEAL A', (await a.locator('body').innerText()).slice(-3500));
  console.log('REVEAL B', (await b.locator('body').innerText()).slice(-1500));
  await a.screenshot({path:'docs/live-reveal-mobile.png',fullPage:true});
  for (const p of [a,b]) {
   await p.bringToFront();
   const help=p.getByText('Got it — start scoring',{exact:true});
   if(await help.count()) await help.click();
   for(let i=0;i<4;i++) await p.getByText('0 · No score',{exact:true}).nth(i).click();
   await p.getByText('Review Scores',{exact:true}).click();
  }
  await a.getByText('Finish Round',{exact:true}).waitFor({timeout:20000});
  await a.getByText('Finish Round',{exact:true}).click();
  await a.getByText('Leaderboard',{exact:true}).waitFor({timeout:20000});
  console.log('PASS round completion and shared leaderboard');
  assert.deepEqual(errors,[]);console.log('PASS no page exceptions');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
