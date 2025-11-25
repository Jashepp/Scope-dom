"use strict";

let styleReady;
function setupCloakStyle(){
	styleReady = document.createElement('style');
	styleReady.setAttribute('type','text/css');
	styleReady.appendChild(document.createTextNode(`*[\\$cloak] { display:none !important; }`));
	document.head.prepend(styleReady);
}
function removeCloak(){
	if(styleReady){ styleReady.parentNode?.removeChild(styleReady); styleReady=null; }
}
setupCloakStyle();

export class pluginCloakSimple {
	get name(){ return 'cloak'; }
	
	constructor(scopeDom,instance){
		this.scopeDom = scopeDom;
		this.instance = instance;
		instance.onDOMReady(removeCloak);
	}
	
	onConnect(plugInfo){
		let { element } = plugInfo;
		if(styleReady && element?.hasAttribute?.('$cloak')){
			this.instance.onElementLoaded(element,function onElementLoadedPluginCloakSimple(){ if(styleReady) element.removeAttribute('$cloak'); });
		}
	}
	
}

let win = typeof window!=='undefined' && window;
if(win) win.scopeDom?.pluginAdd?.(pluginCloakSimple) || ((win.scopeDomPlugins=win.scopeDomPlugins||{}).pluginCloakSimple=pluginCloakSimple);
