/* Thin Seerr remote bridge. Discovery, pairing and media negotiation stay native. */
(() => {
  const embedded = window.parent !== window;
  const castFrame = embedded && new URLSearchParams(location.search).get('seerrCast') === '1';
  // Recovery deadlines belong to the visible Seerr page. A hidden sender
  // iframe can have its own timers suspended/throttled on mobile browsers.
  const timerHost = castFrame && window.parent.setTimeout ? window.parent : window;
  const setTimeout = (...args) => timerHost.setTimeout(...args);
  const clearTimeout = (...args) => timerHost.clearTimeout(...args);
  if (castFrame && window.frameElement) {
    // Keep the tiny sender in the viewport: offscreen frames can have their
    // rendering/status callbacks suspended by mobile browser optimizations.
    Object.assign(window.frameElement.style,{left:'0px',top:'0px',opacity:'0'});
  }
  if (embedded) {
    const style = document.createElement('style');
    style.id = 'seerr-cast-controls-only';
    style.textContent = '.headerCastButton, #videoOsdPage .castButton { display:none !important; }';
    document.head.appendChild(style);
  }
  // Only the persistent Cast frame owns the SDK. The native plugin otherwise
  // reinitializes it on playbackstart and prepared local frames auto-join TVs.
  window.SeerrCastLifecycle = {
    configure(config) {
      if (!castFrame) return;
      // Joining must cover a new tab after the original browser was closed.
      if (window.chrome?.cast?.AutoJoinPolicy?.ORIGIN_SCOPED)
        config.autoJoinPolicy = window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED;
      const listener = config.sessionListener;
      config.sessionListener = session => {
        // Filter before Jellyfin assigns the session or sends Identify.
        if (window.__seerrCast?.acceptsSession(session) === true) listener?.(session);
      };
    },
    skipInitialization(player) {
      if (!embedded) return false;
      if (!castFrame || player.isInitialized) return true;
      if (!window.chrome?.cast?.isAvailable) return false;
      if (player.__seerrInitAt && Date.now() - player.__seerrInitAt < 10000) return true;
      player.__seerrInitAt = Date.now();
      return false;
    },
    initialized() {
      // Google's documented hook for a sender SDK hosted inside an iframe.
      if (castFrame) window.chrome?.cast?.setPageContext?.(window.parent);
    },
    attach(player) {
      const transport = player._castPlayer;
      if (!castFrame || !transport || transport.__seerrAttached) return;
      transport.__seerrAttached = true;
      const original = transport.onSessionConnected;
      if (!original) return;
      const send = transport.sendMessage;
      if(send) transport.sendMessage = function(message,...args) {
        if(message.command === 'Identify') this.__seerrIdentifyUntil = Date.now()+15000;
        return send.call(this,message,...args);
      };
      const load = transport.loadMedia;
      if (load) transport.loadMedia = function(options,...args) {
        this.__seerrPlaylist = options.items?.map(item => ({Id:item.Id,ServerId:item.ServerId,Name:item.Name,Type:item.Type,MediaType:item.MediaType,IsFolder:item.IsFolder}));
        return load.call(this,options,...args);
      };
      const message = transport.messageListener;
      if (message) transport.messageListener = function(namespace,value) {
        const data = typeof value === 'string' ? JSON.parse(value) : value;
        // The receiver answers Identify with a synthetic playbackstop even
        // while playing. Rejoining must not trigger native end/auto-next logic.
        if ((this.__seerrRejoining || this.__seerrIdentifyUntil > Date.now()) && data.type === 'playbackstop' && data.data?.NowPlayingItem?.Id && (!this.session?.media?.length || this.session.media.some(m => ['PLAYING','PAUSED','BUFFERING'].includes(m.playerState)))) {
          this.__seerrIdentifyUntil = 0;
          return message.call(this,namespace,{...data,type:'playbackprogress'});
        }
        return message.call(this,namespace,value);
      };
      let bindings = [];
      transport.onSessionConnected = function(session) {
        if (this.__seerrAcceptJoin?.(session) === false) return;
        this.__seerrRejoining = true;
        setTimeout(() => { this.__seerrRejoining = false; },1000);
        if (bindings.length && bindings[0].session === session && session.status !== 'disconnected') {
          this.session = session;
          this.__seerrOnJoin?.(session);
          this.__seerrAfterJoin?.(session);
          return;
        }
        for (const b of bindings) b.session[b.remove]?.(...b.args);
        bindings = [];
        const methods = ['addMessageListener','addMediaListener','addUpdateListener'];
        const saved = methods.map(name => session[name]);
        methods.forEach((name,index) => {
          if (!saved[index]) return;
          session[name] = (...args) => {
            const listenerIndex = args.length - 1, listener = args[listenerIndex];
            args[listenerIndex] = (...values) => {
              if (this.session === session) listener(...values);
            };
            bindings.push({session,remove:name.replace('add','remove'),args});
            return saved[index].apply(session,args);
          };
        });
        try { original.call(this,session); }
        finally { methods.forEach((name,index) => { if(saved[index]) session[name] = saved[index]; }); }
        this.__seerrOnJoin?.(session);
        this.__seerrAfterJoin?.(session);
      };
    }
  };
  if (!castFrame) return;
  document.addEventListener('chromecastloaded', event => window.SeerrCastLifecycle.attach(event.detail.player));
  window.SeerrCasting = ({ playbackManager: manager, ServerConnections }) => {
    let targets = [], connecting = false, disposed = false, metadata, metadataPending, seekIntent;
    let remembered, lastSnapshot, recovery, connectionError, queue = Promise.resolve(), epoch = 0, trackedMedia, mediaListener, pendingCommands = 0;
    window.addEventListener('pagehide', event => {
      if (!event.isTrusted || (event.target !== window && event.target !== document)) return;
      if (!event.persisted) { disposed = true; epoch++; }
    });
    const current = () => manager.getCurrentPlayer();
    const remote = () => current() && !current().isLocalPlayer;
    const api = () => ServerConnections.currentApiClient();
    let diagnostics = new URLSearchParams(window.parent.location?.search || '').get('castDiagnostics') === '1';
    if(Date.now()<Date.parse('2026-10-05T20:00:00Z') && window.parent.fetch)
      void window.parent.fetch('/api/v1/auth/me').then(r=>r.json()).then(u=>{if(u.id===1 && (u.permissions&2)){diagnostics=true;diagnose('restore','bridge24');}}).catch(()=>{});
    const diagnosticUntil = Date.now()+10*60000;
    let diagnosticAt = 0, diagnosticLast = '';
    const diagnose = (phase,command,value) => {
      if (!diagnostics || disposed || Date.now()>diagnosticUntil) return;
      try {
      const transport = (remote() ? current() : remembered?.player)?._castPlayer;
      const native = current() ? manager.getPlayerState(current()) || {} : {};
      const media = (transport?.session?.media || []).slice(-8).map(m=>({id:m.mediaSessionId,state:m.playerState,item:m.media?.customData?.itemId,time:m.currentTime,subtitle:m.media?.customData?.subtitleStreamIndex,audio:m.media?.customData?.audioStreamIndex,active:m.activeTrackIds,text:m.media?.tracks?.filter(t=>t.type==='TEXT').map(t=>t.trackId)}));
      const body = {phase,command,value,status:transport?.session?.status,selected:trackedMedia?.mediaSessionId,nativeMedia:transport?.currentMediaSession?.mediaSessionId,nativeItem:native.NowPlayingItem?.Id,nativePaused:native.PlayState?.IsPaused,media};
      const encoded=JSON.stringify(body,(key,value)=>{
        if(value===null)return undefined;
        if(['id','selected','nativeMedia','time','subtitle','audio','value'].includes(key)) return Number.isFinite(Number(value))?Number(value):undefined;
        return value;
      });
      if(phase==='snapshot' && (Date.now()-diagnosticAt<2000 || encoded===diagnosticLast))return;
      diagnosticAt=Date.now();diagnosticLast=encoded;
      void window.parent.fetch('/api/v1/auth/cast-diagnostics',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:encoded}).then(r=>{if(r.status===400) return window.parent.fetch('/api/v1/auth/cast-diagnostics',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({phase:'failed',command:'schema',media:[]})});}).catch(()=>{});
      } catch { void window.parent.fetch('/api/v1/auth/cast-diagnostics',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({phase:'failed',command:'diagnose',media:[]})}).catch(()=>{}); }
    };
    const storageKey = () => `seerr.cast.session.v1:${api().serverId()}:${api().getCurrentUserId()}`;
    const readSaved = () => {
      try {
        const saved = JSON.parse(window.localStorage?.getItem(storageKey()) || 'null');
        return saved?.version === 1 && typeof saved.sessionId === 'string' && typeof saved.label === 'string' && saved.updated > Date.now()-12*3600000 ? saved : undefined;
      } catch { return undefined; }
    };
    const save = () => {
      if (!remembered?.label) return;
      try { window.localStorage?.setItem(storageKey(),JSON.stringify({version:1,sessionId:remembered.sessionId,label:remembered.label,snapshot:lastSnapshot,updated:Date.now()})); } catch { /* Private mode can disable storage. */ }
    };
    const forget = () => { try { window.localStorage?.removeItem(storageKey()); } catch { /* Private mode. */ } };
    const matches = (saved,session) => saved && (
      (saved.sessionId && saved.sessionId === session.sessionId) ||
      (saved.label && saved.label === session.receiver?.label)
    );
    const attachPlayer = player => {
      window.SeerrCastLifecycle.attach(player);
      if (player?._castPlayer) player._castPlayer.__seerrAcceptJoin = session => Boolean(connecting || matches(remembered || readSaved(),session));
      if (player?._castPlayer) player._castPlayer.__seerrAfterJoin = session => {
        if (disposed || !matches(remembered || readSaved(),session) || session.status === 'stopped') return;
        remember();
        connectionError = undefined;
      };
    };
    const usable = target => !target.isLocalPlayer && target.playableMediaTypes?.includes('Video');
    const assertRemote = () => { if (!remote()) throw Error('The device disconnected. Choose a device again.'); };
    // Jellyfin's native Chromecast plugin discards command callbacks. Use the
    // existing paired Cast session's standard media controls with delivery ACKs.
    // Keep native pairing, loading/authentication and stream negotiation intact.
    const acknowledged = (invoke, timeout = 5000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(Error('The TV control connection timed out.'),{code:'timeout'})), timeout);
      const done = fn => value => { clearTimeout(timer); fn(value); };
      try { invoke(done(resolve), done(error => reject(Object.assign(Error(error?.description || error?.code || 'The device rejected the playback command.'),{code:error?.code})))); }
      catch (error) { clearTimeout(timer); reject(error); }
    });
    const castTransport = () => (remote() ? current() : remembered?.player)?._castPlayer;
    // Stream changes and auto-next replace mediaSessionId. Prefer the SDK's
    // live media over the native plugin's cached handle.
    const castMedia = () => {
      const transport = castTransport(), session = transport?.session;
      const liveMedia = session?.media?.filter(media => media.__seerrAlive !== false) || [];
      // SDK arrays can retain the previous stream in either order after a
      // track reload. Media session IDs identify the newest receiver stream.
      const media = liveMedia.reduce((latest, candidate) => {
        if (!latest) return candidate;
        if (Number.isFinite(latest.mediaSessionId) && Number.isFinite(candidate.mediaSessionId))
          return candidate.mediaSessionId > latest.mediaSessionId ? candidate : latest;
        return candidate;
      }, undefined) || transport?.currentMediaSession;
      if (media !== trackedMedia) {
        trackedMedia?.removeUpdateListener?.(mediaListener);
        trackedMedia = media;
        mediaListener = alive => { media.__seerrAlive = alive; };
        media?.addUpdateListener?.(mediaListener);
      }
      return media;
    };
    const remember = () => {
      const player = current(), session = player?._castPlayer?.session;
      if (!remote() || !session?.sessionId || session.status === 'stopped') return;
      attachPlayer(player);
      if (remembered?.sessionId === session.sessionId && remembered.player === player) return;
      if (remembered?.player === player && matches(remembered,session)) {
        remembered.sessionId = session.sessionId;
        save();
        return;
      }
      // Auto-join can precede restore(): do not overwrite the saved episode
      // snapshot with an empty SDK session while its first status is pending.
      const saved = readSaved();
      if (!lastSnapshot && matches(saved,session)) lastSnapshot = saved.snapshot;
      remembered = {player,target:manager.getPlayerInfo(),sessionId:session.sessionId,label:session.receiver?.label};
      save();
    };
    const recover = (interactive = false) => {
      if (recovery && !interactive) return recovery;
      const saved = remembered, stamp = epoch;
      if (!saved || disposed || !(interactive ? window.chrome?.cast?.requestSession : window.chrome?.cast?.requestSessionById))
        return Promise.reject(Error('The device disconnected. Choose a device again.'));
      // Manual reconnect must invoke the picker synchronously during the click.
      // Android may not revive a severed Presentation connection by ID alone.
      if (recovery && interactive) return recovery;
      const transport = saved.player._castPlayer;
      // Reconnect is a user gesture even when its first attempt is labelled
      // non-interactive by Seerr. Preserve that activation for a cold sender
      // whose browser no longer has the saved route (for example force-close).
      const userGesture = window.navigator?.userActivation?.isActive === true;
      transport.__seerrRejoining = true;
      recovery = (async () => {
        // Keep a working SDK media channel even if the native plugin lost
        // its active-player state. Discovery is unnecessary in that case.
        const existing = transport.session;
        if (existing?.status === 'connected' && matches(saved,existing) && !castMedia()?.getStatus && Number.isFinite(lastSnapshot?.mediaSessionId) && window.chrome?.cast?.media?.Media) {
          const handle = new window.chrome.cast.media.Media(existing.sessionId,lastSnapshot.mediaSessionId);
          try {
            await acknowledged((ok,fail)=>handle.getStatus(null,ok,fail),1500);
            if(disposed || stamp!==epoch) throw Error('Casting connection changed.');
            transport.currentMediaSession=handle;
          } catch { /* Receiver may have advanced to a new media session. */ }
        }
        // A resumed receiver may have no SDK Media object until its first
        // status reply. Request that reply without loading or stopping media.
        if (!interactive && !userGesture && existing?.status === 'connected' && matches(saved,existing) && !castMedia()?.getStatus && existing.sendMessage) {
          try {
            await acknowledged((ok,fail)=>existing.sendMessage('urn:x-cast:com.google.cast.media',{type:'GET_STATUS',requestId:Math.floor(Date.now()%1000000000)},ok,fail),1500);
            const until=Date.now()+1500;
            while(!castMedia()?.getStatus && Date.now()<until) await new Promise(resolve=>setTimeout(resolve,100));
          } catch { /* Continue with normal bounded session recovery. */ }
        }
        const existingMedia = existing?.status === 'connected' && matches(saved,existing) ? castMedia() : undefined;
        const usePicker = (interactive || userGesture) && !existingMedia?.getStatus;
        if (existingMedia?.getStatus) {
          const media = castMedia();
          if (media?.getStatus) {
            try {
              await acknowledged((ok,fail) => media.getStatus(null,ok,fail),1500);
              if (disposed || stamp !== epoch) throw Error('Casting connection changed.');
              if (!remote()) manager.setActivePlayer(saved.player,saved.player.getCurrentTargetInfo?.() || saved.target);
              connectionError = undefined;
              return;
            } catch(error) { if (disposed || stamp !== epoch) throw error; }
          }
        }
        const session = await new Promise((resolve,reject) => {
          // A browser can show controls for an existing route without ever
          // resolving requestSession. Also accept an acknowledged live session,
          // and bound every recovery attempt so controls cannot stay locked.
          let settled = false, poll;
          const finish = (fn,value) => {
            if (settled) return;
            settled = true; clearTimeout(timer); clearTimeout(poll);
            transport.__seerrOnJoin = undefined; fn(value);
          };
          const timer = setTimeout(() => finish(reject,Error('Could not reconnect to the TV. Use Reconnect controls to select the same TV.')),usePicker ? 15000 : 5000);
          const joinedSession = joined => {
            if (!matches(saved,joined)) {
              if (usePicker) finish(reject,Error('Select the same TV to reconnect its controls.'));
              return;
            }
            finish(resolve,joined);
          };
          const checkLive = async () => {
            if (settled) return;
            const live = transport.session;
            if (live?.status === 'connected' && matches(saved,live)) {
              const media = castMedia();
              if (media?.getStatus) {
                try {
                  await acknowledged((ok,fail) => media.getStatus(null,ok,fail),1000);
                  if (!settled) joinedSession(live);
                } catch { /* Wait for the SDK's renewed channel. */ }
              }
            }
            if (!settled) poll = setTimeout(checkLive,500);
          };
          transport.__seerrOnJoin = joinedSession;
          try {
            if (usePicker) window.chrome.cast.requestSession(joinedSession,error => finish(reject,error));
            else window.chrome.cast.requestSessionById(saved.sessionId);
            if (!settled) poll = setTimeout(checkLive,200);
          }
          catch(error) { finish(reject,error); }
        });
        if (disposed || stamp !== epoch || !matches(saved,session) || session.status === 'stopped' || (remote() && current() !== saved.player))
          throw Error('Casting connection changed. Choose a device again.');
        if (!remote()) manager.setActivePlayer(saved.player,saved.player.getCurrentTargetInfo?.() || saved.target);
        if (transport.session !== session) transport.onSessionConnected?.(session);
        transport.session = session;
        saved.sessionId = session.sessionId;
        const media = castMedia();
        if (media?.getStatus) await acknowledged((ok,fail) => media.getStatus(null,ok,fail),3000);
        connectionError = undefined;
        save();
      })().catch(error => {
        const failure = error instanceof Error ? error : Object.assign(Error(error?.description || error?.code || 'Could not reconnect the TV control channel.'),{code:error?.code});
        connectionError = failure.message;
        throw failure;
      }).finally(() => {
        setTimeout(() => { transport.__seerrRejoining = false; },1000);
        recovery = undefined;
      });
      return recovery;
    };
    const foreground = () => {
      if (!disposed && remembered && window.parent.document.visibilityState !== 'hidden') void recover().catch(() => {});
    };
    window.parent.document.addEventListener('visibilitychange',foreground);
    window.parent.document.addEventListener('visibilitychange',save);
    window.parent.addEventListener('pageshow',foreground);
    window.parent.addEventListener('online',foreground);
    window.addEventListener('pagehide', event => {
      if (!event.isTrusted || (event.target !== window && event.target !== document)) return;
      if (event?.persisted) return;
      window.parent.document.removeEventListener('visibilitychange',foreground);
      window.parent.document.removeEventListener('visibilitychange',save);
      window.parent.removeEventListener('pageshow',foreground);
      window.parent.removeEventListener('online',foreground);
      trackedMedia?.removeUpdateListener?.(mediaListener);
    });
    const retryable = error => ['timeout','channel_error','session_error'].includes(error?.code) || (error?.code === 'invalid_parameter' && /No active session/i.test(error.message || ''));
    const sendNative = (transport, message) => {
      const previousSend = transport.sendMessageInternal;
      transport.sendMessageInternal = envelope => acknowledged((ok,fail) => transport.session.sendMessage('urn:x-cast:com.connectsdk',JSON.stringify(envelope),ok,fail));
      try { return transport.sendMessage(message); }
      finally { transport.sendMessageInternal = previousSend; }
    };
    const waitForTrack = async (type,index,itemId) => {
      const deadline = Date.now() + 12000;
      while (!disposed && Date.now() < deadline) {
        const media = castMedia(), data = media?.media?.customData;
        const state = manager.getPlayerState(current()) || {};
        const actualId = data?.itemId || state.NowPlayingItem?.Id;
        // CAF clears item/customData briefly while replacing a burned-in
        // subtitle stream. Only a confirmed different item means auto-next.
        if (actualId && actualId !== itemId) throw Error('The episode changed. Select its tracks again.');
        const actual = type === 'audio' ? data?.audioStreamIndex ?? state.PlayState?.AudioStreamIndex : data?.subtitleStreamIndex ?? state.PlayState?.SubtitleStreamIndex;
        if (actualId === itemId && actual === index) return;
        await new Promise(resolve => setTimeout(resolve,100));
      }
      throw Object.assign(Error('The TV has not applied the track change. Reconnect controls and try again.'),{code:'timeout'});
    };
    const changeTrack = async (command,index) => {
      const transport = castTransport(), media = castMedia(), data = media?.media?.customData || {};
      const state = window.__seerrCast.snapshot(), id = data.itemId || state.itemId;
      const textTracks = media?.media?.tracks?.filter(t => t.type === 'TEXT') || [];
      const currentIndex = data.subtitleStreamIndex ?? (Number.isFinite(media?.mediaSessionId) ? state.subtitleIndex : undefined);
      const burned = Number.isInteger(currentIndex) && currentIndex >= 0 && !textTracks.some(t => t.trackId === currentIndex);
      const targetText = textTracks.find(t => t.trackId === index);
      if (command === 'subtitles' && !burned && (targetText || (index === -1 && textTracks.length)) && media?.editTracksInfo && window.chrome?.cast?.media?.EditTracksInfoRequest) {
        // CAF text tracks can change immediately without a new transcode.
        const request = new window.chrome.cast.media.EditTracksInfoRequest(index === -1 ? [] : [targetText.trackId]);
        await acknowledged((ok,fail) => media.editTracksInfo(request,ok,fail));
        return;
      }
      if (command === 'subtitles' && Number.isInteger(currentIndex) && (burned || (index >= 0 && !targetText))) {
        if (!id) throw Error('The TV is still loading this episode.');
        if (metadata?.Id !== id) metadata = await api().getItem(api().getCurrentUserId(),id);
        const playlist = transport.__seerrPlaylist || [];
        const offset = playlist.findIndex(item => item.Id === id);
        const items = offset >= 0 ? playlist.slice(offset) : [{Id:id,ServerId:api().serverId(),Name:metadata.Name,Type:metadata.Type,MediaType:metadata.MediaType}];
        // Receiver 1.3.1 treats Encode -> Encode as a text-track change and
        // leaves old burned-in pixels in place. Renegotiate the same item at
        // its absolute position with the selected index, preserving its queue.
        await sendNative(transport,{command:'PlayNow',options:{items,startPositionTicks:Math.round(state.position*10000000),
          mediaSourceId:data.mediaSourceId,audioStreamIndex:state.audioIndex,subtitleStreamIndex:index}});
        await waitForTrack(command,index,id);
        if (state.paused) {
          const fresh = castMedia(), sdk = window.chrome.cast.media;
          if (fresh?.pause) await acknowledged((ok,fail) => fresh.pause(new sdk.PauseRequest(),ok,fail));
        }
        return;
      }
      await sendNative(transport,{options:{index},command:command === 'audio' ? 'SetAudioStreamIndex' : 'SetSubtitleStreamIndex'});
      // Legacy remote sessions lack SDK customData; their native receiver
      // state remains the existing fallback. Chromecast reports exact indices.
      if (id && Number.isInteger(data.audioStreamIndex) && command === 'audio') await waitForTrack(command,index,id);
    };
    const getTracks = (state,id = state.NowPlayingItem?.Id) => {
      if (id && metadata?.Id !== id && metadataPending !== id) {
        metadataPending = id;
        void api().getItem(api().getCurrentUserId(), id).then(item => { metadata = item; })
          .catch(() => {}).finally(() => { if(metadataPending === id) metadataPending = undefined; });
      }
      const sourceId = state.PlayState?.MediaSourceId;
      const sources = state.NowPlayingItem?.MediaSources || (id && metadata?.Id === id ? metadata.MediaSources : undefined);
      const source = sources?.find(s => s.Id === sourceId) || sources?.[0];
      const streams = source?.MediaStreams || state.NowPlayingItem?.MediaStreams || (id && metadata?.Id === id ? metadata.MediaStreams : []) || [];
      const tracks = type => streams.filter(s => s.Type === type).map(s => ({index:s.Index,label:s.DisplayTitle || [s.Language,s.Title,s.Codec].filter(Boolean).join(' · ') || `${type} ${s.Index + 1}`}));
      return {audio:tracks('Audio'),subtitles:tracks('Subtitle'),audioIndex:state.PlayState?.AudioStreamIndex ?? source?.DefaultAudioStreamIndex,subtitleIndex:state.PlayState?.SubtitleStreamIndex ?? source?.DefaultSubtitleStreamIndex ?? -1};
    };
    window.__seerrCast = {
      acceptsSession: session => {
        const saved=remembered || readSaved();
        const accepted=Boolean(connecting || matches(saved,session));
        diagnose('restore',accepted?'accept':'reject',(saved?.sessionId===session.sessionId?1:0)+(saved?.label===session.receiver?.label?2:0));
        return accepted;
      },
      ready: () => {
        manager.getPlayers().filter(p=>p._castPlayer).forEach(attachPlayer);
        return !disposed && !!api()?.getCurrentUserId() && manager.getPlayers().length > 0;
      },
      async restore() {
        const saved = readSaved();
        if (!saved || disposed) return false;
        const deadline = Date.now()+10000;
        let player;
        while (!disposed && Date.now()<deadline) {
          player = manager.getPlayers().find(p=>p._castPlayer?.isInitialized);
          if (player) break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        if (!player || disposed) return false;
        attachPlayer(player);
        const live = player._castPlayer.session;
        if (live && !matches(saved,live)) return false;
        remembered = {player,target:player.getCurrentTargetInfo?.() || {id:player.name,name:player.name,playerName:player.name,isLocalPlayer:false},sessionId:saved.sessionId,label:saved.label};
        lastSnapshot = {...saved.snapshot,connected:true,connection:'disconnected'};
        try { await recover(); } catch { /* Retain reconnect controls. */ }
        return true;
      },
      async discover() {
        if (!api()?.getCurrentUserId()) throw Error('Player authentication is still connecting.');
        const deadline = Date.now()+6000;
        do {
          targets = (await manager.getTargets()).filter(usable);
          if (targets.length || disposed || Date.now() >= deadline) break;
          // Authentication can be ready before the Cast plugin/SDK target.
          // Wait only when the user opens discovery, never while browsing.
          await new Promise(resolve=>setTimeout(resolve,200));
        } while (!disposed);
        return targets.map(t => ({id:t.id, name:t.deviceName || t.name, appName:t.appName, type:t.deviceType,
          active:manager.getPlayerInfo()?.id === t.id}));
      },
      // Pair is deliberately invoked before the first await: Google Cast needs
      // the original user gesture to open its browser-owned receiver picker.
      async connect(id, itemId, ticks, handoff) {
        if (connecting) throw Error('A connection is already in progress.');
        const target = targets.find(t => t.id === id);
        if (!target || !/^[a-f0-9]{32}$/i.test(itemId) || (ticks !== undefined && (!Number.isSafeInteger(ticks) || ticks < 0)))
          throw Error('Choose an available device and media item.');
        const player = manager.getPlayers().find(p => p.name === target.playerName);
        if (!player) throw Error('This device is no longer available.');
        connecting = true;
        const previous = manager.getPlayerInfo();
        let latest;
        try {
          const paired = remote() && previous?.id === id;
          const pairing = paired || !player.tryPair ? Promise.resolve() : player.tryPair(target);
          await pairing;
          manager.setActivePlayer(player, target);
          const item = await api().getItem(api().getCurrentUserId(), itemId);
          metadata = item;
          item.ServerId = api().serverId();
          const resume = ticks ?? item.UserData?.PlaybackPositionTicks ?? 0;
          if (disposed) throw Error('Casting connection closed.');
          // Read local position again after pairing, rather than rewinding the
          // seconds spent choosing a receiver. Pause local playback only now.
          latest = handoff?.();
          const existingMedia = castMedia();
          if (!latest && existingMedia?.media?.customData?.itemId === itemId && ['PLAYING','PAUSED','BUFFERING'].includes(existingMedia.playerState)) {
            // Also recover a cast started before reconnect records existed.
            // Selecting its same item/TV should attach controls, not replay it.
            if (existingMedia.getStatus) await acknowledged((ok,fail) => existingMedia.getStatus(null,ok,fail),3000);
            remember(); connectionError = undefined;
            return this.snapshot();
          }
          const position = (!latest?.itemId || latest.itemId === itemId) && Number.isSafeInteger(latest?.ticks) && latest.ticks >= 0 ? latest.ticks : resume;
          await manager.play({items:[item],startPositionTicks:position,enableRemotePlayers:true});
          remember();
          connectionError = undefined;
          latest?.commit?.();
          return this.snapshot();
        } catch (error) {
          const live = castMedia();
          if (!disposed && live?.media?.customData?.itemId === itemId && ['PLAYING','PAUSED','BUFFERING'].includes(live.playerState) && live.getStatus) {
            // A load can reach the TV before the native player's promise
            // times out. Confirm it instead of discarding a working session.
            try {
              await acknowledged((ok,fail) => live.getStatus(null,ok,fail),3000);
              remember(); connectionError = undefined;
              latest?.commit?.();
              return this.snapshot();
            } catch { /* Preserve normal failure/rollback when unconfirmed. */ }
          }
          const oldTarget = targets.find(t => t.id === previous?.id);
          if (oldTarget) manager.setActivePlayer(previous.name, oldTarget);
          else manager.setDefaultPlayerActive();
          throw error;
        } finally { connecting = false; }
      },
      snapshot() {
        diagnose('snapshot');
        remember();
        const session = castTransport()?.session;
        if (session?.status === 'stopped') { forget(); remembered = undefined; lastSnapshot = undefined; return {connected:false}; }
        if (remembered && (!remote() || session?.status === 'disconnected' || recovery || connectionError))
          return {...lastSnapshot,connected:true,connection:recovery ? 'recovering' : 'disconnected',connectionError};
        if (!remote()) return {connected:false};
        const info = manager.getPlayerInfo(), nativeState = manager.getPlayerState(current()) || {};
        const sdkItemId = castMedia()?.media?.customData?.itemId;
        if (session?.status === 'connected' && !nativeState.NowPlayingItem?.Id && !sdkItemId && !Number.isFinite(castMedia()?.mediaSessionId) && lastSnapshot?.itemId)
          return {...lastSnapshot,connected:true,connection:'connected',deviceName:session?.receiver?.friendlyName || lastSnapshot.deviceName};
        // Native Identify refresh is asynchronous after rejoining. Retain the
        // last known item while the SDK refreshes time/state; never reload it.
        const state = {...nativeState,NowPlayingItem:nativeState.NowPlayingItem || ((sdkItemId || lastSnapshot?.itemId) === metadata?.Id ? metadata : undefined)};
        if (state.Id && state.SupportsRemoteControl === false && !remembered) {
          manager.setDefaultPlayerActive();
          return {connected:false};
        }
        const media = castMedia(), itemId = sdkItemId || state.NowPlayingItem?.Id || lastSnapshot?.itemId;
        const item = state.NowPlayingItem || (itemId && metadata?.Id === itemId ? metadata : undefined), play = state.PlayState || {};
        const tracks = getTracks(state,itemId), supported = manager.getSupportedCommands(current());
        if (!tracks.audio.length && lastSnapshot?.itemId === itemId) tracks.audio = lastSnapshot.audio || [];
        if (!tracks.subtitles.length && lastSnapshot?.itemId === itemId) tracks.subtitles = lastSnapshot.subtitles || [];
        const data = media?.media?.customData;
        if (lastSnapshot?.itemId === itemId) {
          // A resumed SDK handle can initially contain only time/pause status.
          // Keep confirmed track choices until the receiver supplies new ones.
          if (!Number.isInteger(data?.audioStreamIndex) && !Number.isInteger(play.AudioStreamIndex) && Number.isInteger(lastSnapshot.audioIndex)) tracks.audioIndex=lastSnapshot.audioIndex;
          if (!Number.isInteger(data?.subtitleStreamIndex) && !Number.isInteger(play.SubtitleStreamIndex) && Number.isInteger(lastSnapshot.subtitleIndex)) tracks.subtitleIndex=lastSnapshot.subtitleIndex;
        }
        if (Number.isInteger(data?.audioStreamIndex)) tracks.audioIndex = data.audioStreamIndex;
        if (Number.isInteger(data?.subtitleStreamIndex)) tracks.subtitleIndex = data.subtitleStreamIndex;
        if (media?.media?.tracks?.some(t => t.type === 'TEXT') && Array.isArray(media.activeTrackIds) && !(data?.subtitleStreamIndex >= 0 && !media.media.tracks.some(t => t.type === 'TEXT' && t.trackId === data.subtitleStreamIndex)))
          tracks.subtitleIndex = media.activeTrackIds[0] ?? -1;
        const nativeSeconds = Math.max(0, Number(play.PositionTicks || 0)/10000000);
        const offset = media?.media?.customData?.canClientSeek === false ? Number(media.media.customData.startPositionTicks || 0)/10000000 : 0;
        const castSeconds = (media?.getEstimatedTime?.() ?? media?.currentTime) + offset;
        const previous = lastSnapshot?.itemId === itemId ? lastSnapshot : undefined;
        lastSnapshot = {connected:true, connection:'connected', deviceName:session?.receiver?.friendlyName || info?.deviceName || info?.name || 'Device', itemId,
          mediaSessionId:media?.mediaSessionId ?? previous?.mediaSessionId,
          title:item?.Name || media?.media?.metadata?.title || previous?.title, seasonNumber:item?.ParentIndexNumber ?? previous?.seasonNumber, episodeNumber:item?.IndexNumber ?? previous?.episodeNumber,
          position:Number.isFinite(castSeconds) ? Math.max(0,castSeconds) : nativeSeconds,
          duration:Math.max(0, Number(item?.RunTimeTicks || metadata?.RunTimeTicks || 0)/10000000) || Number(media?.media?.duration) || 0,
          paused:media?.playerState ? media.playerState === 'PAUSED' : !!play.IsPaused,
          volume:Number.isFinite(session?.receiver?.volume?.level) ? Math.round(session.receiver.volume.level*100) : play.VolumeLevel,
          canSeek:data?.canSeek ?? play.CanSeek !== false, canVolume:supported.includes('SetVolume'), playMethod:data?.playMethod || play.PlayMethod,
          ...tracks,canAudio:supported.includes('SetAudioStreamIndex'),canSubtitles:supported.includes('SetSubtitleStreamIndex')};
        save();
        return lastSnapshot;
      },
      command(command, value) {
        diagnose('command',command,value);
        if (!remembered) assertRemote();
        if (command === 'jump' && Number.isFinite(value)) {
          const state = this.snapshot();
          const anchor = seekIntent?.until > Date.now() ? seekIntent.position : state.position;
          const position = Math.max(0,Math.min(state.duration || Infinity,anchor + value));
          return this.command('seek',position);
        }
        if (command === 'seek' && Number.isFinite(value) && value >= 0) seekIntent = {position:value,until:Date.now()+2000};
        if (castTransport()?.session || remembered) {
          if (pendingCommands >= 8) throw Error('TV controls are reconnecting. Please wait a moment.');
          pendingCommands++;
          const stamp = epoch, selected = remembered?.label || remembered?.sessionId, mediaId = this.snapshot().itemId;
          const run = async () => {
            if (disposed || stamp !== epoch || (selected && (remembered?.label || remembered?.sessionId) !== selected)) throw Error('Casting connection changed.');
            if (mediaId && this.snapshot().itemId && this.snapshot().itemId !== mediaId) throw Error('The episode changed. Try the control again.');
            if (recovery) await recovery;
            if (connectionError || !remote() || castTransport()?.session?.status === 'disconnected') await recover();
            if (stamp !== epoch || disposed) throw Error('Casting connection changed.');
            try { await this.deliver(command,value); connectionError = undefined; }
            catch(error) {
              if (!retryable(error)) throw error;
              await recover();
              if (stamp !== epoch || disposed) throw Error('Casting connection changed.');
              if (mediaId && this.snapshot().itemId !== mediaId) throw Error('The episode changed. Try the control again.');
              // Absolute commands can be retried once, including jumps converted
              // to absolute seeks before queuing. Never restart or reload media.
              try { await this.deliver(command,value); }
              catch(retryError) { if (retryable(retryError)) connectionError = 'The TV is still unreachable. Reconnect its controls or choose a device again.'; throw retryError; }
            }
            // Send ACKs confirm delivery; a fresh status confirms the actual
            // playing/paused state and CAF track IDs on a restored sender.
            const updatedMedia = castMedia();
            if (updatedMedia?.getStatus) await acknowledged((ok,fail) => updatedMedia.getStatus(null,ok,fail),3000);
            diagnose('ack',command,value);
            return this.snapshot();
          };
          const result = queue.then(run).finally(() => { pendingCommands--; });
          queue = result.catch(() => {});
          return result;
        }
        return this.deliver(command,value);
      },
      deliver(command,value) {
        assertRemote();
        const transport = castTransport(), session = transport?.session, media = castMedia(), sdk = window.chrome?.cast?.media;
        if (session && sdk) {
          if (command === 'volume' && Number.isFinite(value) && value >= 0 && value <= 100)
            return acknowledged((ok,fail) => session.setReceiverVolumeLevel(value/100,ok,fail));
          if (command === 'pause' && media?.pause)
            return acknowledged((ok,fail) => media.pause(new sdk.PauseRequest(),ok,fail));
          if (command === 'play' && media?.play)
            return acknowledged((ok,fail) => media.play(new sdk.PlayRequest(),ok,fail));
          if (command === 'seek' && Number.isFinite(value) && value >= 0 && media?.seek && media.media?.customData?.canClientSeek !== false) {
            const request = new sdk.SeekRequest(); request.currentTime = value;
            return acknowledged((ok,fail) => media.seek(request,ok,fail));
          }
          // Stream selection is Jellyfin-specific: retain its native envelope
          // (token/server/session) while acknowledging the Cast send callback.
          if (['audio','subtitles'].includes(command) && Number.isInteger(value) && value >= (command === 'subtitles' ? -1 : 0)) {
            return changeTrack(command,value);
          }
          if (['pause','play','stop'].includes(command))
            return sendNative(transport,{options:{},command:{pause:'Pause',play:'Unpause',stop:'Stop'}[command]});
          if (command === 'seek' && Number.isFinite(value) && value >= 0)
            return sendNative(transport,{options:{position:value},command:'Seek'});
        }
        if (command === 'pause') return manager.pause(current());
        if (command === 'play') return manager.unpause(current());
        if (command === 'seek' && Number.isFinite(value) && value >= 0)
          return manager.seek(Math.round(value*10000000), current());
        if (command === 'volume' && Number.isFinite(value) && value >= 0 && value <= 100)
          return manager.setVolume(value, current());
        if (command === 'stop') return manager.stop(current());
        if (command === 'audio' && Number.isInteger(value) && value >= 0) return manager.setAudioStreamIndex(value,current());
        if (command === 'subtitles' && Number.isInteger(value) && value >= -1) return manager.setSubtitleStreamIndex(value,current());
        throw Error('Unsupported playback control.');
      },
      async disconnect(stop = false) {
        if (!remote() && !remembered) return;
        const player = remembered?.player || current();
        if (stop) {
          if (castTransport()?.session) {
            player._playNextAfterEnded = false;
            await this.command('stop');
          } else await manager.stop(player);
        }
        manager.setDefaultPlayerActive();
        forget(); epoch++; remembered = undefined; lastSnapshot = undefined; connectionError = undefined; seekIntent = undefined;
      },
      recover
    };
  };
})();
