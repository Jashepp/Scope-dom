"use strict";

(function addPluginCloak(pluginFn){
	window?.scopeDom?.pluginAdd?.(pluginFn()) || (window.scopeDomPlugins||(window.scopeDomPlugins=[]))?.push(pluginFn());
})(function initPluginCloak(){
	
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
	
	return class pluginCloak {
		get name(){ return 'cloak'; }
		
		constructor(scopeDom,instance){
			this.scopeDom = scopeDom;
			this.instance = instance;
			instance.onDOMReady(removeCloak);
		}
		
		onConnect(plugInfo){
			let { element } = plugInfo;
			if(styleReady && element?.hasAttribute?.('$cloak')){
				this.instance.onElementLoaded(element,function onElementLoadedPluginCloak(){ if(styleReady) element.removeAttribute('$cloak'); });
			}
		}
		
	}
	
});
