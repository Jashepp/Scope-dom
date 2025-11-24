
import {
	noopFn, noopAsyncFn, deferFn,
	requestAF, onceRAF, promiseToRAF, regexMatchAll, regexExec, regexTest,
	elementNodeType, commentNodeType, textNodeType,
	getPrototypeOf, getOwnPropertyDescriptor, defineProperty, hasOwn,
	objectProto, nodeProto, elementProto, functionProto, functionAsyncProto, nativeProtos, nativeConstructors,
	isNative, scopeAllowed,
	isElementLoaded, setAttribute, eventRegistry,
} from "./core/utils.js";
import {
	execExpression, execExpressionProxy,
} from "./core/exec.js";
import {
	signalController, signalObserver, defineWeakRef, signalProxy, signalInstance, resolveSignal,
} from "./core/signal.js";
import {
	scopeExpressionContext, scopeInstance, scopeBase, scopeControllerContext, scopeController, scopeElementContext, scopeElementController,
} from "./core/scope.js";


const disableDocumentDefaultView = ()=>{
	try{ defineProperty(window.document,'defaultView',{ __proto__:null,
		get(){ return console.warn("scopeDom: document.defaultView is disabled"), { __proto__:null, getComputedStyle:window.getComputedStyle.bind(window) }; }
	}); }
	catch(e){ console.warn("scopeDom: Failed to disable document.defaultView\n",e); }
}

