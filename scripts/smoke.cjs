const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const {IDBFactory}=require('fake-indexeddb');
const root=path.resolve(__dirname,'..');
const modulePaths={"app.js": "js/app.js", "state.js": "js/core/state.js", "api.js": "js/core/api.js", "utils.js": "js/core/utils.js", "pwa.js": "js/core/pwa.js", "storage.js": "js/storage/storage.js", "download-store.js": "js/storage/download-store.js", "library.js": "js/library/library.js", "library-service.js": "js/library/library-service.js", "playlists.js": "js/library/playlists.js", "backup.js": "js/library/backup.js", "player.js": "js/player/player.js", "sleep-timer.js": "js/player/sleep-timer.js", "mobile-downloads.js": "js/downloads/mobile-downloads.js", "bilibili.js": "js/downloads/bilibili.js", "transfer.js": "js/downloads/transfer.js", "sync.js": "js/sync/sync.js", "qr-scanner.js": "js/sync/qr-scanner.js", "ui.js": "js/ui/ui.js", "playlist-view.js": "js/ui/playlist-view.js", "settings.js": "js/ui/settings.js"};
async function run(baseline,mobile){
 const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(fs.readFileSync(root+'/index.html','utf8'),{url:'https://example.test/Gama-Music-Web/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
 const w=dom.window,ctx=dom.getInternalVMContext();
 Object.assign(w,{indexedDB:new IDBFactory(),Blob,TextEncoder,TextDecoder,AbortController,Response,Request,Headers,fetch:async()=>{throw new Error('offline test')},matchMedia:q=>({matches:mobile,addEventListener(){},removeEventListener(){}})});
 w.URL.createObjectURL=()=> 'blob:stable-test';w.URL.revokeObjectURL=()=>{};
 w.HTMLMediaElement.prototype.play=async function(){};w.HTMLMediaElement.prototype.pause=function(){};w.HTMLMediaElement.prototype.load=function(){};
 w.setInterval=()=>1;w.clearInterval=()=>{};
 const start=[];const add=w.document.addEventListener.bind(w.document);w.document.addEventListener=(type,listener,opts)=>type==='DOMContentLoaded'?start.push(listener):add(type,listener,opts);
 const mods=new Map();function get(file){file=modulePaths[file]||file;if(mods.has(file))return mods.get(file);let code=fs.readFileSync(root+'/'+file,'utf8');if(baseline&&file==='js/app.js')code=fs.readFileSync(process.env.BASELINE_APP,'utf8');if(baseline&&file==='js/app.js')code+='\nexport { saveTrackBlobToIphone, savePlaylistToIphone, resumeMobileDownloads, retryMobileDownloadFailures, cancelMobileDownload };'; if(!baseline&&file===modulePaths['mobile-downloads.js'])code+='\nexport { retryMobileDownloadFailures, cancelMobileDownload };';const m=new vm.SourceTextModule(code,{context:ctx,identifier:file});mods.set(file,m);return m;}
 const entry=get('app.js');await entry.link((s,ref)=>get(baseline&&ref.identifier==='js/app.js'?path.posix.basename(s):path.posix.normalize(path.posix.join(path.posix.dirname(ref.identifier),s))));await entry.evaluate();
 const storage=mods.get(modulePaths['storage.js']).namespace;const {state,storageKeys}=mods.get(modulePaths['state.js']).namespace;
 const track={id:'test-track',title:'测试 <歌曲>',artist:'Gama',duration:65,createdAt:'2026-01-01',sourceUrl:'https://example.test/source'};
 await storage.putOfflineTrack({trackId:track.id,track,blob:new Blob(['audio'],{type:'audio/mpeg'})});
 await storage.cacheLibrary({tracks:[track,{id:'stale',title:'旧目录'}],playlists:[{id:'p1',name:'列表',trackIds:[track.id,'stale'],localOnly:true}]});
 w.localStorage.setItem(storageKeys.mobileDownloadFailures,JSON.stringify({p1:[{trackId:'test-track',title:'失败歌曲',type:'cover'}]}));
 for(const fn of start)await fn();
 assert.equal(state.library.tracks.length,1);assert.equal(state.library.playlists[0].trackIds.length,1);assert.equal(w.document.querySelector('#libraryCount').textContent,'1 首');
 assert(state.playlistSaveJobs.has('p1'));
 const initial=w.document.body.innerHTML;
 w.document.querySelector('#settingsButton').click();const settings=w.document.querySelector('#modalBody').innerHTML;assert(!w.document.querySelector('#modal').classList.contains('hidden'));
 w.document.querySelector('#modalCloseButton').click();assert(w.document.querySelector('#modal').classList.contains('hidden'));
 w.document.querySelector('#sleepTimerButton').click();const sleep=w.document.querySelector('#modalBody').innerHTML;
 w.document.querySelector('#modalCloseButton').click();
 w.document.querySelector('#mobileDownloadsButton').click();const downloads=w.document.querySelector('#modalBody').innerHTML;
 const playlists=mods.get(modulePaths['playlists.js']).namespace;const p=playlists.createLocalPlaylist('新列表',['test-track']);assert(p.localOnly);playlists.renamePlaylist(p.id,'改名');playlists.removeTrackFromPlaylist(p.id,'test-track');playlists.addTrackToPlaylist(p.id,'test-track');playlists.deletePlaylist(p.id);assert.equal(state.library.playlists.length,1);
 if(!baseline){const d=mods.get(modulePaths['download-store.js']).namespace;
 d.addMobileDownloadJob('p1');d.addMobileDownloadJob('p1');assert.equal(d.getMobileDownloadQueue().length,1);d.setMobileDownloadPaused('p1',true);assert(d.isMobileDownloadPaused('p1'));d.setMobileDownloadPaused('p1',false);assert(!d.isMobileDownloadPaused('p1'));d.removeMobileDownloadJob('p1');assert.equal(d.getMobileDownloadQueue().length,0);
 for(let i=0;i<35;i++)d.addMobileDownloadHistory({playlistId:'h'+i,status:'done'});assert.equal(d.getMobileDownloadHistory().length,30);d.updateMobileDownloadHistory('h34',{status:'failed',message:'重试'});assert.equal(d.getMobileDownloadHistory()[0].status,'failed');d.clearStoredMobileDownloadHistory();assert.equal(d.getMobileDownloadHistory().length,0);
 d.storeMobileDownloadFailures('p1',[]);assert(!d.getStoredMobileDownloadFailures().p1);
 for(const key of ['mobileDownloadQueue','mobileDownloadHistory','mobileDownloadFailures'])w.localStorage.setItem(storageKeys[key],'{invalid');assert.equal(d.getMobileDownloadQueue().length,0);assert.equal(d.getMobileDownloadHistory().length,0);assert.equal(Object.keys(d.getStoredMobileDownloadFailures()).length,0);
 }

 const mobileApi=mods.get(modulePaths[baseline?'app.js':'mobile-downloads.js']).namespace;
 const dlTrack={id:'download-test',title:'下载测试',file:'test.mp3',cover:'test.jpg',localOnly:true};
 const requests=[];let coverFails=true;
 w.fetch=async url=>{if(String(url).includes('/api/'))return new Response('{}',{headers:{'Content-Type':'application/json'}});requests.push(String(url));return String(url).endsWith('.jpg')?new Response(coverFails?'fail':'cover',{status:coverFails?500:200}):new Response('music',{headers:{'Content-Length':'5','Content-Type':'audio/mpeg'}});};
 let progress=[];let result=await mobileApi.saveTrackBlobToIphone(dlTrack,p=>progress.push(p));
 assert.equal(result.audioStatus,'saved');assert.equal(result.coverStatus,'failed');assert.equal((await storage.getOfflineTrack(dlTrack.id)).blob.size,5);assert.equal(progress.at(-1),100);
 coverFails=false;requests.length=0;result=await mobileApi.saveTrackBlobToIphone(dlTrack);assert.equal(result.audioStatus,'exists');assert.equal(result.coverStatus,'saved');assert.equal(requests.length,1);assert(requests[0].endsWith('.jpg'));
 requests.length=0;result=await mobileApi.saveTrackBlobToIphone(dlTrack);assert.equal(requests.length,0);assert.equal(result.coverStatus,'exists');
 const queuedTrack={id:'queued',title:'队列测试',file:'queued.mp3',cover:'queued.jpg'};
 state.library.tracks.push(queuedTrack);state.library.playlists.push({id:'queue-test',name:'队列',trackIds:['queued']});state.serverConnected=false;
 await mobileApi.savePlaylistToIphone('queue-test');assert(state.playlistSaveJobs.get('queue-test').waitingForConnection);
 assert(JSON.parse(w.localStorage.getItem(storageKeys.mobileDownloadQueue)).includes('queue-test'));
 w.localStorage.setItem(storageKeys.mobileDownloadPaused,JSON.stringify(['queue-test']));state.serverConnected=true;requests.length=0;await mobileApi.resumeMobileDownloads();assert.equal(requests.length,0);
 w.localStorage.setItem(storageKeys.mobileDownloadPaused,'[]');coverFails=true;if(mobile)await mobileApi.resumeMobileDownloads();else await mobileApi.savePlaylistToIphone('queue-test');assert.equal(state.playlistSaveJobs.get('queue-test').failures.length,1);assert.equal((await storage.getOfflineTrack('queued')).blob.size,5);
 coverFails=false;requests.length=0;await mobileApi.retryMobileDownloadFailures('queue-test');assert.equal(state.playlistSaveJobs.get('queue-test').failures.length,0);assert.equal(requests.length,1);assert(requests[0].endsWith('.jpg'));assert(!JSON.parse(w.localStorage.getItem(storageKeys.mobileDownloadQueue)).includes('queue-test'));
 mobileApi.cancelMobileDownload('queue-test');assert.equal((await storage.getOfflineTrack('queued')).blob.size,5);
 assert.deepEqual(errors,[]);dom.window.close();return {initial,settings,sleep,downloads};
}
(async()=>{for(const mobile of [false,true]){const original=process.env.BASELINE_APP?await run(true,mobile):null;const current=await run(false,mobile);if(original)assert.deepEqual(current,original);console.log(`PASS ${mobile?'mobile PWA':'desktop'}: startup, cached library, stale metadata cleanup, failure restoration, settings/sleep/download dialogs, playlist persistence, audio/cover failures, deduplication, pause/resume, retry and cancel pass; baseline comparison: ${Boolean(original)}`);}})().catch(e=>{console.error(e);process.exitCode=1});
