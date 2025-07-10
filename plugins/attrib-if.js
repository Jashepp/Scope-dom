"use strict";

(function addPluginIf(pluginFn){
	window?.scopeDom?.pluginAdd?.(pluginFn()) || (window.scopeDomPlugins||(window.scopeDomPlugins=[]))?.push(pluginFn());
})(function initPluginIf(){
	
	const textNodeType = document.TEXT_NODE;
	
	return class pluginIf {
		get name(){ return 'if'; }
		
		constructor(scopeDom,instance){
			this.scopeDom = scopeDom;
			this.instance = instance;
			this.isElementLoaded = scopeDom.isElementLoaded;
			this.eventMap = new WeakMap(); // element, set (removeEvent cb)
			this.stateMap = new WeakMap(); // element, state
		}
		
		onConnect(plugInfo){
			let { instance, isElementLoaded } = this;
			let { element, attribs } = plugInfo;
			if(!element.isConnected) return;
			if(element.nodeName==='TEMPLATE' && !isElementLoaded(element)){ instance.onElementLoaded(element,this.onConnect.bind(this,plugInfo)); return; }
			let ifAttrib, ifElseAttrib, repeatAttrib, buildAttrib;
			if(attribs?.size>0) for(let [attribName,attrib] of attribs){
				let { nameParts, nameKey, isDefault } = attrib;
				if(nameKey==='if') ifAttrib = attrib;
				else if(nameKey==='if else') ifElseAttrib = attrib;
				else if(nameKey==='repeat') repeatAttrib = attrib;
				else if(nameKey==='build') buildAttrib = attrib;
			}
			if(repeatAttrib && (ifAttrib || ifElseAttrib) && element.nodeName==='TEMPLATE') this._moveAttrib(plugInfo,repeatAttrib,'default repeat');
			if(buildAttrib && (ifAttrib || ifElseAttrib) && element.nodeName==='TEMPLATE') this._moveAttrib(plugInfo,buildAttrib,'default build');
			if(ifAttrib && ifElseAttrib){
				if(ifElseAttrib.options.size>0) ifAttrib.options = new Map([...ifAttrib.options,...ifElseAttrib.options]);
				if(ifAttrib.value?.length>0 && ifElseAttrib.value?.length>0) console.warn("pluginIf: Found both "+ifElseAttrib.attribute+" and "+ifAttrib.attribute+", ignoring the if's value.");
				ifAttrib.attribute = ifElseAttrib.attribute;
				ifAttrib.nameParts = ifElseAttrib.nameParts;
				ifAttrib.value = ifElseAttrib.value;
			}
			if(ifAttrib || ifElseAttrib) this._setupIf(plugInfo,ifAttrib||ifElseAttrib);
		}
		
		_moveAttrib(plugInfo,targetAttrib,defaultAttribName){
			let { element, attribs } = plugInfo;
			if(targetAttrib.$pluginIfMoved) return;
			targetAttrib.$pluginIfMoved = true;
			// Move template->nodes to template->template->nodes
			element.parentNode.insertBefore(document.createComment(' If-Move: '+element.cloneNode(false).outerHTML+' '),element);
			let template = document.createElement('template');
			template.content.appendChild(element.content.cloneNode(true));
			for(let e of [...element.content.childNodes]) element.content.removeChild(e);
			element.content.appendChild(template);
			// Move attribs to inner template
			element.removeAttribute(targetAttrib.attribute);
			if(targetAttrib.value!==null) this.scopeDom.setAttribute(template,targetAttrib.attribute,targetAttrib.value);
			for(let [n,opt] of targetAttrib.options){
				if(opt.attribute) element.removeAttribute(opt.attribute);
				if(opt.attribute && !opt.isDefault && opt.value!==null) this.scopeDom.setAttribute(template,opt.attribute,opt.value);
			}
			if(attribs.has(defaultAttribName)){
				let defaultRepeat = attribs.get(defaultAttribName);
				if(defaultRepeat.value!==null) this.scopeDom.setAttribute(template,defaultRepeat.attribute,defaultRepeat.value);
				for(let [n,opt] of defaultRepeat.options){
					if(opt.attribute) element.removeAttribute(opt.attribute);
					if(opt.attribute && opt.value!==null && !template.hasAttribute(opt.attribute)) this.scopeDom.setAttribute(template,opt.attribute,opt.value);
				}
			}
		}
		
		onDisconnect(plugInfo,fakeDC=false){
			let { element, elementScopeCtrl, attribs } = plugInfo;
			// Get State
			let state = this.stateMap.get(element);
			if(!state) return;
			let removeState=true, removeEvents=true;
			let { anchor, defaultDisplay, isTemplate, tplAnchorStart, tplAnchorEnd } = state;
			let anchorDC = (element===anchor || element===tplAnchorStart || element===tplAnchorEnd);
			if(anchorDC) element = state.element;
			let ranOnce = this._hasRanOnce(state);
			if(!isTemplate){
				// Anchor disconnect
				if(!ranOnce && anchorDC && element.isConnected) return;
				// DOM mode: only anchor is connected, keep state & events
				if(!ranOnce && !element.isConnected && anchor && anchor.isConnected) return;
				// DOM & Style mode: ran only once
				if(ranOnce){
					if(anchor && anchor.$pluginIfElement){
						anchor.data = ' (Removed)'+anchor.data;
						anchor.$pluginIfElement = null;
					}
					if(!fakeDC && defaultDisplay!==null){
						element.style.display = defaultDisplay;
					}
				}
				// DOM & Style mode: If element is not connected, with style
				if(!element.isConnected && defaultDisplay!==null){
					element.style.display = defaultDisplay;
				}
				// DOM mode: If element & anchor is not connected (disconnected by something else)
				if(!element.isConnected && anchor && !anchor.isConnected){
					if(anchor.parentNode || anchor.previousSibling || anchor.nextSibling) anchor.replaceWith(element);
				}
			}
			// Template mode
			if(isTemplate && !element.isConnected){
				if(tplAnchorStart && tplAnchorEnd){
					if(tplAnchorStart.parentNode && tplAnchorEnd.parentNode && tplAnchorStart.parentNode===tplAnchorEnd.parentNode){
						let endAfterStart = false;
						for(let e=tplAnchorStart.nextSibling; e; e=e.nextSibling) if(e===tplAnchorEnd){ endAfterStart=true; break; }
						if(endAfterStart) for(let e=tplAnchorStart.nextSibling; e && e!==tplAnchorEnd; e=e.nextSibling) e.remove();
					}
					else if(state.tplNodes) for(let n of state.tplNodes) n.parentNode?.removeChild(n);
					tplAnchorStart.parentNode?.removeChild(tplAnchorStart);
					tplAnchorEnd.parentNode?.removeChild(tplAnchorEnd);
					anchor?.parentNode?.removeChild(anchor);
				}
				state.tplNodes = state.tplAnchorStart = state.tplAnchorEnd = state.tplDefaultDisplay = null;
			}
			// Skip rest if main element is connected
			if(element.isConnected) removeState = removeEvents = false;
			// Remove State
			if(removeState){
				if(this.stateMap.has(element)) this.stateMap.delete(element);
				if(anchor && this.stateMap.has(anchor)) this.stateMap.delete(anchor);
				if(tplAnchorStart && this.stateMap.has(tplAnchorStart)) this.stateMap.delete(tplAnchorStart);
				if(tplAnchorEnd && this.stateMap.has(tplAnchorEnd)) this.stateMap.delete(tplAnchorEnd);
			}
			// Remove event listeners - for element
			if(removeEvents && this.eventMap.has(element)){
				let set = this.eventMap.get(element);
				for(let removeEvent of set) removeEvent();
				this.eventMap.delete(element);
			}
		}
		
		_setupIf(plugInfo,attrib){
			let { instance } = this;
			let { element, elementScopeCtrl, attribs } = plugInfo;
			let { isDefault, attribute, nameKey, nameParts, value } = attrib;
			let isTemplate = (element.nodeName==='TEMPLATE');
			// Skip when existing state
			if(this.stateMap.has(element)) return;
			// Skip empty template
			if(isTemplate && !(element.content?.childNodes?.length>0)) return console.warn("pluginIf: template has no content");
			// Setup Options
			let attribOpts = instance._elementAttribOptionsWithDefaults(element,attrib);
			let typeIf = (nameParts.length===1 && nameParts[0]==='if'), typeElseIf = (nameParts.length===2 && nameParts[0]==='if' && nameParts[1]==='else'), typeElse = false;
			// Fallback value
			if(value===null) value = instance._elementAttribFallbackOptionValue(attrib,['once','dom']);
			// Options
			let onlyOnce = this._getAttribOption(plugInfo,attrib,attribOpts,'once',false,true,true); // $if:once
			let domRemove = this._getAttribOption(plugInfo,attrib,attribOpts,'dom',false,true,true); // $if:dom or  $if:dom='exp' - same as $if='exp' $if:dom
			//let domOnce = this._getAttribOption(plugInfo,attrib,attribOpts,'dom once',false,true,true); // $if:dom-once (both onlyOnce and domRemove)
			let updateEvent = this._getAttribOption(plugInfo,attrib,attribOpts,'update scope','$update',false,true).value; // $if:update-scope='event', $emit('event')
			let updateDomEvent = this._getAttribOption(plugInfo,attrib,attribOpts,'update dom','$update',false,true).value; // $if:update-dom='event', $emitDom('event')
			let onShowEvent = this._getAttribOption(plugInfo,attrib,attribOpts,'on show',null,false,false).value; // $if:on-show='exp'
			let onHideEvent = this._getAttribOption(plugInfo,attrib,attribOpts,'on hide',null,false,false).value; // $if:on-hide='exp'
			let defaultValue = !!this._getAttribOption(plugInfo,attrib,attribOpts,'default',false,false,true).value; // $if:default='true'
			// If-else
			if(typeElseIf && (value===null || value.length===0)){ value=null; typeElseIf=false; typeElse=true; }
			if((typeIf || typeElseIf) && (value===null || value.length===0)){ console.warn("pluginIf: Found "+attribute+" but there's no if='expression'",element,value); return; }
			//if((typeElseIf || typeElse) && (onlyOnce && onlyOnce.value===true)){ console.warn("pluginIf: Once cannot be used with if-else,",attribute,element); onlyOnce={ value:false }; }
			// State
			onlyOnce=(onlyOnce.value===true); domRemove=(domRemove.value===true); //domOnce=(domOnce.value===true);
			let state = {
				element, typeIf, typeElseIf, typeElse, depList:null,
				options:{ onlyOnce, domRemove, onShowEvent, onHideEvent, defaultValue },
				showing:null, exec:null, anchor:null, defaultDisplay:null, onShowExec:null, onHideExec:null, updateIndex:0,
				isTemplate, tplNodes:null, tplAnchorStart:null, tplAnchorEnd:null, tplDefaultDisplay:null,
			};
			if(!this.stateMap.has(element)) this.stateMap.set(element,state);
			// Trigger Exec
			let triggerExec = this._runIfExpressions.bind(this,plugInfo,attrib,state,value);
			// Add $if() to element & element context
			elementScopeCtrl.execContext.$if = element.$if = triggerExec;
			// Register Events
			if(updateEvent?.length>0) this._registerEvent(element,elementScopeCtrl.ctrl.$on(updateEvent,triggerExec,{ capture:false, passive:true },true));
			if(updateDomEvent?.length>0) this._registerEvent(element,elementScopeCtrl.$onDom(updateDomEvent,triggerExec,{ capture:true, passive:true },true));
			// Continue when ready
			instance.onReady(function onReadyPluginIf(){
				this._runIfExpressions(plugInfo,attrib,state,value);
			}.bind(this),false);
		}
		
		_registerEvent(element,removeEvent){
			if(!this.eventMap.has(element)) this.eventMap.set(element,new Set());
			this.eventMap.get(element).add(removeEvent);
		}
		_getAttribOption(plugInfo,attrib,attribOpts,optName,defaultValue=null,trueOnEmpty=false,runExp=false){
			let { instance } = this;
			let { elementScopeCtrl } = plugInfo;
			let { isDefault, attribute, nameKey, nameParts, value } = attrib;
			let optValue = defaultValue, opt = attribOpts.get(optName)
			if(trueOnEmpty && (opt?.value==='' || opt?.value===null)) optValue = true;
			else if(runExp && opt?.value?.length>0){
				let { result } = instance._elementExecExp(elementScopeCtrl,opt.value,null,{ silentHas:true, useReturn:true });
				if(typeof result!==void 0) optValue = result;
				//else { console.warn('pluginIf: invalid result, expecting string,',result,attribOpts.get(optName)?.attribute,element); return false; }
			}
			else if(!runExp && opt?.value?.length>0) optValue = opt.value;
			return { value:optValue, raw:opt?.value, attribOption:opt, isDefault };
		}
		
		_hasRanOnce(state){
			let { exec, anchor, defaultDisplay, options:{ onlyOnce, domRemove } } = state;
			return (onlyOnce && exec);
			//return (onlyOnce && exec) && ((domRemove && anchor) || (!domRemove && defaultDisplay!==null));
		}
		_execExpression(plugInfo,exp,useReturn=true){
			return this.instance._elementExecExp(plugInfo.elementScopeCtrl,exp,{ $expression:exp },{ silentHas:true, useReturn, run:false });
		}
		_runIfExpressions(plugInfo,attrib,state,exp){
			let { instance, isElementLoaded } = this;
			let { element, elementScopeCtrl, attribs } = plugInfo;
			let { typeIf, typeElseIf, typeElse, options, depList, showing:wasShowing, exec, anchor, updateIndex, isTemplate } = state;
			let { onShowEvent, onHideEvent } = options;
			let nowShowing = null;
			if(!this.stateMap.has(element)) return;
			// Only Once Check
			if(this._hasRanOnce(state)) return;
			// ElseIf & Else
			if(nowShowing===null && (typeElseIf || typeElse)){
				if(!depList){
					depList = new Set();
					// Build list of dependant if states
					for(let e=element.previousSibling; e; e=e.previousSibling){
						let isEl=e instanceof Element, eState=this.stateMap.get(e);
						if(!eState && !isEl) continue;
						if(!eState && isEl) break;
						if(eState){
							if(eState.typeElse) break;
							depList.add(eState);
							if(eState.typeIf) break;
							if(e===eState.tplAnchorEnd) e = eState.tplAnchorStart;
						}
					}
					state.depList = depList;
				}
				// Check if states
				for(let s of depList) if(s.exec && s.showing){ nowShowing=false; break; }
				if(typeElse && nowShowing===null){ nowShowing = true; }
			}
			// Build Exec for On Show / On Hide
			if(onShowEvent?.length>0 && !state.onShowExec) state.onShowExec = this._execExpression(plugInfo,onShowEvent,false);
			if(onHideEvent?.length>0 && !state.onHideExec) state.onHideExec = this._execExpression(plugInfo,onHideEvent,false);
			// Build / Run Expression
			if(nowShowing===null){
				if(!exec) state.exec = exec = this._execExpression(plugInfo,exp);
				nowShowing = element.$ifResult = exec.runFn();
			}
			// Handle fallback when Promise on first update
			if(wasShowing===null && nowShowing instanceof Promise){
				if(isTemplate) this._handleTemplateIfResult(plugInfo,attrib,state,exp,updateIndex,state.defaultValue);
				else this._handleRegularIfResult(plugInfo,attrib,state,exp,updateIndex,state.defaultValue);
				updateIndex = state.updateIndex;
			}
			// Handle Result
			if(isTemplate){
				if(nowShowing instanceof Promise) this.scopeDom.promiseToRAF(nowShowing,this._handleTemplateIfResult.bind(this,plugInfo,attrib,state,exp,updateIndex));
				else this._handleTemplateIfResult(plugInfo,attrib,state,exp,updateIndex,nowShowing);
			}
			else {
				if(nowShowing instanceof Promise) this.scopeDom.promiseToRAF(nowShowing,this._handleRegularIfResult.bind(this,plugInfo,attrib,state,exp,updateIndex));
				else this._handleRegularIfResult(plugInfo,attrib,state,exp,updateIndex,nowShowing);
			}
		}
		
		_handleRegularIfResult(plugInfo,attrib,state,exp,callUpdateIndex,nowShowing){
			let { instance, isElementLoaded } = this;
			let { element } = plugInfo;
			let { attribute } = attrib;
			let { showing:wasShowing, options, anchor, defaultDisplay, onShowExec, onHideExec, updateIndex } = state;
			let { domRemove } = options;
			// Ignore old calls
			if(updateIndex>callUpdateIndex) return;
			state.updateIndex++;
			// Update state
			state.showing = nowShowing = !!nowShowing;
			element.$ifResult = nowShowing;
			// Has result changed
			let differentResult = (wasShowing===null || wasShowing!==nowShowing);
			// While element isn't loaded, fallback to style.display
			if(domRemove && !nowShowing && !isElementLoaded(element)){
				instance.onElementLoaded(element,this._runIfExpressions.bind(this,plugInfo,attrib,state,exp));
				domRemove = false;
			}
			// Remove/Restore DOM
			if(domRemove){
				if(defaultDisplay!==null){ element.style.display=defaultDisplay; defaultDisplay=null; }
				// Check Anchor
				if(!anchor){
					state.anchor = anchor = document.createComment(' If-Anchor: '+element.cloneNode(false).outerHTML+' ');
				}
				if(anchor && !nowShowing){
					this.stateMap.set(anchor,state);
					this.instance._cacheConnectedNodes.add(anchor);
				}
				// Show
				if(differentResult && nowShowing){
					if(anchor.isConnected){
						instance._elementScopeSetAlias(element,anchor);
						anchor.replaceWith(element);
					}
					if(onShowExec) onShowExec.runFn();
					//Promise.resolve().then(()=>{ if(element.isConnected) elementScopeCtrl.$emitDom('ifshow'); });
				}
				// Hide
				if(differentResult && !nowShowing){
					if(!anchor.$pluginIfElement) anchor.$pluginIfElement = element;
					if(element.isConnected){
						instance._elementScopeSetAlias(anchor,element);
						element.replaceWith(anchor);
					}
					if(onHideExec) onHideExec.runFn();
					//elementScopeCtrl.$emitDom('ifhide');
				}
			}
			// Change style.display
			else {
				if(defaultDisplay===null) state.defaultDisplay = defaultDisplay = element.style.display||''; //window.getComputedStyle(element).getPropertyValue('display') || '';
				if(differentResult && nowShowing){
					element.style.display = defaultDisplay;
					if(onShowExec) onShowExec.runFn();
					//elementScopeCtrl.$emitDom('ifshow');
				}
				if(differentResult && !nowShowing){
					//element.style.display = 'none';
					element.style.setProperty('display','none','important');
					if(onHideExec) onHideExec.runFn();
					//elementScopeCtrl.$emitDom('ifhide');
				}
			}
			// If Once Option
			// if(this._hasRanOnce(state)) this.onDisconnect(plugInfo,true);
		}
		
		_handleTemplateIfResult(plugInfo,attrib,state,exp,callUpdateIndex,nowShowing){
			let { instance, isElementLoaded } = this;
			let { element } = plugInfo;
			let { attribute } = attrib;
			let { showing:wasShowing, options, onShowExec, onHideExec } = state;
			let { tplNodes, tplAnchorStart, tplAnchorEnd, tplDefaultDisplay, updateIndex } = state;
			let { domRemove } = options;
			// Ignore old calls
			if(updateIndex>callUpdateIndex) return;
			state.updateIndex++;
			// Update state
			state.showing = nowShowing = !!nowShowing;
			element.$ifResult = nowShowing;
			// Has result changed
			let actionResult = (wasShowing===null || wasShowing!==nowShowing);
			// Don't run while element isn't loaded
			if(!isElementLoaded(element)){ instance.onElementLoaded(element,this._runIfExpressions.bind(this,plugInfo,attrib,state,exp)); return; }
			// Create Anchors
			if(!tplAnchorStart || !tplAnchorEnd){
				tplAnchorStart = state.tplAnchorStart = state.tplAnchorStart||document.createComment(' If-Start-Anchor: '+element.nodeName+' '+attribute+' '+(exp?.length>0?exp+' ':''));
				tplAnchorEnd = state.tplAnchorEnd = state.tplAnchorEnd||document.createComment(' If-End-Anchor ');
				state.anchor = tplAnchorEnd; // alias, but dont add to stateMap
				this.stateMap.set(tplAnchorStart,state);
				this.stateMap.set(tplAnchorEnd,state);
				actionResult = true;
			}
			// Check DOM structure
			if(tplAnchorStart.parentNode || tplAnchorEnd.parentNode){
				let correctDOM = false;
				if(tplAnchorStart.parentNode===element.parentNode && tplAnchorStart.parentNode===tplAnchorEnd.parentNode){
					for(let e=tplAnchorStart.nextSibling; e; e=e.nextSibling) if(e===tplAnchorEnd){ correctDOM=true; break; }
				}
				if(!correctDOM){
					console.warn("pluginIf: DOM has been externally modified, correcting DOM structure",element);
					actionResult = true;
					// Re-Insert Anchors
					element.parentNode.insertBefore(tplAnchorEnd,element.nextSibling);
					tplAnchorEnd.parentNode.insertBefore(tplAnchorStart,tplAnchorEnd);
					// Re-Insert Nodes
					if(tplNodes?.size>0){
						let docFragment = document.createDocumentFragment();
						for(let n of tplNodes) docFragment.appendChild(n);
						tplAnchorEnd.parentNode.insertBefore(docFragment,tplAnchorEnd);
					}
				}
			}
			// On Hide, Save existing DOM nodes
			let hasDirectTextNodes = false;
			if((actionResult && !nowShowing) && tplAnchorStart.parentNode && tplAnchorEnd.parentNode){
				let nodes = new Set();
				for(let e=tplAnchorStart.nextSibling; e && e!==tplAnchorEnd; e=e.nextSibling){
					if(!domRemove && e.nodeType===textNodeType) hasDirectTextNodes = true;
					nodes.add(e);
				}
				tplNodes = state.tplNodes = nodes;
			}
			// On Show, Create nodes from template
			if((actionResult && nowShowing) && (!tplNodes || tplNodes.size===0)){
				if(!tplNodes) tplNodes = state.tplNodes = new Set();
				for(let n of [...element.content.cloneNode(true).childNodes]){
					tplNodes.add(n);
					instance._elementScopeSetAlias(n,element);
				}
			}
			// Setup tplDefaultDisplay
			if(!tplDefaultDisplay) tplDefaultDisplay = state.tplDefaultDisplay = new WeakMap(); // node -> defaultDisplay
			// Prevent direct textNodes on style display mode
			if(!domRemove && hasDirectTextNodes){
				console.warn("pluginIf: Converting to if:dom to hide textNodes",element);
				for(let n of tplNodes) if(n.style) n.style.display = tplDefaultDisplay.get(n) || '';
				domRemove = options.domRemove = true;
			}
			// Remove/Insert DOM
			if(domRemove){
				// Hide
				if(actionResult && !nowShowing){
					// Remove Nodes
					if(tplNodes?.size>0) for(let n of tplNodes) n.remove();
					// Remove Anchors
					tplAnchorStart.parentNode?.removeChild(tplAnchorStart);
					tplAnchorEnd.parentNode?.removeChild(tplAnchorEnd);
					// Callback on-hide
					if(onHideExec) onHideExec.runFn();
				}
				// Show
				if(actionResult && nowShowing){
					// Insert Anchors
					element.parentNode.insertBefore(tplAnchorEnd,element.nextSibling);
					tplAnchorEnd.parentNode.insertBefore(tplAnchorStart,tplAnchorEnd);
					// Insert Nodes
					let docFragment = document.createDocumentFragment();
					for(let n of tplNodes){
						instance._elementScopeSetAlias(n,element);
						docFragment.appendChild(n);
					}
					tplAnchorEnd.parentNode.insertBefore(docFragment,tplAnchorEnd);
					// Callback on-show
					if(onShowExec) onShowExec.runFn();
				}
			}
			// Hide/Show style display
			if(!domRemove){
				// Hide
				if(actionResult && !nowShowing){
					if(tplNodes?.size>0) for(let n of tplNodes){
						if(!n.style) continue;
						if(!tplDefaultDisplay.has(n)) tplDefaultDisplay.set(n,n.style.display||'');
						//n.style.display = 'none';
						n.style.setProperty('display','none','important');
					}
					if(onHideExec) onHideExec.runFn();
				}
				// Show
				if(actionResult && nowShowing){
					// If anchor isn't connected, insert anchors & nodes
					if(!tplAnchorStart.parentNode){
						// Insert Anchors
						element.parentNode.insertBefore(tplAnchorEnd,element.nextSibling);
						tplAnchorEnd.parentNode.insertBefore(tplAnchorStart,tplAnchorEnd);
						// Insert Nodes
						let docFragment = document.createDocumentFragment();
						for(let n of tplNodes){
							instance._elementScopeSetAlias(n,element);
							docFragment.appendChild(n);
						}
						tplAnchorEnd.parentNode.insertBefore(docFragment,tplAnchorEnd);
					}
					// Set Style Display
					for(let n of tplNodes){
						if(!n.style) continue;
						n.style.display = tplDefaultDisplay.get(n) || '';
					}
					if(onShowExec) onShowExec.runFn();
				}
			}
		}
		
	}
	
});
