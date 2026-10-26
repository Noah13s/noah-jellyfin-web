const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const id = 'b2cb227f4e34797e421fda40bc7bd821';
function setup({cancel=false,failPlay=false,storage,userId='profile5'}={}) {
  const calls=[],listeners={};
  const events = () => {
    const handlers = {};
    return {visibilityState:'visible',addEventListener:(name,fn)=>(handlers[name] ||= []).push(fn),
      removeEventListener:(name,fn)=>{handlers[name]=(handlers[name]||[]).filter(h=>h!==fn);},
      dispatch:(name,event={})=>(handlers[name]||[]).forEach(fn=>fn(event))};
  };
  const parent=events();parent.document=events();
  const document=events();document.head={appendChild:()=>{}};document.createElement=()=>({});
  const local={name:'local',isLocalPlayer:true};
  const cast={name:'Chromecast',isLocalPlayer:false,tryPair:()=>{
    calls.push(['pair']); return cancel?Promise.reject(Error('Cancelled')):Promise.resolve();
  }};
  let current=local,target;
  const targets=[{id:'local',isLocalPlayer:true,playableMediaTypes:['Video']},
    {id:'speaker',playerName:'Chromecast',isLocalPlayer:false,playableMediaTypes:['Audio']},
    {id:'cast',playerName:'Chromecast',name:'Chromecast',deviceName:'Living room',isLocalPlayer:false,playableMediaTypes:['Video']}];
  const item={Id:id,Name:'First Buddy',Type:'Episode',ParentIndexNumber:1,IndexNumber:6,UserData:{PlaybackPositionTicks:9000000000}};
  const api={getCurrentUserId:()=> userId,serverId:()=> 'server',getItem:async(user,itemId)=>{
    calls.push(['item',user,itemId]);return item;
  }};
  const manager={getPlayers:()=>[local,cast],getTargets:async()=>targets,getCurrentPlayer:()=>current,
    getPlayerInfo:()=>target?{id:target.id,name:cast.name,deviceName:target.deviceName,isLocalPlayer:false}:{name:'local',isLocalPlayer:true},
    setActivePlayer:(p,t)=>{current=typeof p==='string'?cast:p;target=t;calls.push(['active']);},
    setDefaultPlayerActive:()=>{current=local;target=undefined;calls.push(['local']);},
    play:async options=>{calls.push(['play',options]);if(failPlay)throw Error('Unavailable');},
    getPlayerState:()=>({NowPlayingItem:{...item,RunTimeTicks:14531270000},PlayState:{PositionTicks:8202033590,IsPaused:true,VolumeLevel:40,CanSeek:true,PlayMethod:'DirectPlay'}}),
    getSupportedCommands:()=>['SetVolume'],pause:p=>calls.push(['pause',p]),unpause:p=>calls.push(['unpause',p]),
    seek:(ticks,p)=>calls.push(['seek',ticks,p]),setVolume:(value,p)=>calls.push(['volume',value,p]),stop:async p=>calls.push(['stop',p])};
  const env={URLSearchParams,setTimeout,clearTimeout,location:{search:'?seerrCast=1'},parent,document,addEventListener:(name,fn)=>{
    const previous=listeners[name];listeners[name]=event=>{const e={...event,target:env.document};previous?.(e);fn(e);};
  }};
  if(storage) env.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  parent.setTimeout=(...args)=>env.setTimeout(...args);parent.clearTimeout=(...args)=>env.clearTimeout(...args);
  const filename=path.join(__dirname,'../../src/plugins/noah/casting.js');
  env.window=env;vm.createContext(env);vm.runInContext(fs.readFileSync(filename,'utf8'),env,{filename});
  env.SeerrCasting({playbackManager:manager,ServerConnections:{currentApiClient:()=>api}});
  return {bridge:env.__seerrCast,calls,manager,cast,listeners,env,item};
}
test('discovery filters local and audio-only players without returning authentication data',async()=>{
  const {bridge}=setup();assert.equal(bridge.ready(),true);
  const devices=await bridge.discover();assert.equal(devices.length,1);assert.equal(devices[0].name,'Living room');
  assert.equal(JSON.stringify(devices).includes('Token'),false);
});
test('native pairing runs synchronously in receiver click before item lookup; handoff commits only after play',async()=>{
  const {bridge,calls}=setup();await bridge.discover();
  const playing=bridge.connect('cast',id,8202033590,()=>({ticks:8500000000,commit:()=>calls.push(['handoff'])}));
  assert.equal(calls[0][0],'pair');await playing;
  const play=calls.find(c=>c[0]==='play')[1];assert.equal(play.items[0].Id,id);assert.equal(play.items[0].ServerId,'server');
  assert.equal(play.startPositionTicks,8500000000);assert.equal(play.enableRemotePlayers,true);
  assert.ok(calls.findIndex(c=>c[0]==='handoff')>calls.findIndex(c=>c[0]==='play'));
});
test('explicit zero overrides Jellyfin credits; missing history uses native resume',async()=>{
  for(const [ticks,expected] of [[0,0],[undefined,9000000000]]){
    const {bridge,calls}=setup();await bridge.discover();await bridge.connect('cast',id,ticks);
    assert.equal(calls.find(c=>c[0]==='play')[1].startPositionTicks,expected);
  }
});
test('cancelled pairing and rejected playback leave local playback untouched',async()=>{
  for(const options of [{cancel:true},{failPlay:true}]){
    const {bridge,calls,manager}=setup(options);await bridge.discover();let stopped=false;
    await assert.rejects(bridge.connect('cast',id,0,()=>({commit:()=>stopped=true})));
    assert.equal(stopped,false);assert.equal(manager.getCurrentPlayer().isLocalPlayer,true);
    if(options.cancel)assert.equal(calls.some(c=>c[0]==='item'),false);
  }
});
test('remote state uses native ticks and controls address the selected player',async()=>{
  const {bridge,calls,cast}=setup();await bridge.discover();await bridge.connect('cast',id,0);
  const state=bridge.snapshot();assert.equal(state.position,820.203359);assert.equal(state.duration,1453.127);assert.equal(state.episodeNumber,6);
  assert.equal(state.paused,true);assert.equal(state.canVolume,true);
  bridge.command('play');bridge.command('pause');bridge.command('seek',45);bridge.command('volume',25);
  assert.ok(calls.some(c=>c[0]==='seek'&&c[1]===450000000&&c[2]===cast));
  assert.ok(calls.some(c=>c[0]==='volume'&&c[1]===25&&c[2]===cast));
  assert.ok(calls.some(c=>c[0]==='pause'&&c[1]===cast));
  assert.throws(()=>bridge.command('volume',200));assert.throws(()=>bridge.command('seek',-1));
});
test('disconnect remote keeps receiver running; stop casting explicitly stops it',async()=>{
  for(const stop of [false,true]){
    const {bridge,calls}=setup();await bridge.discover();await bridge.connect('cast',id,0);await bridge.disconnect(stop);
    assert.equal(calls.some(c=>c[0]==='stop'),stop);assert.equal(bridge.snapshot().connected,false);
    assert.throws(()=>bridge.command('pause'));
  }
});
test('invalid item/target and disposed profile cannot start a remote stream',async()=>{
  const {bridge,calls,listeners}=setup();await bridge.discover();
  await assert.rejects(bridge.connect('speaker',id,0));await assert.rejects(bridge.connect('cast','bad',0));
  listeners.pagehide({isTrusted:true});assert.equal(bridge.ready(),false);await assert.rejects(bridge.connect('cast',id,0));
  assert.equal(calls.some(c=>c[0]==='play'),false);
});
test('a remote session that lost its control connection is disconnected',async()=>{
  const {bridge,manager}=setup();await bridge.discover();await bridge.connect('cast',id,0);
  manager.getPlayerState=()=>({Id:'cast-session',SupportsRemoteControl:false});
  assert.equal(bridge.snapshot().connected,false);assert.equal(manager.getCurrentPlayer().isLocalPlayer,true);
});
test('a local auto-advance during device selection never applies another episode position',async()=>{
  const {bridge,calls}=setup();await bridge.discover();
  await bridge.connect('cast',id,8202033590,()=>({itemId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',ticks:450000000,commit(){}}));
  assert.equal(calls.find(c=>c[0]==='play')[1].startPositionTicks,8202033590);
});

function googleCastSetup({reject=false,...options}={}) {
  const result=setup(options), {cast,env,calls,item,manager}=result;
  env.chrome={cast:{media:{PauseRequest:class {},PlayRequest:class {},SeekRequest:class {}}}};
  const deliver=(name,value,ok,fail)=>{calls.push(['sdk',name,value]);reject?fail({code:'channel_error'}):ok();};
  const media={currentTime:30,playerState:'PLAYING',media:{duration:1453,customData:{canClientSeek:true}},
    pause:(request,ok,fail)=>deliver('pause',request,ok,fail),
    play:(request,ok,fail)=>deliver('play',request,ok,fail),
    seek:(request,ok,fail)=>deliver('seek',request.currentTime,ok,fail)};
  const session={sessionId:'tv-session',status:'connected',media:[media],receiver:{label:'living-room',volume:{level:0.4}},
    setReceiverVolumeLevel:(value,ok,fail)=>deliver('volume',value,ok,fail),
    sendMessage:(namespace,value,ok,fail)=>deliver(namespace,JSON.parse(value),ok,fail)};
  cast._castPlayer={session,currentMediaSession:media,
    // Model Jellyfin's native envelope and fire-and-forget sender: the bridge
    // must preserve the envelope and expose the underlying delivery callback.
    sendMessage(message){return this.sendMessageInternal({...message,accessToken:'fixture-secret',serverAddress:'https://stream.noah-work.com/player',userId:'profile5'});},
    sendMessageInternal:()=>Promise.resolve()};
  env.chrome.cast.requestSessionById=()=>cast._castPlayer.__seerrOnJoin?.(session);
  manager.getSupportedCommands=()=>['SetVolume','SetAudioStreamIndex','SetSubtitleStreamIndex'];
  item.MediaSources=[{Id:'source',DefaultAudioStreamIndex:1,DefaultSubtitleStreamIndex:2,MediaStreams:[
    {Type:'Audio',Index:1,DisplayTitle:'Japanese'},
    {Type:'Audio',Index:4,DisplayTitle:'English'},
    {Type:'Subtitle',Index:2,DisplayTitle:'English ASS'},
    {Type:'Subtitle',Index:3,DisplayTitle:'French ASS'}]}];
  return {...result,media,session};
}
test('Google Cast controls use standard acknowledged media/receiver APIs, not native fire-and-forget controls',async()=>{
  const {bridge,calls}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  await bridge.command('pause');await bridge.command('play');await bridge.command('seek',42);await bridge.command('volume',0);
  assert.deepEqual(calls.filter(c=>c[0]==='sdk').map(c=>c.slice(1,3)).map(([n,v])=>[n,['pause','play'].includes(n)?'request':v]),[['pause','request'],['play','request'],['seek',42],['volume',0]]);
  assert.equal(calls.some(c=>['pause','seek','volume'].includes(c[0])),false);
});
test('Google Cast delivery errors reject the command and can be shown in Seerr',async()=>{
  const {bridge}=googleCastSetup({reject:true});await bridge.discover();await bridge.connect('cast',id,0);
  for(const [command,value] of [['pause'],['play'],['seek',15],['volume',50],['audio',1],['subtitles',-1]])
    await assert.rejects(bridge.command(command,value),/channel_error/);
});
test('audio/subtitle choices retain native authenticated envelope; Off is stream index minus one',async()=>{
  const {bridge,calls,cast}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  const original=cast._castPlayer.sendMessageInternal;
  await bridge.command('audio',4);await bridge.command('subtitles',-1);
  const messages=calls.filter(c=>c[0]==='sdk').map(c=>c[2]);
  assert.equal(messages[0].command,'SetAudioStreamIndex');assert.equal(messages[0].options.index,4);
  assert.equal(messages[1].command,'SetSubtitleStreamIndex');assert.equal(messages[1].options.index,-1);
  assert.equal(messages[0].accessToken,'fixture-secret');assert.equal(cast._castPlayer.sendMessageInternal,original);
  const snapshot=bridge.snapshot();assert.equal(snapshot.audio.length,2);assert.equal(snapshot.subtitles.length,2);
  assert.equal(snapshot.audioIndex,1);assert.equal(snapshot.subtitleIndex,2);
  assert.equal(JSON.stringify(snapshot).includes('fixture-secret'),false);
});
test('10-second taps accumulate while receiver state is catching up and clamp to media bounds',async()=>{
  const {bridge,calls}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  await bridge.command('jump',10);await bridge.command('jump',10);await bridge.command('jump',-10);
  assert.deepEqual(calls.filter(c=>c[0]==='sdk'&&c[1]==='seek').map(c=>c[2]),[40,50,40]);
  await bridge.command('jump',-100);assert.equal(calls.at(-1)[2],0);
});
test('server-seeking Chromecast keeps absolute resume time and uses Jellyfin native seek',async()=>{
  const {bridge,calls,media}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  media.media.customData={canClientSeek:false,startPositionTicks:8000000000};media.currentTime=20;
  assert.equal(bridge.snapshot().position,820);
  await bridge.command('seek',400);
  assert.equal(calls.at(-1)[2].command,'Seek');assert.equal(calls.at(-1)[2].options.position,400);
});

test('stream replacement uses the current SDK media instead of a cached native handle',async()=>{
  const {bridge,media,session}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  media.pause=()=>assert.fail('stale media must never receive controls');
  let paused=0;
  session.media=[{...media,currentTime:115,pause:(request,ok)=>{paused++;ok();}}];
  assert.equal(bridge.snapshot().position,115);
  await bridge.command('pause');assert.equal(paused,1);
});

test('a restored sender uses the newest media session even when the SDK list is reversed',async()=>{
  const {bridge,media,session,calls}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  media.mediaSessionId=1;media.pause=()=>assert.fail('old stream controlled');
  session.media=[{...media,mediaSessionId:2,currentTime:90,pause:(request,ok)=>{calls.push(['newest']);ok();}},media];
  assert.equal(bridge.snapshot().position,90);await bridge.command('pause');assert.ok(calls.some(c=>c[0]==='newest'));
});

test('command delivery refreshes receiver status before publishing restored controls',async()=>{
  const {bridge,media}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  media.getStatus=(request,ok)=>{media.playerState='PAUSED';ok();};
  await bridge.command('pause');assert.equal(bridge.snapshot().paused,true);
});
test('channel failure rejoins the same TV, refreshes media and retries the absolute command once without loading again',async()=>{
  const {bridge,media,session,env,cast,calls}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  let attempts=0,rejoins=0,status=0;
  media.seek=(req,ok,fail)=>{attempts++;fail({code:'channel_error'});};
  const fresh={...media,currentTime:35,getStatus:(req,ok)=>{status++;ok();},seek:(req,ok)=>{attempts++;assert.equal(req.currentTime,40);ok();}};
  env.chrome.cast.requestSessionById=sessionId=>{
    rejoins++;assert.equal(sessionId,'tv-session');
    const joined={...session,media:[fresh]};cast._castPlayer.session=joined;cast._castPlayer.__seerrOnJoin(joined);
  };
  await bridge.command('jump',10);
  assert.equal(attempts,2);assert.equal(rejoins,1);assert.equal(status,2);
  assert.equal(calls.filter(c=>c[0]==='play').length,1);
});
test('missing callback recovers rather than permanently poisoning all subsequent controls',async()=>{
  const {bridge,media,session,env,cast}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  env.setTimeout=(fn,delay)=>setTimeout(fn,Math.min(delay,20));
  media.pause=()=>{};
  let pauses=0,plays=0;
  const fresh={...media,pause:(req,ok)=>{pauses++;ok();},play:(req,ok)=>{plays++;ok();}};
  env.chrome.cast.requestSessionById=()=>{const joined={...session,media:[fresh]};cast._castPlayer.session=joined;cast._castPlayer.__seerrOnJoin(joined);};
  await bridge.command('pause');await bridge.command('play');assert.equal(pauses,1);assert.equal(plays,1);
});
test('commands wait for one another, jumps stay cumulative even before acknowledgements',async()=>{
  const {bridge,media}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  const requests=[],acks=[];media.seek=(req,ok)=>{requests.push(req.currentTime);acks.push(ok);};
  const a=bridge.command('jump',10),b=bridge.command('jump',10);
  await new Promise(setImmediate);assert.deepEqual(requests,[40]);acks.shift()();
  await new Promise(setImmediate);assert.deepEqual(requests,[40,50]);acks.shift()();await Promise.all([a,b]);
});
test('foreground and restored network rejoin without replaying; page disposal removes parent listeners',async()=>{
  const {bridge,env,session,cast,listeners,calls}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  let joins=0;env.chrome.cast.requestSessionById=()=>{joins++;cast._castPlayer.__seerrOnJoin(session);};
  env.parent.document.visibilityState='hidden';env.parent.document.dispatch('visibilitychange');assert.equal(joins,0);
  env.parent.document.visibilityState='visible';env.parent.document.dispatch('visibilitychange');
  await new Promise(setImmediate);assert.equal(joins,1);
  env.parent.dispatch('online');await new Promise(setImmediate);assert.equal(joins,2);
  listeners.pagehide({persisted:true,isTrusted:true});assert.equal(bridge.ready(),true);
  listeners.pagehide({isTrusted:true});env.parent.dispatch('online');env.parent.document.dispatch('visibilitychange');assert.equal(joins,2);
  assert.equal(calls.filter(c=>c[0]==='play').length,1);
});
test('disconnected native player can recover an existing TV session without destroying the remote',async()=>{
  const {bridge,env,cast,session,manager}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  manager.setDefaultPlayerActive();cast._castPlayer.session=null;
  assert.equal(bridge.snapshot().connected,true);assert.equal(bridge.snapshot().connection,'disconnected');
  env.chrome.cast.requestSessionById=()=>cast._castPlayer.__seerrOnJoin(session);
  await bridge.command('pause');assert.equal(bridge.snapshot().connection,'connected');assert.equal(manager.getCurrentPlayer(),cast);
});
test('failed rejoin never sends controls to another receiver and disconnect cancels queued commands',async()=>{
  const {bridge,env,session,cast,media}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  env.setTimeout=(fn,delay)=>setTimeout(fn,Math.min(delay,20));
  media.pause=(req,ok,fail)=>fail({code:'channel_error'});
  env.chrome.cast.requestSessionById=()=>cast._castPlayer.__seerrOnJoin({...session,sessionId:'other-session',receiver:{label:'other-room'}});
  await assert.rejects(bridge.command('pause'),/Could not reconnect/);
  assert.equal(bridge.snapshot().connection,'disconnected');
  const pending=bridge.command('pause');await bridge.disconnect();await assert.rejects(pending,/changed/);
  assert.equal(bridge.snapshot().connected,false);
});
test('invalid commands are not retried and a stopped receiver does not recover automatically',async()=>{
  const {bridge,env,media,session}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  env.chrome.cast.requestSessionById=()=>assert.fail('no rejoin for invalid commands or stopped TV');
  media.pause=(req,ok,fail)=>fail({code:'invalid_parameter'});
  await assert.rejects(bridge.command('pause'),/invalid_parameter/);
  session.status='stopped';assert.equal(bridge.snapshot().connected,false);
  env.parent.dispatch('online');
});
test('embedded Cast initialization is single-owner and passes the parent page context',()=>{
  const {env}=googleCastSetup();let context;
  env.chrome.cast.isAvailable=true;env.chrome.cast.setPageContext=value=>context=value;
  const lifecycle=env.SeerrCastLifecycle,p={};
  assert.equal(lifecycle.skipInitialization(p),false);assert.equal(lifecycle.skipInitialization(p),true);
  p.isInitialized=true;assert.equal(lifecycle.skipInitialization(p),true);
  lifecycle.initialized();assert.equal(context,env.parent);
  const filename=path.join(__dirname,'../../src/plugins/noah/casting.js');
  env.location.search='';vm.runInContext(fs.readFileSync(filename,'utf8'),env,{filename});
  assert.equal(env.SeerrCastLifecycle.skipInitialization({}),true);
});
test('native session listeners are deduplicated and obsolete session callbacks cannot disconnect a replacement',()=>{
  const {env,cast}=setup();let updates=0,connections=0;
  const create=()=>{const handlers={};return {status:'connected',handlers,
    addMessageListener:(ns,fn)=>handlers.message=fn,removeMessageListener:()=>delete handlers.message,
    addMediaListener:fn=>handlers.media=fn,removeMediaListener:()=>delete handlers.media,
    addUpdateListener:fn=>handlers.update=fn,removeUpdateListener:()=>delete handlers.update};};
  cast._castPlayer={onSessionConnected(session){connections++;this.session=session;session.addMessageListener('urn:test',()=>{});session.addMediaListener(()=>{});session.addUpdateListener(()=>updates++);}};
  env.SeerrCastLifecycle.attach(cast);const a=create(),b=create();
  cast._castPlayer.onSessionConnected(a);const stale=a.handlers.update;
  cast._castPlayer.onSessionConnected(a);assert.equal(connections,1);
  cast._castPlayer.onSessionConnected(b);assert.equal(connections,2);assert.equal(a.handlers.update,undefined);
  stale(false);assert.equal(updates,0);b.handlers.update(true);assert.equal(updates,1);
});
test('manual reconnect invokes the browser picker in the click and rejoins the same TV without replaying media',async()=>{
  const {bridge,env,session,cast,calls}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  let picker=0;env.chrome.cast.requestSession=(ok)=>{picker++;ok({...session,sessionId:'reconnected-session'});};
  const pending=bridge.recover(true);assert.equal(picker,1);await pending;
  assert.equal(cast._castPlayer.session.sessionId,'reconnected-session');
  assert.equal(calls.filter(c=>c[0]==='play').length,1);
});

test('automatic recovery requests status for an empty resumed SDK session without starting media or showing a picker',async()=>{
  const {bridge,env,session,cast,media,calls}=googleCastSetup();
  await bridge.discover();await bridge.connect('cast',id,0);
  session.media=[];cast._castPlayer.currentMediaSession=undefined;
  media.getStatus=(_request,ok)=>ok();
  session.sendMessage=(namespace,request,ok)=>{
    assert.equal(namespace,'urn:x-cast:com.google.cast.media');
    assert.equal(request.type,'GET_STATUS');
    session.media=[media];ok();
  };
  env.chrome.cast.requestSessionById=()=>assert.fail('the acknowledged route must be retained');
  await bridge.recover();
  assert.equal(calls.filter(c=>c[0]==='play').length,1);
  assert.equal(bridge.snapshot().connection,'connected');
});

test('a saved application session remains the same TV when the browser rotates its receiver label',async()=>{
  const {bridge,env,session,cast,calls}=googleCastSetup();
  await bridge.discover();await bridge.connect('cast',id,0);
  env.navigator={userActivation:{isActive:true}};
  let picker=0;
  env.chrome.cast.requestSession=ok=>{picker++;ok({...session,receiver:{...session.receiver,label:'new-browser-label'}});};
  const pending=bridge.recover(false);
  assert.equal(picker,1);
  await pending;
  assert.equal(cast._castPlayer.session.sessionId,session.sessionId);
  assert.equal(calls.filter(c=>c[0]==='play').length,1);
});

test('manual reconnect reuses an acknowledged live route instead of opening its OS stop-casting menu',async()=>{
  const {bridge,env,media,calls}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  media.getStatus=(request,ok)=>ok();
  env.chrome.cast.requestSession=()=>assert.fail('a live route must not open the OS picker');
  env.chrome.cast.requestSessionById=()=>assert.fail('a live route must not be rediscovered');
  await bridge.recover(true);await bridge.command('pause');
  assert.equal(bridge.snapshot().connection,'connected');
  assert.equal(calls.filter(c=>c[0]==='play').length,1);
});

test('a paused cold restore with empty native metadata rebuilds controls from SDK status without crashing or reloading',async()=>{
  const storage=new Map(),first=googleCastSetup({storage});await first.bridge.discover();await first.bridge.connect('cast',id,0);first.bridge.snapshot();
  const reopened=googleCastSetup({storage}),{bridge,cast,manager,media,env,calls}=reopened;
  cast._castPlayer.isInitialized=true;manager.setDefaultPlayerActive();manager.getPlayerState=()=>({});
  media.playerState='PAUSED';media.media.customData=undefined;
  media.getStatus=(request,ok)=>{media.media.customData={itemId:id,audioStreamIndex:1,subtitleStreamIndex:3,canSeek:true,playMethod:'Transcode'};ok();};
  env.chrome.cast.requestSession=()=>assert.fail('paused recovery must not open an OS picker');
  assert.equal(await bridge.restore(),true);
  const initial=bridge.snapshot();assert.equal(initial.itemId,id);assert.equal(initial.paused,true);assert.equal(initial.subtitleIndex,3);
  await new Promise(resolve=>setImmediate(resolve));
  const hydrated=bridge.snapshot();assert.equal(hydrated.title,'First Buddy');assert.equal(hydrated.audio.length,2);assert.equal(hydrated.subtitles.length,2);
  await bridge.recover(true);await bridge.command('play');await bridge.command('seek',60);await bridge.command('volume',30);
  assert.equal(calls.some(c=>c[0]==='play'||c[0]==='pair'),false);
});

test('empty native and SDK metadata does not crash the status reader before getStatus arrives',async()=>{
  const {bridge,manager,media}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  manager.getPlayerState=()=>({});media.media.customData=undefined;
  assert.doesNotThrow(()=>bridge.snapshot());
});

test('early auto-join preserves the saved position and tracks until the first SDK status arrives',async()=>{
  const storage=new Map(),first=googleCastSetup({storage});await first.bridge.discover();await first.bridge.connect('cast',id,0);const prior=first.bridge.snapshot();
  const reopened=googleCastSetup({storage}),{bridge,manager,media}=reopened;
  manager.setActivePlayer(reopened.cast,{id:'cast',deviceName:'Living room'});manager.getPlayerState=()=>({});
  media.media={};media.currentTime=0;
  const pending=bridge.snapshot();
  assert.equal(pending.position,prior.position);assert.equal(pending.itemId,id);assert.equal(pending.subtitles.length,2);
  assert.equal(JSON.parse([...storage.values()][0]).snapshot.itemId,id);
});

test('restored status without repeated episode metadata updates position and pause while retaining confirmed tracks',async()=>{
  const {bridge,manager,media}=googleCastSetup();
  await bridge.discover();await bridge.connect('cast',id,0);
  media.mediaSessionId=3;media.media.customData.subtitleStreamIndex=3;
  const prior=bridge.snapshot();
  manager.getPlayerState=()=>({});media.media={};media.currentTime=790.274656;media.playerState='PAUSED';
  const live=bridge.snapshot();
  assert.equal(live.position,790.274656);assert.equal(live.paused,true);
  assert.equal(live.itemId,prior.itemId);assert.equal(live.subtitleIndex,3);
  assert.equal(live.mediaSessionId,3);
});

test('cold resume hydrates the saved SDK media handle by status without replaying a paused episode',async()=>{
  const storage=new Map(),first=googleCastSetup({storage});
  await first.bridge.discover();await first.bridge.connect('cast',id,0);
  first.media.mediaSessionId=3;first.bridge.snapshot();
  const reopened=googleCastSetup({storage}),{bridge,cast,manager,env,session,calls}=reopened;
  cast._castPlayer.isInitialized=true;session.media=[];cast._castPlayer.currentMediaSession=undefined;
  manager.getPlayerState=()=>({});
  env.chrome.cast.media.Media=class {
    constructor(sessionId,mediaSessionId){assert.equal(sessionId,session.sessionId);assert.equal(mediaSessionId,3);this.mediaSessionId=mediaSessionId;}
    getStatus(_request,ok){this.playerState='PAUSED';this.currentTime=790;this.media={customData:{itemId:id}};ok();}
  };
  await bridge.restore();
  const live=bridge.snapshot();assert.equal(live.position,790);assert.equal(live.paused,true);
  assert.equal(calls.filter(c=>c[0]==='play').length,0);
});

test('recovery adopts an acknowledged SDK session even when requestSession never calls back',async()=>{
  const {bridge,env,session,cast,media}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  cast._castPlayer.session=null;media.getStatus=(request,ok)=>ok();
  env.chrome.cast.requestSession=()=>{cast._castPlayer.session=session;};
  await bridge.recover(true);
  assert.equal(bridge.snapshot().connection,'connected');
});
test('subtitle text tracks apply through CAF without reloading video; Off clears active track IDs',async()=>{
  const {bridge,env,media,calls}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  env.chrome.cast.media.EditTracksInfoRequest=class {constructor(ids){this.activeTrackIds=ids;}};
  media.media.tracks=[{trackId:2,type:'TEXT'},{trackId:3,type:'TEXT'}];
  media.media.customData.subtitleStreamIndex=2;media.activeTrackIds=[2];
  media.editTracksInfo=(req,ok)=>{media.activeTrackIds=req.activeTrackIds;ok();};
  await bridge.command('subtitles',3);assert.equal(bridge.snapshot().subtitleIndex,3);
  await bridge.command('subtitles',-1);assert.equal(bridge.snapshot().subtitleIndex,-1);
  assert.equal(calls.filter(c=>c[0]==='sdk').length,0);
});
test('burned-in subtitle changes renegotiate the exact item and absolute position, preserve queue and paused state',async()=>{
  const {bridge,cast,media,session,calls}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  media.media.customData={itemId:id,canClientSeek:false,startPositionTicks:8000000000,subtitleStreamIndex:2,audioStreamIndex:1,mediaSourceId:'source'};
  media.playerState='PAUSED';media.currentTime=20;
  const next='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';cast._castPlayer.__seerrPlaylist=[{Id:id,ServerId:'server'},{Id:next,ServerId:'server'}];
  const original=cast._castPlayer.sendMessage;
  cast._castPlayer.sendMessage=function(message){
    if(message.command==='PlayNow') session.media=[{...media,media:{...media.media,customData:{...media.media.customData,subtitleStreamIndex:message.options.subtitleStreamIndex}}}];
    return original.call(this,message);
  };
  await bridge.command('subtitles',3);
  const sent=calls.find(c=>c[0]==='sdk'&&c[2]?.command==='PlayNow')[2];
  assert.equal(sent.options.startPositionTicks,8200000000);assert.equal(sent.options.subtitleStreamIndex,3);assert.equal(sent.options.audioStreamIndex,1);
  assert.deepEqual(Array.from(sent.options.items,x=>x.Id),[id,next]);
  assert.equal(calls.at(-1)[1],'pause');assert.equal(bridge.snapshot().subtitleIndex,3);
});
test('receiver Identify reply during reconnect updates progress without emitting an artificial playback stop',()=>{
  const {env,cast}=setup();const events=[];
  cast._castPlayer={onSessionConnected(){},messageListener:(ns,value)=>events.push(value),__seerrRejoining:true,session:{media:[{playerState:'PLAYING'}]}};
  env.SeerrCastLifecycle.attach(cast);
  cast._castPlayer.messageListener('urn:test',{type:'playbackstop',data:{NowPlayingItem:{Id:id}}});
  assert.equal(events[0].type,'playbackprogress');
  cast._castPlayer.__seerrRejoining=false;cast._castPlayer.messageListener('urn:test',{type:'playbackstop',data:{NowPlayingItem:{Id:id}}});
  assert.equal(events[1].type,'playbackstop');
});

test('subtitle reload waits through missing CAF metadata and preserves paused playback',async()=>{
  const {bridge,cast,media,session,manager,calls}=googleCastSetup();
  await bridge.discover();await bridge.connect('cast',id,0);
  media.media.customData={itemId:id,subtitleStreamIndex:2,audioStreamIndex:1};
  media.playerState='PAUSED';
  const original=cast._castPlayer.sendMessage;
  cast._castPlayer.sendMessage=function(message){
    if(message.command==='PlayNow') {
      manager.getPlayerState=()=>({});session.media=[{...media,media:{}}];
      setTimeout(()=>{session.media=[{...media,media:{customData:{itemId:id,subtitleStreamIndex:message.options.subtitleStreamIndex}}}];},150);
    }
    return original.call(this,message);
  };
  await bridge.command('subtitles',3);
  assert.equal(calls.at(-1)[1],'pause');
  assert.equal(bridge.snapshot().subtitleIndex,3);
  assert.equal(calls.filter(c=>c[0]==='sdk'&&c[2]?.command==='PlayNow').length,1);
});

test('subtitle reload still rejects a confirmed different episode',async()=>{
  const {bridge,cast,media,session,manager}=googleCastSetup();
  await bridge.discover();await bridge.connect('cast',id,0);
  media.media.customData={itemId:id,subtitleStreamIndex:2,audioStreamIndex:1};
  const original=cast._castPlayer.sendMessage;
  cast._castPlayer.sendMessage=function(message){
    if(message.command==='PlayNow') {
      manager.getPlayerState=()=>({});session.media=[{...media,media:{customData:{itemId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',subtitleStreamIndex:3}}}];
    }
    return original.call(this,message);
  };
  await assert.rejects(bridge.command('subtitles',3),/episode changed/);
});

test('discovery waits for the late SDK target instead of requiring Refresh',async()=>{
  const {bridge,manager}=setup();const targets=manager.getTargets;
  let attempts=0;manager.getTargets=async()=>++attempts===1?[]:targets();
  assert.equal((await bridge.discover()).length,1);assert.equal(attempts,2);
});

test('control deadlines use visible parent timers even when sender timers are suspended',async()=>{
  const {bridge,env,media}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  let scheduled=0;env.parent.setTimeout=(fn,delay)=>{scheduled++;return setTimeout(fn,Math.min(delay,10));};
  env.parent.clearTimeout=clearTimeout;env.setTimeout=()=>assert.fail('hidden sender timer used');
  media.pause=()=>{};
  await assert.rejects(bridge.command('pause'),/timed out/);assert.ok(scheduled>0);
});

test('a native load error cannot discard playback confirmed on the receiver',async()=>{
  const {bridge,manager,media,calls}=googleCastSetup();
  await bridge.discover();
  manager.play=async()=>{media.media.customData.itemId=id;throw Error('Load status timed out');};
  media.getStatus=(request,ok)=>ok();
  const state=await bridge.connect('cast',id,0);
  assert.equal(state.connected,true);assert.equal(state.itemId,id);
  assert.equal(calls.some(c=>c[0]==='local'),false);
});

test('origin rejoin policy precedes initialization and the page context follows SDK success',()=>{
  const {env}=setup();const order=[],config={};
  env.chrome={cast:{AutoJoinPolicy:{ORIGIN_SCOPED:'origin_scoped'},setPageContext:parent=>{assert.equal(parent,env.parent);order.push('context');}}};
  env.SeerrCastLifecycle.configure(config);assert.equal(order.length,0);
  order.push('initialize');env.SeerrCastLifecycle.initialized();
  assert.equal(config.autoJoinPolicy,'origin_scoped');assert.deepEqual(order,['initialize','context']);
});

test('foreground keeps a healthy browser media channel without starting discovery',async()=>{
  const {bridge,env,media,calls}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  let status=0;media.getStatus=(request,ok)=>{status++;ok();};
  env.chrome.cast.requestSessionById=()=>assert.fail('a healthy SDK does not need discovery');
  env.parent.document.dispatch('visibilitychange');await new Promise(setImmediate);
  await bridge.command('pause');assert.equal(status,2);assert.equal(calls.filter(c=>c[0]==='play').length,1);
});

test('a replacement handle for the same TV survives native active-player callbacks during rejoin',async()=>{
  const {bridge,env,session,cast,manager,calls}=googleCastSetup();await bridge.discover();await bridge.connect('cast',id,0);
  env.chrome.cast.requestSession=ok=>{
    const renewed={...session,sessionId:'new-browser-handle'};
    cast._castPlayer.session=renewed;
    manager.setActivePlayer(cast,{id:'cast',deviceName:'Living room'});
    bridge.snapshot(); // Native connect activates the player before SDK resolves.
    ok(renewed);
  };
  await bridge.recover(true);await bridge.command('pause');
  assert.equal(bridge.snapshot().connection,'connected');
  assert.equal(calls.filter(c=>c[0]==='play').length,1);
});

test('closing and reopening the browser restores the existing TV without loading any media',async()=>{
  const storage=new Map(),first=googleCastSetup({storage});
  await first.bridge.discover();await first.bridge.connect('cast',id,0);
  first.bridge.snapshot();first.env.parent.document.dispatch('visibilitychange');first.listeners.pagehide({isTrusted:true});
  const reopened=googleCastSetup({storage});reopened.cast._castPlayer.isInitialized=true;
  reopened.manager.setDefaultPlayerActive();
  assert.equal(await reopened.bridge.restore(),true);
  await reopened.bridge.command('pause');assert.equal(reopened.bridge.snapshot().connected,true);
  assert.equal(reopened.calls.some(c=>c[0]==='play'||c[0]==='pair'),false);
  const other=googleCastSetup({storage,userId:'another-profile'});other.cast._castPlayer.isInitialized=true;
  assert.equal(await other.bridge.restore(),false);
  await reopened.bridge.disconnect();assert.equal(storage.size,0);
});

test('failed cold rejoin keeps manual reconnect controls and never transfers to a different TV',async()=>{
  const storage=new Map(),first=googleCastSetup({storage});
  await first.bridge.discover();await first.bridge.connect('cast',id,0);first.bridge.snapshot();first.env.parent.document.dispatch('visibilitychange');
  const reopened=googleCastSetup({storage});reopened.cast._castPlayer.isInitialized=true;reopened.cast._castPlayer.session=null;
  reopened.env.setTimeout=(fn,delay)=>setTimeout(fn,Math.min(delay,20));
  reopened.env.chrome.cast.requestSessionById=()=>{};
  assert.equal(await reopened.bridge.restore(),true);assert.equal(reopened.bridge.snapshot().connection,'disconnected');
  reopened.env.chrome.cast.requestSession=ok=>ok({...reopened.session,sessionId:'other-tv-session',receiver:{label:'other-tv'}});
  await assert.rejects(reopened.bridge.recover(true),/same TV/);
  reopened.env.chrome.cast.requestSession=ok=>ok(reopened.session);
  await reopened.bridge.recover(true);await reopened.bridge.command('pause');
  assert.equal(reopened.calls.some(c=>c[0]==='play'),false);
});

test('native autojoin never adopts another profile TV session',()=>{
  const {bridge,cast,env}=setup();let adopted=0;
  cast._castPlayer={onSessionConnected(){adopted++;},session:null};
  bridge.ready();cast._castPlayer.onSessionConnected({sessionId:'someone-else',receiver:{label:'other-tv'}});
  assert.equal(adopted,0);
  assert.equal(bridge.snapshot().connected,false);
});

test('autojoin filters foreign sessions before native assignment or Identify',()=>{
  const {env}=setup();let nativeCalls=0;
  env.chrome={cast:{AutoJoinPolicy:{ORIGIN_SCOPED:'origin_scoped'}}};
  const config={sessionListener:()=>nativeCalls++};env.SeerrCastLifecycle.configure(config);
  config.sessionListener({sessionId:'foreign',receiver:{label:'someone-else'}});
  assert.equal(nativeCalls,0);
});

test('a late native join clears an earlier timeout and restores controls without replaying',async()=>{
  const {bridge,env,cast,manager,session,calls}=googleCastSetup();
  cast._castPlayer.onSessionConnected=function(s){this.session=s;manager.setActivePlayer(cast,{id:'cast',deviceName:'Living room'});};
  bridge.ready();await bridge.discover();await bridge.connect('cast',id,0);
  env.setTimeout=(fn,delay)=>setTimeout(fn,Math.min(delay,20));
  cast._castPlayer.session=null;env.chrome.cast.requestSessionById=()=>{};
  await assert.rejects(bridge.recover(),/Could not reconnect/);
  assert.equal(bridge.snapshot().connection,'disconnected');
  cast._castPlayer.onSessionConnected(session);
  assert.equal(bridge.snapshot().connection,'connected');await bridge.command('pause');
  assert.equal(calls.filter(c=>c[0]==='play').length,1);
});

test('selecting the TV already playing this item adopts its current position without loading again',async()=>{
  const {bridge,media,calls}=googleCastSetup();media.media.customData.itemId=id;
  await bridge.discover();const state=await bridge.connect('cast',id,0,()=>undefined);
  assert.equal(state.position,30);assert.equal(state.connected,true);
  assert.equal(calls.some(c=>c[0]==='play'),false);await bridge.command('pause');
});
