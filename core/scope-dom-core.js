
"use strict";
(()=>{
	function noopFn(){}; async function noopAsyncFn(){}; 
	
	// Call multiple callbacks on Animation Frame
	let rAFList=new Set(), onceRAFList=new Map(), isDuringRAF=false, isScheduled=false;
	function _scheduledRAF(){
		isDuringRAF = true;
		let list=[...rAFList.values()]; rAFList.clear();
		for(let cb of list) try{ cb(); }catch(err){ console.error(err); }
		let list2=[...onceRAFList.values()]; onceRAFList.clear();
		for(let s of list2) for(let [k,cb] of s) try{ cb(); }catch(err){ console.error(err); }
		isScheduled = false;
		Promise.resolve().then(()=>{ isDuringRAF=false; });
	};
	function requestAF(cb){
		rAFList.add(cb);
		if(!isScheduled) isScheduled=requestAnimationFrame(_scheduledRAF),true;
	};
	// Call one callback on Animation Frame, unique by obj+key. First cb only, unless useLast to use last cb called with
	function onceRAF(obj,key,cb,useLast=true){
		if(obj===void 0 || obj===null) obj = onceRAF;
		if(key===void 0 || key===null) key = 0;
		let list = onceRAFList.get(obj);
		if(!list) onceRAFList.set(obj,(list=new Map()));
		let hasCB = list.has(key);
		if(useLast && hasCB) list.set(key,cb);
		else if(!hasCB) list.set(key,cb);
		if(!isScheduled) isScheduled=requestAnimationFrame(_scheduledRAF),true;
		return !hasCB; // True if fresh (first cb)
	};
	function promiseToRAF(p,cb,cbErr){ return p.then((r)=>requestAF(()=>cb(r)),(err)=>requestAF(cbErr?cbErr:()=>console.error(err))); }
	
	function regexMatchAll(str,r){ return str.matchAll(r); } // matchAll clones regex, and doesn't need lastIndex=0
	function regexExec(str,r){ r.lastIndex=0; return r.exec(str); };
	function regexTest(str,r){ r.lastIndex=0; return r.test(str); };
	
	function setAttribute(target,name,value){ // Set attribute with less name limitations
		try{ target.setAttribute(name,value); }
		catch(e){
			let t=document.createElement('template'); t.innerHTML=`<span ${name}=""></span>`;
			let a=t.content.firstChild.attributes.item(name).cloneNode(false); a.value=value;
			target.attributes.setNamedItem(a);
		}
	}
	
	const elementNodeType = document.ELEMENT_NODE;
	const commentNodeType = document.COMMENT_NODE;
	const textNodeType = document.TEXT_NODE;
	
	const objectProto = Object.getPrototypeOf(Object());
	const objectConstructor = objectProto.constructor; // Same as window.Object
	const nodeProto = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(document.createTextNode('text'))));
	const nodeConstructor = nodeProto.constructor;
	const elementProto = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(document.createElement('div'))));
	const elementConstructor = elementProto.constructor;
	function scopeAllowed(obj){
		if(!obj) return false;
		if(obj===objectProto || obj===objectConstructor || obj===nodeProto || obj===nodeConstructor || obj===elementProto || obj===elementConstructor) return false;
		return true;
	}
	
	const isElementLoaded = (()=>{
		let domState=0, listener = ()=>{
			if(document.readyState==='interactive') domState=1;
			else if(document.readyState==='complete'){ domState=2; document.removeEventListener("readystatechange",listener); }
		};
		document.addEventListener("readystatechange",listener,{ capture:true, passive:true, once:false });
		return function isElementLoaded(element,hasChildNodes=false,partial=false){
			if(partial && domState===1) return true;
			else if(domState===2) return true;
			if(element.nodeType===textNodeType && element.nextSibling && element.nextSibling.nodeType!==textNodeType) return true;
			if(hasChildNodes && (element?.childNodes?.length>0 || element?.content?.childNodes?.length>0)) return true;
			for(let e=element; e; e=e.parentNode) if(e.nextSibling) return true;
			//console.log("Waiting on: ",element);
			return false;
		};
	})();
	
	const disableDocumentDefaultView = ()=>{ try{ Object.defineProperty(window.document,'defaultView',{ get(){ console.warn("scopeDom: document.defaultView is disabled"); return { getComputedStyle:window.getComputedStyle.bind(window) }; } }); }catch(e){ console.warn("scopeDom: Could not disable document.defaultView\n",e); } }
	
	const initDefaults = {
		attribRegexMatch: /^\$((?:[\w\d]+)(?:\-[\w\d]+)*?)(?:\:((?:[\w\d]+)(?:\-[\w\d]+)*?))?$/, // group1: name, group2: option
		attribRegexParts: /([\w\d]+)/g,
		attribIgnore: '$ignore',
		// attribFormatTest: '$aa-bb-cc', // test these (if they exist), if fail, throw
		// attribOptionsFormatTest: '$aa-bb-cc:oa-ob',
		globalContext: true,
		documentContext: true,
		documentDefaultView: false,
		scope: null,
		attributeAliases: null,
		attributeAliasNameKeys: null,
		autoReady: true,
		element: null,
		once: true, // Prevent further scopeDom instances
	};
	let mainInstance = null;
	let singleInstance = null;
	
	class scopeDom {
		
		static get instance(){
			return mainInstance;
		}
		
		static init(options={}){
			if(mainInstance) throw new Error("scopeDom: main instance already initialised");
			if(singleInstance) throw new Error("scopeDom: single instance already initialised");
			let inst = mainInstance = new scopeDom(options);
			return inst._beginDomWatching(), inst;
		}
		
		constructor(options={}){
			if(singleInstance) throw new Error("scopeDom: single instance already constructed");
			this._options = options = Object.assign(Object.create(initDefaults),Object(options));
			Object.freeze(this._options);
			if(options.once) singleInstance = this;
			if(!options.globalContext && options.documentContext && !options.documentDefaultView && window.document) disableDocumentDefaultView();
			else if(options.globalContext && !options.documentContext) throw new Error("scopeDom: For documentContext to be false, globalContext must also be false");
			let scope = options.scope===Object(options.scope) ? options.scope : new scopeBase();
			if(!Object.hasOwn(scope,'$scope')) Object.defineProperty(scope,'$scope',{ get(){ return this; } });
			this.mainElement = options.element || null;
			this.controller = new scopeController(scope,null,null,false,this);
			this.namedScopeControllers = new Map();
			this._cacheWatchObservers = new Map();
			this._cacheConnectedNodes = new WeakSet();
			this._pendingConnectNodes = new Set();
			this._pendingOnElementLoaded = new Map();
			this._cacheElementScopeCtrls = new WeakMap();
			this._cacheElementAttribs = new WeakMap();
			this._cacheElementAttribsDefaults = new WeakMap();
			this._ignoreNodes = new WeakSet();
			this._elementRelatedEventListeners = new WeakMap();
			this._elementExtraScopes = new WeakMap(); // element -> array -> objects/elements
			this._elementIsolatedScopes = new WeakSet();
			this._onReadyListeners = new Set();
			this._onDOMReadyListeners = new Set();
			this._duringOnReady = false;
			this._plugins = { init:false, register:new Set(), onConnect:new Set(), onDisconnect:new Set(), onPluginAdd:new Set() };
			this._initPlugins();
		}
		
		_beginDomWatching(){
			let mutObs=null, onMainElement=()=>{
				if(!this.mainElement) this.mainElement=document.body;
				if(mutObs) mutObs.disconnect();
				this.watchDomTree(this.mainElement);
				this.scanDomTree(this.mainElement);
				if(this._options.autoReady){
					this.setReadyOnDomLoaded();
					this.setReadyOnRaf();
				}
			};
			if(this.mainElement) onMainElement();
			else {
				if(document.body) return onMainElement();
				mutObs = new MutationObserver(function domMutation(m){ if(document.body) onMainElement(); });
				mutObs.observe(document.head.parentNode,{ subtree:false, childList:true, attributes:false });
			}
		}
		
		// Scope Handling
		scopeController(name,fn){
			if(typeof name==="function") return this.scopeController(null,name);
			if(name===null || name===false || name===void 0) name = null;
			if(fn===null || fn===false || fn===void 0) fn = null;
			if(name===null && fn===null){ // Disable/Empty default scopeController
				this.namedScopeControllers.set(null,{ element:null, name, fn });
				return;
			}
			if(!(typeof fn==="function")) throw new Error("scopeDom: scopeController params must be (name,function) or (function)");
			if(name!==null) name = ''+name;
			if(this.namedScopeControllers.has(name)) throw new Error(`scopeDom: scopeController ${name===null?'default':`"${name}"`} already exists`);
			let ctrl = { element:null, name, fn };
			this.namedScopeControllers.set(name,ctrl);
			// Default Controller
			if(name===null){
				let scope = this.controller.scope;
				let setScopes=new Set(); for(let s=scope; s && s!==Object; s=Object.getPrototypeOf(s)) setScopes.add(s); 
				let proxy = new execExpressionProxy({ mainScopes:[scope], getScopes:new Set([this.controller.execContext,scope]), setScopes, silentHas:false });
				return this.handleScopeCtrlFn(proxy,fn);
			}
		}
		handleScopeCtrlFn(proxy,fn){
			return fn.apply(proxy,[{ scope:proxy, instance:this, controller:this.controller }]);
		}
		
		// Element Scanning & Watching
		get scanDomTree(){ return this._connectElementAndChildren; }
		watchDomTree(element){
			if(this._cacheWatchObservers.has(element)) return;
			let self=this, mutObs=new MutationObserver(function domWatching(muts){
				let check=false;
				for(let m of muts){
					if(m.addedNodes.size>0) check=true;
					for(let e of m.addedNodes) self._connectElementAndChildren(e,void 0,void 0,true);
					for(let e of m.removedNodes) self._disconnectElementAndChildren(e);
				}
				if(check) this._checkPendingConnectElements();
			});
			this._cacheWatchObservers.set(element,mutObs);
			mutObs.observe(element,{ subtree:true, childList:true, attributes:false });
		}
		setReadyOnDomLoaded(){
			if(document.readyState!=='loading') this.triggerOnReady(); // Do not delay this
			let listener = function onDOMReadyStateChange(){
				if(document.readyState==='interactive') this.triggerOnReady();
				else if(document.readyState==='complete'){
					document.removeEventListener("readystatechange",listener);
					this.triggerOnReady(true);
				}
			}.bind(this);
			document.addEventListener("readystatechange",listener,{ capture:true, passive:true, once:false });
		}
		setReadyOnRaf(){
			if(!this._onReadyListeners) return;
			onceRAF(this,'readyOnRaf',this.triggerOnReady.bind(this));
		}
		
		isReady(){ return !this._onReadyListeners; }
		isDOMReady(){ return !this._onDOMReadyListeners; }
		triggerOnReady(domComplete=false){
			//try{
			this._checkPendingConnectElements();
			if(this._onReadyListeners){
				let list = this._onReadyListeners.values();
				this._onReadyListeners = null;
				this._duringOnReady = true;
				for(const cb of list) try{ cb(); }catch(err){ console.error(err); }
				this.controller.$emit("$update");
				Promise.resolve().then(()=>{ this._duringOnReady=false; });
			}
			if(this._onDOMReadyListeners && domComplete){
				let list = this._onDOMReadyListeners.values();
				this._onDOMReadyListeners = null;
				for(const cb of list) try{ cb(); }catch(err){ console.error(err); }
			}
			//}catch(err){ console.error(err); }
		}
		onReady(cb,delay=true){
			if(this._onReadyListeners) this._onReadyListeners.add(cb);
			else if(delay) Promise.resolve().then(cb);
			else cb();
		}
		onDOMReady(cb,delay=true){
			if(this._onDOMReadyListeners) this._onDOMReadyListeners.add(cb);
			else if(delay) Promise.resolve().then(cb);
			else cb();
		}
		
		onElementLoaded(element,cb){
			if(isElementLoaded(element)) try{ cb(); }catch(err){ console.error(err); }
			else {
				if(!this._pendingOnElementLoaded.has(element)) this._pendingOnElementLoaded.set(element,new Set());
				this._pendingOnElementLoaded.get(element).add(cb);
			}
		}
		elementIgnored(element,checkParents=false){
			for(let e=element; e; e=checkParents?e.parentNode:null){
				if(this._ignoreNodes.has(e)) return true;
				if(e.nodeType===elementNodeType && e.hasAttribute(this._options.attribIgnore)){
					this._ignoreNodes.add(e);
					return true;
				}
			}
			return false;
		}
		
		// Element Connection
		_connectElementAndChildren(element,act=true,list=new Set(),checkIgnoreParents=false){ // Connect parent before children
			if(element.nodeType===commentNodeType){ this.connectElement(element); return; }
			if(element.nodeType!==elementNodeType || element.nodeName==='SCRIPT' || element.nodeName==='STYLE') return;
			if(this.elementIgnored(element,checkIgnoreParents)) return;
			list.add(element);
			if(element.childNodes && element.nodeName!=='TEMPLATE' && element.nodeName!=='svg' && !element.shadowRoot) for(let e of [...element.childNodes]) this._connectElementAndChildren(e,false,list);
			if(act) for(let e of list.values()) if(e.isConnected) this.connectElement(e);
		}
		_disconnectElementAndChildren(element,act=true,list=new Set()){ // Disconnect children before parent
			if(this.elementIgnored(element,true)) return;
			if(element.childNodes) for(let e of [...element.childNodes]) this._disconnectElementAndChildren(e,false,list);
			list.add(element);
			if(act) for(let e of list.values()) if(!e.isConnected) this.disconnectElement(e);
		}
		connectElement(element){
			if(this._pendingConnectNodes.has(element) && !isElementLoaded(element,true)) return;
			if(element!==this.mainElement && !isElementLoaded(element,true)){ this._pendingConnectNodes.add(element); return; }
			if(this._cacheConnectedNodes.has(element)) return;
			this._cacheConnectedNodes.add(element);
			this._pendingConnectNodes.delete(element);
			this._triggerElementConnect(element);
		}
		disconnectElement(element){
			if(!this._cacheConnectedNodes.has(element)){ this._cleanupDisconnected(element); return; }
			this._triggerElementDisconnect(element);
			this._cleanupDisconnected(element,true);
		}
		_checkPendingConnectElements(){
			for(let e of this._pendingConnectNodes) if(isElementLoaded(e,true)) this._connectElementAndChildren(e);
			for(let [e,cbList] of this._pendingOnElementLoaded) if(isElementLoaded(e)){
				for(let cb of cbList) try{ cbList.delete(cb); cb(); }catch(err){ console.error(err); }
				this._pendingOnElementLoaded.delete(e);
			}
		}
		
		// Attrib Handling
		__regexMatchAllFirstGroup(str,regex){
			let match, matches=[]; regex.lastIndex=0;
			while(match=regex.exec(str)) matches.push(match[1]);
			return matches;
		}
		_elementAttribs(element,useCache=true,checkConnected=true){
			if(checkConnected && (!this._cacheConnectedNodes.has(element) || !element.isConnected)) return null;
			if(useCache && this._cacheElementAttribs.has(element)) return this._cacheElementAttribs.get(element);
			let rawAttribs = element.attributes;
			if(!rawAttribs) return null;
			let attribs = new Map(), rawAliases = this._options.attributeAliases||null, nkAliases = this._options.attributeAliasNameKeys||null;
			for(let { name:aName, value } of rawAttribs){
				if(rawAliases && aName in rawAliases) aName = rawAliases[aName];
				let [ _, nameFull, optionFull ] = regexExec(aName,this._options.attribRegexMatch) || [];
				if(nameFull===void 0 || nameFull.length===0) continue;
				let nameParts = this.__regexMatchAllFirstGroup(nameFull,this._options.attribRegexParts);
				if(nameParts.length<=0) continue;
				if(value?.length===0) value = null;
				let isDefault = nameParts[0]==='default';
				let nameKey = nameParts.join(' ');
				if(nkAliases && nameKey in nkAliases) nameKey = nkAliases[nameKey];
				let attrib = attribs.get(nameKey);
				if(!attrib) attribs.set(nameKey,attrib={ isDefault, attribute:aName, nameKey, nameParts, value:null, options:new Map() });
				if(optionFull!==void 0 && optionFull.length>0){
					let optionParts = this.__regexMatchAllFirstGroup(optionFull,this._options.attribRegexParts);
					let optionKey = optionParts.join(' ');
					attrib.options.set(optionKey,{ isDefault, attribute:aName, nameKey:optionKey, optionParts, value });
				}
				else attrib.value = value;
			}
			if(useCache && attribs.size>0) this._cacheElementAttribs.set(element,attribs);
			return attribs;
		}
		_elementFindDefaults(element,useCache=true,checkConnected=true){
			if(checkConnected && (!this._cacheConnectedNodes.has(element) || !element.isConnected)) return null;
			if(useCache && this._cacheElementAttribsDefaults.has(element)) return this._cacheElementAttribsDefaults.get(element);
			let defaults = new Map(), nkAliases = this._options.attributeAliasNameKeys||null;
			for(let e=element; e; e=e.parentNode){
				let attribs = this._elementAttribs(e,useCache,checkConnected);
				if(!attribs || attribs.size===0) continue;
				for(let [attribName,attrib] of attribs){
					let { nameParts, attribute, options } = attrib;
					if(options.size===0 || nameParts.length<=1 || nameParts[0]!=='default') continue;
					nameParts = nameParts.slice(1);
					let nameKey = nameParts.join(' ');
					if(nkAliases && nameKey in nkAliases) nameKey = nkAliases[nameKey];
					let defaultAttrib = defaults.get(nameKey);
					if(!defaultAttrib) defaults.set(nameKey,defaultAttrib={ isDefault:true, attribute, nameKey, nameParts, value:null, options:new Map() });
					for(let [optKey,option] of options){
						if(!defaultAttrib.options.has(optKey)) defaultAttrib.options.set(optKey,option);
					}
				}
			}
			if(useCache && defaults.size>0) this._cacheElementAttribsDefaults.set(element,defaults);
			return defaults;
		}
		_elementAttribOptionsWithDefaults(element,attrib,useCache=true,checkConnected=true){
			let { nameKey, nameParts, options } = attrib;
			if(nameParts[0]!=='default'){
				let defaultOptions = this._elementFindDefaults(element,useCache,checkConnected);
				if(defaultOptions?.get(nameKey)?.options?.size>0) return new Map([...defaultOptions.get(nameKey).options,...options]);
			}
			return options;
		}
		_elementAttribFallbackOptionValue(attrib,whitelist=null,updateOption=true,updateAttrib=true){
			let { options, attribute, value } = attrib;
			if(whitelist instanceof Array) whitelist = new Set(whitelist);
			for(let [optionKey,opt] of options){
				if(!whitelist || whitelist?.has?.(optionKey)){
					if(!opt.isDefault && opt.value?.length>0){
						attribute = opt.attribute;
						value = opt.value;
						if(updateOption) opt.value = '';
					}
				}
			}
			if(updateAttrib){
				attrib.attribute = attribute;
				attrib.value = value;
			}
			return value;
		}
		_elementAttribParseOption(element,attribOpts,optName,parseOptions={}){
			parseOptions = Object.assign({ default:null, emptyTrue:false, runExp:false },Object(parseOptions));
			let optValue = parseOptions.default, opt = attribOpts.get(optName), isDefault = opt?.isDefault;
			if(parseOptions.emptyTrue && (opt?.value==='' || opt?.value===null)) optValue = true;
			else if(!parseOptions.runExp && opt?.value?.length>0) optValue = opt.value;
			else if(parseOptions.runExp && opt?.value?.length>0){
				let { result } = this._elementExecExp(this._elementScopeCtrl(element),opt.value,{ $attribute:opt.attribute },{ silentHas:true, useReturn:true });
				if(typeof result!==void 0) optValue = result;
			}
			return { value:optValue, raw:opt?.value, attribOption:opt, isDefault };
		}
		
		// New Scope Controller
		_elementNewScopeCtrl(element,newScope=void 0,parentScopeCtrl=this.controller,insertCache=true){
			if(parentScopeCtrl instanceof scopeElementController) parentScopeCtrl = parentScopeCtrl.ctrl;
			let scopeCtrl = new scopeController(newScope,parentScopeCtrl.eventTarget,parentScopeCtrl,false,this);
			let elementScopeCtrl = new scopeElementController(element,null,scopeCtrl);
			if(insertCache) this._cacheElementScopeCtrls.set(element,elementScopeCtrl);
			return elementScopeCtrl;
		}
		_elementNewIsolatedScopeCtrl(element,newScope=void 0,parentScopeCtrl=this.controller,insertCache=true){
			if(parentScopeCtrl instanceof scopeElementController) parentScopeCtrl = parentScopeCtrl.ctrl;
			let scopeCtrl = new scopeController(newScope,null,parentScopeCtrl,true,this);
			let elementScopeCtrl = new scopeElementController(element,null,scopeCtrl);
			if(insertCache) this._cacheElementScopeCtrls.set(element,elementScopeCtrl);
			return elementScopeCtrl;
		}
		_elementScopeSetAlias(toElement,fromElement){
			// Element Scopes
			//let fromScopeList = this._elementExtraScopes.get(fromElement);
			let toScopeList = this._elementExtraScopes.get(toElement);
			if(!toScopeList) this._elementExtraScopes.set(toElement,[fromElement]);
			else if(toScopeList.indexOf(fromElement)===-1) toScopeList.push(fromElement);
			// Isolated Scopess
			let fromIsolated = this._elementIsolatedScopes.has(fromElement);
			let toIsolated = this._elementIsolatedScopes.has(toElement);
			if(fromIsolated && !toIsolated) this._elementIsolatedScopes.add(toElement);
			// Scope Controller
			let fromScopeCtrl = this._cacheElementScopeCtrls.get(fromElement);
			let toScopeCtrl = this._cacheElementScopeCtrls.has(toElement);
			if(fromScopeCtrl && !toScopeCtrl){
				let eCtrl = new scopeElementController(toElement,void 0,fromScopeCtrl);
				this._cacheElementScopeCtrls.set(toElement,eCtrl);
			}
		}
		
		// Find Scope Controller
		_elementScopeCtrl(element,useCache=true,findParent=true,newScope=null){
			if(useCache && this._cacheElementScopeCtrls.has(element)) return this._cacheElementScopeCtrls.get(element);
			let parentCtrl = findParent ? this._elementFindParentScopeCtrl(element) : null;
			if(parentCtrl && parentCtrl.element===element) return parentCtrl;
			if(!parentCtrl && findParent) parentCtrl = this.controller;
			let ctrl = new scopeElementController(element,newScope,parentCtrl);
			if(useCache) this._cacheElementScopeCtrls.set(element,ctrl);
			return ctrl;
		}
		_elementFindParentScopeCtrl(element){
			for(let e=element; e; e=e.parentNode){
				if(!this._cacheConnectedNodes.has(e) && element.nodeType!==textNodeType) return;
				if(this._cacheElementScopeCtrls.has(e)) return this._cacheElementScopeCtrls.get(e);
			}
		}
		
		// Execute Expression on Element
		_elementExecExp(elementScopeCtrl,expression,extra=null,options={}){
			let extraScopes = extra?[extra]:[], elementScopes = this._getElementScopes(elementScopeCtrl.element);
			options = Object.assign({ globalsHide:!this._options.globalContext, hideDocument:!this._options.documentContext },Object(options));
			return elementScopeCtrl.execElementExpression(expression,extraScopes,elementScopes,options);
		}
		// Get Element Scopes [[element,scopesArr],...]
		_getElementScopes(element,eScopes=[]){
			for(let e=element; e; e=e.parentNode){
				let isolated = this._elementIsolatedScopes.has(e) ? e : null;
				if(this._elementExtraScopes.has(e)) eScopes.push([e,this._resolveElementScopes(e,isolated)]);
				if(isolated) break;
			}
			return eScopes;
		}
		_resolveElementScopes(key,isolated=null,uniqueKeys=new Set([key]),list=[]){
			let arr = this._elementExtraScopes.get(key), isolatedParent = isolated?.parentNode;
			for(let i=0,l=arr.length; i<l; i++){
				let item = arr[i];
				if(item instanceof nodeConstructor){ // Flatten
					if(isolated){
						let isChildOrSibling = false;
						for(let e=item; e; e=e.parentNode) if(e===isolated || e===isolatedParent){ isChildOrSibling=true; break; }
						if(!isChildOrSibling) continue;
					}
					if(uniqueKeys.has(item)) continue; // Prevent endless recursion
					if(!this._elementExtraScopes.has(item)) continue; // Ignore other nodes/elements in scope list
					uniqueKeys.add(item);
					list = list.concat(this._resolveElementScopes(item,isolated,uniqueKeys));
				}
				else list.push(item);
			}
			return list;
		}
		
		// Handle connect & disconnect
		_registerElementRelatedEvent(element,removeListener){
			let map = this._elementRelatedEventListeners;
			if(!map.has(element)) map.set(element,new Set());
			map.get(element).add(removeListener);
		}
		_removeElementRelatedEvents(element){
			let map = this._elementRelatedEventListeners;
			if(map.has(element)){
				let set = map.get(element);
				for(let removeListener of set) removeListener();
				map.delete(element);
			}
		}
		
		_triggerElementConnect(element){
			let attribs = this._elementAttribs(element), elementScopeCtrl, queue=[];
			if(attribs && attribs.size>0){
				elementScopeCtrl = this._elementScopeCtrl(element);
				// Swap
				if(element.nodeName==='TEMPLATE' && attribs.has('swap')){
					let anchor = document.createComment(' Template-Swap-Anchor: '+element.cloneNode(false).outerHTML+' ');
					element.parentNode.replaceChild(anchor,element);
					this.onElementLoaded(anchor,()=>{
						let swap = attribs.get('swap'), fragment=element.content, dom=fragment;
						element.removeAttribute(swap.attribute);
						if(swap?.value?.length>0){
							dom = document.createElement(swap.value);
							for(let a of element.attributes) dom.attributes.setNamedItem(a.cloneNode(false));
							dom.appendChild(fragment);
						}
						anchor.parentNode.replaceChild(dom,anchor);
					});
					return;
				}
				// Scope
				let scopeAttrib = attribs.get('scope'), scopeNamedAttrib = attribs.get('scope name');
				if(scopeAttrib || scopeNamedAttrib){
					if(scopeAttrib && scopeNamedAttrib && scopeNamedAttrib.options.size>0) scopeAttrib.options = new Map([...scopeAttrib.options,...scopeNamedAttrib.options]);
					if(!scopeAttrib) scopeAttrib = scopeNamedAttrib;
					let options = this._elementAttribOptionsWithDefaults(element,scopeAttrib);
					if(scopeAttrib.value===null) this._elementAttribFallbackOptionValue(scopeAttrib,['isolate']);
					let isolated = options.get('isolate'), { value, attribute:$attribute } = scopeAttrib; // After fallback
					let exp = value, extra = { $attribute }, expOpts = { run:true, useReturn:true };
					// Prepare Named Scope
					if(scopeNamedAttrib){
						if(scopeNamedAttrib.value?.length>0) value = scopeNamedAttrib.value;
						let name = value, ctrl = this.namedScopeControllers.get(name);
						if(!ctrl){ console.warn(`scopeDom: scopeController "${name}" doesn't exist`); return; }
						if(ctrl.element && ctrl.element!==element){ console.warn(`scopeDom: scopeController "${name}" is already in use`,{ ctrlElement:ctrl.element, newElement:element }); return; }
						ctrl.element = element;
						extra = { _ctrlFn:ctrl.fn };
						exp = `{ _ctrlFn, $scopeElement:$this }`;
					}
					// New Scope
					if(exp!==null){
						// Run new scope expression normally, with parent scope
						let { result } = this._elementExecExp(elementScopeCtrl,exp,extra,expOpts);
						result = result ? Object(result) : void 0;
						let originalScopeCtrl = elementScopeCtrl; // Use originalScopeCtrl as $scopeParent
						if(isolated) this._elementIsolatedScopes.add(element);
						if(isolated) elementScopeCtrl = this._elementNewIsolatedScopeCtrl(element,result||void 0,originalScopeCtrl,true);
						else elementScopeCtrl = this._elementNewScopeCtrl(element,result||void 0,originalScopeCtrl,true);
					}
					// Run Named Scope Controller
					if(scopeNamedAttrib){
						expOpts = Object.assign({},expOpts,{ fnThis:null, useReturn:false }); // fnThis:null sets 'this' as proxy
						exp = `((fn)=>{ this._ctrlFn=void 0; instance.handleScopeCtrlFn(this,fn); })(_ctrlFn);`;
						this._elementExecExp(elementScopeCtrl,exp,{ instance:this },expOpts);
					}
				}
				// Other built-in attribs
				for(let [attribName,attrib] of attribs){
					let { nameParts, value } = attrib;
					if(nameParts[0]==='default') continue;
					let options = this._elementAttribOptionsWithDefaults(element,attrib);
					// Init / Connect
					if(nameParts.length===1){
						let [ name ] = nameParts;
						if(name==='init' || name==='connect'){
							if(value===null) value = this._elementAttribFallbackOptionValue(attrib,['raf','instant']);
							let { attribute:$attribute } = attrib;
							let raf = options.get('raf'), instant = options.get('instant');
							if(value?.length>0){
								let { runFn:connectCB } = this._elementExecExp(elementScopeCtrl,value,{ $attribute },{ run:false });
								queue.push(function attribConnect(){
									if(raf && !isDuringRAF) onceRAF(element,$attribute,connectCB);
									else if(instant) connectCB();
									else Promise.resolve().then(connectCB);
								});
								continue;
							}
						}
					}
					// Listen for Update Scope
					// TODO: Implement Listen for Update DOM somehow
					if(nameParts.length===1 || nameParts.length===2){
						let [ type, name ] = nameParts, suffix = null;
						if(type==='update' && value===null){
							value = this._elementAttribFallbackOptionValue(attrib,['before','after']);
							if(options.get('before')) suffix=':before';
							if(options.get('after')) suffix=':after';
						}
						if(type==='update' && value?.length>0){
							let { attribute:$attribute } = attrib;
							let { runFn:updateCB } = this._elementExecExp(elementScopeCtrl,value,{ $attribute },{ run:false });
							// Register events straight away
							let evt = '$update'+(name?.length>0?'-'+name:'')+(suffix!==null?suffix:'');
							let removeListener = elementScopeCtrl.ctrl.$on(evt,()=>updateCB(),{},true);
							this._registerElementRelatedEvent(element,removeListener);
							continue;
						}
					}
					// Events
					// TODO: move event stuff to own plugin. Add all event listener options, & in-event-fn methods (prevent default, cancel propagation, return false, etc)
					if(nameParts.length===2){
						let [ type, eventName ] = nameParts;
						if(type==='on'){ nameParts = [ type,'dom',eventName ]; }
						else if(type==='once'){ nameParts = [ type,'dom',eventName ]; }
					}
					if(nameParts.length===3 && (nameParts[0]==='on' || nameParts[0]==='once')){
						let [ type, target, eventName ] = nameParts;
						let evtBase=null, evtMethod=null, evtTarget=null;
						if(type==='on' && target==='dom'){ evtBase = elementScopeCtrl; evtMethod = '$onDom'; }
						else if(type==='once' && target==='dom'){ evtBase = elementScopeCtrl; evtMethod = '$onceDom'; }
						else if(type==='on' && target==='scope'){ evtBase = elementScopeCtrl.ctrl; evtMethod = '$on'; }
						else if(type==='once' && target==='scope'){ evtBase = elementScopeCtrl.ctrl; evtMethod = '$once'; }
						else if(type==='on' && target==='window'){ evtBase = elementScopeCtrl.ctrl; evtMethod = '$onTarget'; evtTarget=window; }
						else if(type==='once' && target==='window'){ evtBase = elementScopeCtrl.ctrl; evtMethod = '$onceTarget'; evtTarget=window; }
						else if(type==='on' && target==='document'){ evtBase = elementScopeCtrl.ctrl; evtMethod = '$onTarget'; evtTarget=document; }
						else if(type==='once' && target==='document'){ evtBase = elementScopeCtrl.ctrl; evtMethod = '$onceTarget'; evtTarget=document; }
						if(evtBase && evtMethod){
							if(value===null) value = this._elementAttribFallbackOptionValue(attrib,['raf','instant','pd']);
							let { attribute:$attribute } = attrib;
							let raf = options.get('raf'), instant = options.get('instant'), pd = options.get('pd');
							if(value?.length>0){
								let self=this, { runFn:eventCB, firstScope } = this._elementExecExp(elementScopeCtrl,value,{ $attribute },{ run:false });
								function eventListener(event){
									if(pd) event.preventDefault();
									firstScope.$event = event;
									if(isDuringRAF || self._duringOnReady) eventCB();
									else if(raf) onceRAF(element,$attribute,eventCB);
									else if(instant) eventCB();
									else Promise.resolve().then(eventCB);
									if(pd) return false;
								};
								// Register events straight away
								let removeListener = evtTarget ? evtBase[evtMethod](evtTarget,eventName,eventListener,{},true) : evtBase[evtMethod](eventName,eventListener,{},true);
								this._registerElementRelatedEvent(element,removeListener);
								continue;
							}
						}
					}
				}
			}
			if(queue.length>0) this.onReady(function onReadyConnect(){ for(let cb of queue) cb.apply(this); }.bind(this),false);
			// Run plugins onConnect
			this._pluginsOnConnect(new pluginOnElementPlug(this,element,elementScopeCtrl,attribs));
		}
		
		_triggerElementDisconnect(element){
			if(!this._cacheConnectedNodes.has(element)) return;
			let attribs = this._elementAttribs(element,true,false), elementScopeCtrl;
			if(attribs && attribs.size>0){
				elementScopeCtrl = this._elementScopeCtrl(element);
				for(let [attribName,attrib] of attribs){
					let { nameParts, value, attribute:$attribute } = attrib;
					if(nameParts[0]==='default') continue;
					let options = this._elementAttribOptionsWithDefaults(element,attrib);
					if(nameParts.length===1){
						let [ name ] = nameParts;
						if(name==='deinit' || name==='disconnect'){
							if(value===null) value = this._elementAttribFallbackOptionValue(attrib,['raf','instant']);
							let { attribute:$attribute } = attrib;
							let raf = options.get('raf'), instant = options.get('instant');
							if(value?.length>0){
								let { runFn:disconnectCB } = this._elementExecExp(elementScopeCtrl,value,{ $attribute },{ run:false });
								if(raf && !isDuringRAF) requestAF(disconnectCB);
								else if(instant || isDuringRAF) disconnectCB();
								else Promise.resolve().then(disconnectCB);
								continue;
							}
						}
					}
				}
			}
			// Run plugins onDisconnect
			this._pluginsOnDisconnect(new pluginOnElementPlug(this,element,elementScopeCtrl,attribs));
			// _cleanupDisconnected is called within disconnectElement
		}
		_cleanupDisconnected(element,completely=false){
			if(this._cacheElementAttribs.has(element)) this._cacheElementAttribs.delete(element);
			if(this._cacheElementAttribsDefaults.has(element)) this._cacheElementAttribsDefaults.delete(element);
			if(this._cacheElementScopeCtrls.has(element)) this._cacheElementScopeCtrls.delete(element);
			if(this._elementExtraScopes.has(element)) this._elementExtraScopes.delete(element);
			if(this._elementIsolatedScopes.has(element)) this._elementIsolatedScopes.delete(element);
			this._removeElementRelatedEvents(element);
			this.controller.eventRegistry.remove(element);
			if(completely){
				this._cacheConnectedNodes.delete(element);
				this._pendingConnectNodes.delete(element);
			}
		}
		
		// Plugins & Middleware
		static pluginAdd(plugin){
			if(mainInstance) return mainInstance.pluginAdd(plugin);
			let listPlugins = window.scopeDomPlugins||(window.scopeDomPlugins=[]);
			if(listPlugins.indexOf(plugin)===-1) listPlugins.push(plugin);
			return true;
		}
		pluginAdd(plugin){
			let plugins=this._plugins, register=plugins.register;
			if(register.has(plugin)) return true;
			register.add(plugin);
			if(typeof plugin==='function'){ plugin=new plugin(scopeDom,this); register.add(plugin); }
			// Methods
			if(plugin.onConnect) plugins.onConnect.add(plugin.onConnect.bind(plugin));
			if(plugin.onDisconnect) plugins.onDisconnect.add(plugin.onDisconnect.bind(plugin));
			if(plugin.onPluginAdd) plugins.onPluginAdd.add(plugin.onPluginAdd.bind(plugin));
			// Late Connect
			if(plugins.init && plugin.onConnect) this._latePluginAdd_runConnect(plugin,this.mainElement,true);
			// onPluginAdd Method
			this._pluginsOnPluginAdd(plugin);
			return true;
		}
		_initPlugins(){
			if(this._plugins.init) return;
			for(let plugin of window.scopeDomPlugins||[]) this.pluginAdd(plugin);
			this._plugins.init=true; window.scopeDomPlugins=null;
		}
		_pluginsOnConnect(plugObj){
			for(let pluginOnConnect of this._plugins.onConnect) try{ pluginOnConnect(plugObj); }catch(err){ console.error(err); }
		}
		_pluginsOnDisconnect(plugObj){
			for(let pluginOnDisconnect of this._plugins.onDisconnect) try{ pluginOnDisconnect(plugObj); }catch(err){ console.error(err); }
		}
		_pluginsOnPluginAdd(plugin){
			for(let pluginOnPluginAdd of this._plugins.onPluginAdd) try{ pluginOnPluginAdd(plugin); }catch(err){ console.error(err); }
		}
		_latePluginAdd_runConnect(plugin,element,act=true,list=new Set()){
			if(!plugin || !this._plugins.init || !this._cacheConnectedNodes.has(element)) return;
			list.add(element);
			if(element.childNodes) for(let e of [...element.childNodes]) this._latePluginAdd_runConnect(plugin,e,false,list);
			if(act){
				let onConnect = plugin.onConnect.bind(plugin);
				for(let e of list){
					if(!e.isConnected) continue;
					let attribs = this._elementAttribs(e);
					if(!attribs || attribs.size===0) continue;
					try{ onConnect(new pluginOnElementPlug(this,e,this._elementScopeCtrl(e),attribs)); }catch(err){ console.error(err); }
				}
			}
		}
		
	}
	
	class pluginOnElementPlug {
		constructor(instance,element,elementScopeCtrl,attribs){
			this.instance = instance;
			this.element = element;
			this.elementScopeCtrl = elementScopeCtrl;
			this.attribs = attribs;
		}
	}
	
	class scopeExpressionContext {};
	
	class scopeInstance {
		constructor(scopeObj,scopeCtrl){
			let mainObj = this;
			// If scopeObj is a plain Object, change proto to scopeBase
			if(Object.getPrototypeOf(scopeObj)===objectProto){
				Object.setPrototypeOf(scopeObj,new scopeBase());
				mainObj = scopeObj;
			}
			// If scopeObj is something ele, change this scopeInstance proto to the scopeObj
			else Object.setPrototypeOf(this,scopeObj);
			// Add methods
			Object.defineProperties(mainObj,{
				$scopeTop:{ configurable:false, enumerable:!true, get(){ return scopeCtrl?.topCtrl?.scope||scopeCtrl?.parentCtrl?.topCtrl?.scope||scopeCtrl?.parentCtrl?.scope||scopeCtrl?.scope; } },
				$scopeParent:{ configurable:false, enumerable:!true, get(){ return scopeCtrl?.parentCtrl?.scope||scopeCtrl?.scope; } },
			});
			// Return this, or scopeObj if proto changed
			return mainObj;
		}
	};
	
	class scopeBase {
		constructor(){ return Object.create(null,{
			$scope:{ configurable:false, enumerable:!true, get(){ return this; } }
		}); }
	}
	
	const fnConstructor = Object.getPrototypeOf(noopFn).constructor, fnAsyncConstructor = Object.getPrototypeOf(noopAsyncFn).constructor;
	class execExpression {
		
		static _genFunctionCode(expression,options,fnNameSuffix){
			let { useAsync, strictMode, useReturn } = options;
			let fnName = '$sdcExp'+(fnNameSuffix?.length>0 ? "_"+fnNameSuffix.replace(/[^A-Za-z0-9]/g,'_') : '');
			let fnCode =    "with($sdcScope){let $sdcScope,arguments,constructor;";
			fnCode +=         "return"+(useAsync?"(async ":"(")+"function "+fnName+"(){"+(strictMode?"\"use strict\";":"")+(useAsync?"let $sdcCatchError;":"");
			fnCode += useReturn ? "return (\n\n"+expression+"\n\n);" : "\n\n"+expression+"\n\n";
			fnCode +=         "}).apply(this)"+(useAsync?".catch($sdcCatchError);":";");
			fnCode +=       "}";
			//if(useAsync) fnCode +=     "return (async ()=>{ let $sdcCatchError;";
			//fnCode +=                    "return "+(useAsync?"await (async ":"(")+"function "+fnName+"(){"+(strictMode?"\"use strict\";":"");
			//fnCode += useReturn ?          "return (\n\n"+expression+"\n\n);" : "\n\n"+expression+"\n\n";
			//fnCode +=                    "}).apply(this);";
			//if(useAsync) fnCode +=     "})().catch($sdcCatchError);";
			//fnCode +=                "}";
			return fnCode;
		}
		
		static _genScopes(mainScopes,extraScopes){
			if(!(extraScopes instanceof Set)) extraScopes = new Set(extraScopes);
			let setScopes = new Set();
			for(let ms of mainScopes) for(let s=ms; s && scopeAllowed(s); s=Object.getPrototypeOf(s)) setScopes.add(s);
			//return { getScopes:extraScopes.union?extraScopes.union(setScopes):new Set([...extraScopes,...setScopes]), setScopes };
			return { getScopes:extraScopes, setScopes };
		}
		
		static buildExp(expression,mainScopes,extraScopes=[],options={}){
			if(expression!==String(expression)) throw new Error("Invalid expression: "+expression);
			options = Object.assign({ useReturn:false, fnThis:null, strictMode:true, useAsync:false, silentHas:true, globalsHide:true, throwGlobals:true, run:true, scopeUseOwn:null },Object(options));
			let { fnThis, useAsync, scopeUseOwn, silentHas, globalsHide, throwGlobals } = options;
			useAsync = options.useAsync = useAsync || expression.indexOf('await')!==-1;
			let globalObj = window, globalCatch = noopFn;
			if(globalsHide && throwGlobals) globalCatch = (key)=>{ throw new Error("Expression tried to access a global variable: "+key); };
			let { getScopes, setScopes } = execExpression._genScopes(mainScopes,extraScopes);
			//console.log(extraScopes?.[0]?.['$attribute']||'',expression,{ getScopes, setScopes, extraScopes, mainScopes, scopeUseOwn });
			let proxy = new execExpressionProxy({ mainScopes, getScopes, setScopes, scopeUseOwn, silentHas, globalObj, globalsHide, globalCatch });
			let fnCode = execExpression._genFunctionCode(expression,options,proxy.$attribute);
			let fn, fnc = useAsync?fnAsyncConstructor:fnConstructor;
			let logFnError = (err)=>console.warn(`Error on Expression: ${expression}\n`,err.message,'\n',{ expression, fnCode, function:fn, mainScopes, getScopes, setScopes, result:err });
			try{ fn = (new fnc(useAsync?['$sdcScope','$sdcCatchError']:['$sdcScope'],fnCode)).bind(fnThis||proxy,proxy,logFnError); }
			catch(err){ logFnError(err); }
			let runFn = !fn ? noopFn : function $sdcExpRun(){ try{ return fn(); }catch(err){ return logFnError(err),err; } };
			//Object.freeze(fn); Object.freeze(runFn); Object.freeze(logFnError);
			return { result:null, firstScope:getScopes.values().next().value, function:fn, runFn, logFnError, getScopes, setScopes, proxy, options };
		}
		
		static runExp(expression,mainScopes,extraScopes=[],options={}){
			let exec = execExpression.buildExp(expression,mainScopes,extraScopes,options);
			let { runFn, logFnError, options:{ useAsync, run } } = exec;
			if(run===false) return exec;
			exec.result = runFn();
			if(exec.result instanceof Promise) exec.result.catch(useAsync?noopFn:logFnError);
			return exec;
		}
		
	}
	
	const frozenNullObj=Object.freeze(Object.create(null));
	class execExpressionProxy {
		// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy
		// Alternative: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/unscopables
		
		constructor(obj){
			obj = Object.assign({ mainScopes:[], getScopes:null, setScopes:null, scopeUseOwn:null, silentHas:true, globalObj:null, globalsHide:null, globalCatch:null, unscopables:frozenNullObj },Object(obj));
			if(!obj.scopeUseOwn) obj.scopeUseOwn = new WeakSet();
			//Object.freeze(obj); Object.freeze(obj.getScopes); Object.freeze(obj.setScopes);
			return new Proxy(obj,execExpressionProxy);
		}
		
		static has = function execExpHas(obj,prop){
			if(obj.silentHas) return true;
			for(let ms of obj.mainScopes) if(Object.hasOwn(ms,prop)) return Reflect.has(ms,prop);
			for(let s of obj.getScopes){
				if(obj.scopeUseOwn.has(s)){ if(Object.hasOwn(s,prop)) return Reflect.has(s,prop); }
				else if(prop in s) return Reflect.has(s,prop);
			}
			for(let ms of obj.mainScopes) if(prop in ms) return Reflect.has(ms,prop);
			if(obj.globalObj && Object.hasOwn(obj.globalObj,prop)){
				if(obj.globalsHide) return obj.globalCatch(prop), false;
				else return Reflect.has(obj.globalObj,prop);
			}
			return false;
		}
		
		static get = function execExpGet(obj,prop,receiver){
			if(prop===Symbol.unscopables) return obj.unscopables;
			for(let ms of obj.mainScopes) if(Object.hasOwn(ms,prop)) return execExpressionProxy._getResolve(ms,prop,ms);
			for(let s of obj.getScopes){
				if(obj.scopeUseOwn.has(s)){ if(Object.hasOwn(s,prop)) return execExpressionProxy._getResolve(s,prop,s); }
				else if(prop in s) return execExpressionProxy._getResolve(s,prop,s);
			}
			for(let ms of obj.mainScopes) if(prop in ms) return execExpressionProxy._getResolve(ms,prop,ms);
			if(obj.globalObj && Object.hasOwn(obj.globalObj,prop)){
				if(obj.globalsHide) return obj.globalCatch(prop), false;
				else return execExpressionProxy._getResolve(obj.globalObj,prop,obj.globalObj);
			}
			return void 0;
		}
		
		static set = function execExpSet(obj,prop,value,receiver){
			for(let s of obj.setScopes) if(Object.hasOwn(s,prop)) return execExpressionProxy._setResolve(s,prop,value,s), true;
			for(let s of obj.mainScopes) return execExpressionProxy._setResolve(s,prop,value,s), true;
			return false;
		}
		
		static getOwnPropertyDescriptor(obj,prop){
			for(let s of obj.mainScopes) if(Object.hasOwn(s,prop)) return Reflect.getOwnPropertyDescriptor(s,prop);
			for(let s of obj.getScopes) if(Object.hasOwn(s,prop)) return Reflect.getOwnPropertyDescriptor(s,prop);
			return void 0;
		}
		
		static defineProperty(obj,prop,descriptor){
			for(let s of obj.setScopes) return Reflect.defineProperty(s,prop,descriptor);
			for(let s of obj.mainScopes) return Reflect.defineProperty(s,prop,descriptor);
			return false;
		}
		
		static deleteProperty(obj,prop){
			for(let s of obj.setScopes) if(Object.hasOwn(s,prop)){ delete s[prop]; return true; }
			for(let s of obj.mainScopes) if(Object.hasOwn(s,prop)){ delete s[prop]; return true; }
			return false;
		}
		
		static ownKeys(obj){
			return Array.from(new Set(
				[obj.mainScopes,obj.getScopes].map(v=>Array.from(v)).flat(1)
				.reduce((result,item)=>result.concat(Object.keys(item)),[])
			));
		}
		
		static isExtensible(obj){
			return Array.from(obj.setScopes).length>0;
		}
		
		static _getResolve(target,propertyKey,receiver){
			let value = Reflect.get(target,propertyKey,receiver);
			return value;
		}
		
		static _setResolve(target,propertyKey,value,receiver){
			return Reflect.set(target,propertyKey,value,receiver);
		}
		
	}
	
	const scSymb = Symbol('$scopeControllerContext');
	class scopeControllerContext {
		constructor(scopeCtrl){ this[scSymb]=scopeCtrl; }
		get $scope(){ return this[scSymb].scope; };
		$update(suffix=''){ return this[scSymb].$emitScopeUpdate(suffix); };
		$off(name=null,listener=null,options=null){ return this[scSymb].$off(name,listener,options); };
		$on(name,listener,options={},returnRemove=false){ return this[scSymb].$on(name,listener,options,returnRemove); };
		$once(name,listener,options={},returnRemove=false){ return this[scSymb].$once(name,listener,options,returnRemove); };
		$emit(name,detail=null,options=null){ return this[scSymb].$emit(name,detail,options); };
		$emitRAF(name,detail=null,options=null,uniqueID=this.$attribute||'$emitRAF:scc'){ return onceRAF(this.$this||this[scSymb].scope,uniqueID+':'+name,()=>this[scSymb].$emit(name,detail,options)); };
		$onRAF(cb){ return requestAF(cb); };
		$onceRAF(cb,uniqueID=this.$attribute||'$onceRAF:scc'){ return onceRAF(this.$this||this[scSymb].scope,uniqueID,cb); };
		$offTarget(target,name=null,listener=null,options=null){ return this[scSymb].$offTarget(target,name,listener,options); };
		$onTarget(target,name,listener,options={},returnRemove=false){ return this[scSymb].$onTarget(target,name,listener,options,returnRemove); };
		$onceTarget(target,name,listener,options={},returnRemove=false){ return this[scSymb].$onceTarget(target,name,listener,options,returnRemove); };
		$emitTarget(target,name,detail=null,options=null){ return this[scSymb].$emitTarget(target,name,detail,options); };
	}
	
	class scopeController {
		
		constructor(scopeObj=new scopeBase(),eventTarget=null,parentCtrl=null,isolated=false,scopeDomInstance=null){
			if(scopeObj!==Object(scopeObj)) throw new Error("Missing scope object");
			if(parentCtrl instanceof scopeElementController) parentCtrl = parentCtrl.ctrl;
			this.scopeDomInstance = scopeDomInstance || parentCtrl?.scopeDomInstance || null;
			this.eventRegistry = new eventRegistry();
			this.eventTarget = (eventTarget && eventTarget instanceof EventTarget) ? eventTarget : new EventTarget();
			this.verbose = false;
			this.topCtrl = parentCtrl?.topCtrl || null;
			this.parentCtrl = parentCtrl || null;
			this.isolated = isolated;
			this.scope = new scopeInstance(scopeObj,this);
			this.execContext = new scopeControllerContext(this);
			this.isDuringUpdate = false;
		}
		
		$emitScopeUpdate(suffix=''){
			let evt='$update'+(suffix?.length>0?'-'+suffix:''), emitUpdate=()=>{
				if(this.isDuringUpdate) return;
				this.isDuringUpdate = true;
				this.$emit(evt+':before'); this.$emit(evt); this.$emit(evt+':after');
				this.isDuringUpdate = false;
			};
			if(isDuringRAF || this.scopeDomInstance._duringOnReady || this.isDuringUpdate){ Promise.resolve().then(emitUpdate); }
			else onceRAF(this.scope,evt,emitUpdate,true);
		}
		
		$removeEvent(name=null,listener=null,options=null){
			return this.eventRegistry.remove(this.eventTarget,name,listener,options);
		}
		
		$off(name=null,listener=null,options=null){
			return this.$removeEvent(name,listener,options);
		}
		
		$on(name,listener,options={},returnRemove=false){
			options = Object.assign({ capture:true, passive:false },Object(options));
			this.eventRegistry.add(this.eventTarget,name,listener,options);
			if(returnRemove) return this.eventRegistry.remove.bind(this.eventRegistry,this.eventTarget,name,listener,options);
		}
		
		$once(name,listener,options={},returnRemove=false){
			options = Object.assign({ capture:true, passive:false, once:true },Object(options));
			return this.$on(name,listener,options,returnRemove);
		}
		
		$emit(name,detail=null,options=null){
			options = Object.assign({ detail:detail, bubbles:false, cancelable:false, composed:true },Object(options));
			return this.eventTarget.dispatchEvent(new CustomEvent(name,options));
		}
		
		$offTarget(target,name=null,listener=null,options=null){
			return this.eventRegistry.remove(target,name,listener,options);
		}
		
		$onTarget(target,name,listener,options={},returnRemove=false){
			options = Object.assign({ capture:true, passive:false },Object(options));
			this.eventRegistry.add(target,name,listener,options);
			if(returnRemove) return this.eventRegistry.remove.bind(this.eventRegistry,target,name,listener,options);
		}
		
		$onceTarget(target,name,listener,options={},returnRemove=false){
			options = Object.assign({ capture:true, passive:false, once:true },Object(options));
			return this.$onTarget(target,name,listener,options,returnRemove);
		}
		
		$emitTarget(target,name,detail=null,options=null){
			options = Object.assign({ detail:detail, bubbles:false, cancelable:false, composed:true },Object(options));
			return target.dispatchEvent(new CustomEvent(name,options));
		}
		
	}
	
	const seSymb = Symbol('$scopeElementContext');
	class scopeElementContext {
		constructor(eScopeCtrl){ this[seSymb]=eScopeCtrl; }
		get $this(){ return this[seSymb].element; };
		get $parent(){ return (this[seSymb].element.parentNode instanceof ShadowRoot && this[seSymb].element.parentNode.host) ? this[seSymb].element.parentNode.host : this[seSymb].element.parentNode; };
		get $previous(){ return this[seSymb].element.previousElementSibling; };
		get $next(){ return this[seSymb].element.nextElementSibling; };
		get document(){ return this[seSymb].element.ownerDocument; };
		$(query){ return this[seSymb].element.ownerDocument.querySelector(query); };
		$$(query){ return this[seSymb].element.querySelector(query); };
		$offDom(name=null,listener=null,options=null){ return this[seSymb].$offDom(name,listener,options); };
		$onDom(name,listener,options={},returnRemove=false){ return this[seSymb].$onDom(name,listener,options,returnRemove); };
		$onceDom(name,listener,options={},returnRemove=false){ return this[seSymb].$onceDom(name,listener,options,returnRemove); };
		$emitDom(name,detail=null,options=null){ return this[seSymb].$emitDom(name,detail,options); };
		$emitDomRAF(name,detail=null,options=null,uniqueID=this.$attribute||'$emitDomRAF:sec'){ return onceRAF(this[seSymb].element,uniqueID+':'+name,()=>this[seSymb].$emitDom(name,detail,options)); };
	}
	
	class scopeElementController {
		
		constructor(element,scopeObj=void 0,scopeCtrl=void 0){
			if(!element) throw new Error("Missing element?");
			if(scopeCtrl instanceof scopeElementController) scopeCtrl = scopeCtrl.ctrl;
			this.element = element;
			this.ctrl = !scopeObj && scopeCtrl ? scopeCtrl : new scopeController(scopeObj,scopeCtrl?.eventTarget,scopeCtrl);
			this.scope = this.ctrl.scope;
			this.eventRegistry = this.ctrl.eventRegistry;
			this.execContext = new scopeElementContext(this);
			this.isDuringUpdateDom = false;
		}
		
		// extraScopes [{},...] elementScopes: [[element,scopesArr],...]
		execElementExpression(expression,extraScopes=null,elementScopes=null,fnOptions={}){
			let elementContext = !fnOptions.hideDocument ? this.execContext : null;
			if(!('fnThis' in fnOptions) && !fnOptions.hideDocument) fnOptions.fnThis = this.element;
			let instance = this.ctrl.scopeDomInstance;
			// Main controller scopes
			let mainScopes = [];
			for(let c=this.ctrl; c; c=c.parentCtrl){
				mainScopes.push(c.scope);
				if(c.isolated) break;
			}
			let scopeUseOwn = new WeakSet();
			// Proto list of mainScopes, to not be in otherScopes
			let msProtoList = new Set();
			for(let ms of mainScopes) for(let o=ms; o && scopeAllowed(o); o=Object.getPrototypeOf(o)) msProtoList.add(o);
			// Other scopes
			let otherScopes = new Set();
			// Add extraScopes & it's prototypes
			if(extraScopes?.length>0){
				for(let s of extraScopes) for(let o=s; o && scopeAllowed(o); o=Object.getPrototypeOf(o)){
					if(!msProtoList.has(o) && !otherScopes.has(o)){
						otherScopes.add(o);
						scopeUseOwn.add(o);
					}
				}
			}
			// Add elementScopes & it's prototypes
			if(elementScopes?.length>0) for(let [e,sArr] of elementScopes) for(let s of sArr){
				// Add element scopes
				for(let o=s; o && scopeAllowed(o); o=Object.getPrototypeOf(o)){
					if(!msProtoList.has(o) && !otherScopes.has(o)){
						otherScopes.add(o);
						scopeUseOwn.add(o);
					}
				}
				// Add element controller scopes
				let eScopeCtrl = instance?._cacheElementScopeCtrls.get(e);
				if(eScopeCtrl){
					for(let o=eScopeCtrl.scope; o && scopeAllowed(o); o=Object.getPrototypeOf(o)){
						if(!msProtoList.has(o) && !otherScopes.has(o)){
							otherScopes.add(o);
							scopeUseOwn.add(o);
						}
					}
				}
			}
			// Add current element controller context
			if(elementContext) otherScopes.add(elementContext);
			// Add current scope controller context
			if(this.ctrl.execContext) otherScopes.add(this.ctrl.execContext);
			// Run or build execExpression
			fnOptions.scopeUseOwn = scopeUseOwn;
			if(fnOptions.run!==false) return execExpression.runExp(expression,mainScopes,otherScopes,fnOptions);
			else return execExpression.buildExp(expression,mainScopes,otherScopes,fnOptions);
		}
		
		// Only called by plugins - not yet used
		$emitDomUpdate(suffix='',emitSelf=false){
			if(this.isDuringUpdateDom) return; // Ignore DOM Update during DOM Update (for same element)
			if(this.ctrl.isDuringUpdate) return; // Ignore DOM Update during Scope Update
			if(this.scopeDomInstance._duringOnReady) return; // Ignore DOM Update during On Ready
			let evt='$update'+(suffix?.length>0?'-'+suffix:''), u=void 0, emitUpdate=()=>{
				if(this.isDuringUpdateDom) return;
				this.isDuringUpdateDom = true;
				this.$emitDomChildren(evt+':before',u,u,emitSelf); this.$emitDomChildren(evt,u,u,emitSelf); this.$emitDomChildren(evt+':after',u,u,emitSelf);
				this.isDuringUpdateDom = false;
			};
			if(isDuringRAF){ Promise.resolve().then(emitUpdate); }
			else onceRAF(this.element,evt,emitUpdate,true);
		}
		
		$emitDomChildren(name,detail=null,options=null,emitSelf=false){
			options = Object.assign(Object(options),{ bubbles:false });
			let emitChildren = (e,emitSelf=false)=>{
				if(emitSelf) this.ctrl.$emitTarget(e,name,detail,options);
				if(e?.childNodes?.length>0) for(let c of [...e.childNodes]) if(c.isConnected && c.parentNode===e) emitChildren(c,true);
			};
			emitChildren(this.element,emitSelf);
		}
		
		$offDom(name=null,listener=null,options=null){
			return this.ctrl.$offTarget(this.element,name,listener,options);
		}
		
		$onDom(name,listener,options={},returnRemove=false){
			return this.ctrl.$onTarget(this.element,name,listener,options,returnRemove);
		}
		
		$onceDom(name,listener,options={},returnRemove=false){
			return this.ctrl.$onceTarget(this.element,name,listener,options,returnRemove);
		}
		
		$emitDom(name,detail=null,options=null){
			return this.ctrl.$emitTarget(this.element,name,detail,options);
		}
		
	}
	
	class eventRegistry {
		
		constructor(){
			this.map = new Map();
		}
		
		add(target,name,listener,options={}){
			let targetMap = this.map;
			if(!targetMap.has(target)) targetMap.set(target,new Map());
			let nameMap = targetMap.get(target);
			if(!nameMap.has(name)) nameMap.set(name,new Map());
			let listenerMap = nameMap.get(name);
			if(!listenerMap.has(listener)) listenerMap.set(listener,new Set());
			let optionsSet = listenerMap.get(listener);
			optionsSet.add(options);
			target.addEventListener(name,listener,options);
		}
		
		remove(target,name=null,listener=null,options=null){
			if(!this.map.has(target)) return;
			let nameMap = this.map.get(target);
			if(name===null){
				for(const [keyN,listenerMap] of nameMap) for(const [keyL,optionsSet] of listenerMap) for(const opts of optionsSet) target.removeEventListener(keyN,keyL,opts);
			}
			else if(nameMap.has(name)){
				let listenerMap = nameMap.get(name);
				if(listener===null){
					for(const [keyL,optionsSet] of listenerMap) for(const opts of optionsSet) target.removeEventListener(name,keyL,opts);
				}
				else if(listenerMap && listenerMap.has(listener)){
					let optionsSet = listenerMap.get(listener);
					if(options===null){
						for(const opts of optionsSet) target.removeEventListener(name,listener,opts);
					}
					else if(optionsSet.has(options)){
						target.removeEventListener(name,listener,options);
						optionsSet.delete(options);
					}
					if(optionsSet.size===0) listenerMap.delete(listener);
				}
				if(listenerMap && listenerMap.size===0) nameMap.delete(name);
			}
			if(nameMap.size===0) this.map.delete(target);
		}
		
	}
	
	Object.assign(scopeDom,{
		requestAF, onceRAF, promiseToRAF,
		regexMatchAll, regexExec, regexTest,
		setAttribute,
		isElementLoaded,
		scopeExpressionContext,
		scopeInstance,
		scopeBase,
		execExpression,
		execExpressionProxy,
		scopeController,
		scopeElementContext,
		scopeElementController,
		eventRegistry
	});
	window.scopeDom = scopeDom;
	
	for(let k in scopeDom) Object.freeze(scopeDom[k]);
	Object.freeze(scopeDom);
	
})();