const initDefaults = {
	attribRegexMatch: /^\$((?:[\w\d]+)(?:\-[\w\d]+)*?)(?:\:((?:[\w\d]+)(?:\-[\w\d]+)*?))?$/, // group1: name, group2: option
	attribRegexParts: /([\w\d]+)/g,
	attribIgnore: '$ignore',
	globalContext: true,
	documentContext: true,
	documentDefaultView: false,
	scope: null,
	attributeAliases: null,
	attributeAliasNameKeys: null,
	autoReady: true,
	element: null,
	once: true, // Prevent further scopeDom instances
	signalDefer: true,
	signalProxyAll: false,
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
		this._options = options = { __proto__:null, ...initDefaults, ...options };
		Object.freeze(this._options);
		if(options.once) singleInstance = this;
		if(!options.globalContext && options.documentContext && !options.documentDefaultView && window.document) disableDocumentDefaultView();
		else if(options.globalContext && !options.documentContext) throw new Error("scopeDom: For documentContext to be false, globalContext must also be false");
		let scope = options.scope===Object(options.scope) ? options.scope : new scopeBase();
		if(!hasOwn(scope,'$scope')) defineProperty(scope,'$scope',{ __proto__:null, get(){ return this; } });
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
			mutObs.observe(document.head.parentNode,{ __proto__:null, subtree:false, childList:true, attributes:false });
		}
	}
	
	// Scope Handling
	scopeController(name,fn){
		if(typeof name==="function") return this.scopeController(null,name);
		if(name===null || name===false || name===void 0) name = null;
		if(fn===null || fn===false || fn===void 0) fn = null;
		if(name===null && fn===null){ // Disable/Empty default scopeController
			this.namedScopeControllers.set(null,{ __proto__:null, element:null, name, fn });
			return;
		}
		if(!(typeof fn==="function")) throw new Error("scopeDom: scopeController params must be (name,function) or (function)");
		if(name!==null) name = ''+name;
		if(this.namedScopeControllers.has(name)) throw new Error(`scopeDom: scopeController ${name===null?'default':`"${name}"`} already exists`);
		let ctrl = { __proto__:null, element:null, name, fn };
		this.namedScopeControllers.set(name,ctrl);
		// Default Controller
		if(name===null){
			let scope = this.controller.scope;
			let setScopes=new Set(); for(let s=scope; s && s!==Object; s=getPrototypeOf(s)) setScopes.add(s); 
			let proxy = new execExpressionProxy({ __proto__:null, mainScopes:[scope], getScopes:new Set([this.controller.execContext,scope]), setScopes, silentHas:false });
			return this.handleScopeCtrlFn(proxy,fn);
		}
	}
	handleScopeCtrlFn(proxy,fn){
		let signal = this.controller.$signal.bind(this.controller); // signal(value) : [get,set,signal]
		let signalCtrl = this.controller.signalCtrl, signalMethods = Object.fromEntries(
			['createSignal','defineSignal','assignSignals','computeSignal','proxySignal','defineProxySignal']
			.map(k=>[k,signalCtrl[k].bind(signalCtrl)])
		);
		return fn.apply(proxy,[{ scope:proxy, instance:this, controller:this.controller, signal, ...signalMethods }]);
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
		this._checkPendingConnectElements();
		if(this._onReadyListeners){
			let list = this._onReadyListeners.values();
			this._onReadyListeners = null;
			this._duringOnReady = true;
			for(const cb of list) try{ cb(); }catch(err){ console.error(err); }
			this.controller.$emit("$update");
			deferFn(()=>{ this._duringOnReady=false; });
		}
		if(this._onDOMReadyListeners && domComplete){
			let list = this._onDOMReadyListeners.values();
			this._onDOMReadyListeners = null;
			for(const cb of list) try{ cb(); }catch(err){ console.error(err); }
		}
	}
	onReady(cb,delay=true){
		if(this._onReadyListeners) this._onReadyListeners.add(cb);
		else if(delay) deferFn(cb);
		else cb();
	}
	onDOMReady(cb,delay=true){
		if(this._onDOMReadyListeners) this._onDOMReadyListeners.add(cb);
		else if(delay) deferFn(cb);
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
			if(rawAliases && hasOwn(rawAliases,aName)) aName = rawAliases[aName];
			let [ _, nameFull, optionFull ] = regexExec(aName,this._options.attribRegexMatch) || [];
			if(nameFull===void 0 || nameFull.length===0) continue;
			let nameParts = this.__regexMatchAllFirstGroup(nameFull,this._options.attribRegexParts);
			if(nameParts.length<=0) continue;
			if(value?.length===0) value = null;
			let isDefault = nameParts[0]==='default';
			let nameKey = nameParts.join(' ');
			if(nkAliases && hasOwn(nkAliases,nameKey)) nameKey = nkAliases[nameKey];
			let attrib = attribs.get(nameKey);
			if(!attrib) attribs.set(nameKey,attrib={ __proto__:null, isDefault, attribute:aName, nameKey, nameParts, value:null, options:new Map() });
			if(optionFull!==void 0 && optionFull.length>0){
				let optionParts = this.__regexMatchAllFirstGroup(optionFull,this._options.attribRegexParts);
				let optionKey = optionParts.join(' ');
				attrib.options.set(optionKey,{ __proto__:null, isDefault, attribute:aName, nameKey:optionKey, optionParts, value });
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
				if(nkAliases && hasOwn(nkAliases,nameKey)) nameKey = nkAliases[nameKey];
				let defaultAttrib = defaults.get(nameKey);
				if(!defaultAttrib) defaults.set(nameKey,defaultAttrib={ __proto__:null, isDefault:true, attribute, nameKey, nameParts, value:null, options:new Map() });
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
		parseOptions = { __proto__:null, default:null, emptyTrue:false, runExp:false, ...parseOptions };
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
		let { globalContext, documentContext, signalProxyAll } = this._options;
		options = { __proto__:null, globalsHide:!globalContext, hideDocument:!documentContext, useSignalProxy:!!signalProxyAll, ...options };
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
			if(item instanceof nodeProto.constructor){ // Flatten
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
				let exp = value, extra = { __proto__:null, $attribute }, expOpts = { __proto__:null, run:true, useReturn:true };
				// Prepare Named Scope
				if(scopeNamedAttrib){
					if(scopeNamedAttrib.value?.length>0) value = scopeNamedAttrib.value;
					let name = value, ctrl = this.namedScopeControllers.get(name);
					if(!ctrl){ console.warn(`scopeDom: scopeController "${name}" doesn't exist`); return; }
					if(ctrl.element && ctrl.element!==element){ console.warn(`scopeDom: scopeController "${name}" is already in use`,{ ctrlElement:ctrl.element, newElement:element }); return; }
					ctrl.element = element;
					extra = { __proto__:null, _ctrlFn:ctrl.fn };
					exp = `{ __proto__:null, _ctrlFn, $scopeElement:$this }`;
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
					expOpts = { __proto__:null, ...expOpts, fnThis:null, useReturn:false }; // fnThis:null sets 'this' as proxy
					exp = `((fn)=>{ this._ctrlFn=void 0; instance.handleScopeCtrlFn(this,fn); })(_ctrlFn);`;
					this._elementExecExp(elementScopeCtrl,exp,{ __proto__:null, instance:this },expOpts);
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
							let { runFn:connectCB } = this._elementExecExp(elementScopeCtrl,value,{ __proto__:null, $attribute },{ __proto__:null, run:false });
							queue.push(function attribConnect(){
								if(raf && !isDuringRAF) onceRAF(element,$attribute,connectCB);
								else if(instant) connectCB();
								else deferFn(connectCB);
							});
							continue;
						}
					}
				}
				// Listen for Update Scope
				if(nameParts.length===1 || nameParts.length===2){
					let [ type, name ] = nameParts, suffix = null;
					if(type==='update' && value===null){
						value = this._elementAttribFallbackOptionValue(attrib,['before','after']);
						if(options.get('before')) suffix=':before';
						if(options.get('after')) suffix=':after';
					}
					if(type==='update' && value?.length>0){
						let { attribute:$attribute } = attrib;
						let { runFn:updateCB } = this._elementExecExp(elementScopeCtrl,value,{ __proto__:null, $attribute },{ __proto__:null, run:false });
						// Register events straight away
						let evt = '$update'+(name?.length>0?'-'+name:'')+(suffix!==null?suffix:'');
						let removeListener = elementScopeCtrl.ctrl.$on(evt,()=>updateCB(),{},true);
						this._registerElementRelatedEvent(element,removeListener);
						continue;
					}
				}
				// Events
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
							let self=this, { runFn:eventCB, firstScope } = this._elementExecExp(elementScopeCtrl,value,{ __proto__:null, $attribute },{ __proto__:null, run:false });
							function eventListener(event){
								if(pd) event.preventDefault();
								firstScope.$event = event;
								if(isDuringRAF || self._duringOnReady) eventCB();
								else if(raf) onceRAF(element,$attribute,eventCB);
								else if(instant) eventCB();
								else deferFn(eventCB);
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
							let { runFn:disconnectCB } = this._elementExecExp(elementScopeCtrl,value,{ __proto__:null, $attribute },{ __proto__:null, run:false });
							if(raf && !isDuringRAF) requestAF(disconnectCB);
							else if(instant || isDuringRAF) disconnectCB();
							else deferFn(disconnectCB);
							continue;
						}
					}
				}
			}
		}
		// Run plugins onDisconnect
		this._pluginsOnDisconnect(new pluginOnElementPlug(this,element,elementScopeCtrl,attribs));
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
	signalController,
	signalObserver,
	signalProxy,
	signalInstance,
	resolveSignal,
	scopeController,
	scopeElementContext,
	scopeElementController,
	eventRegistry
});
export default scopeDom;
