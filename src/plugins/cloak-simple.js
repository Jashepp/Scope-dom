"use strict";
/** @typedef {import('../scopedom.js').default} ScopeDom */

/**
 * Module-level style element holding the cloak CSS rule.
 * 
 * Created once at module load via setupCloakStyle; removed on DOM complete via a
 * registered onDOMReady callback during removeCloak.
 * 
 * @type {HTMLStyleElement|null}
 */
let styleReady;

/**
 * Inject the $cloak CSS rule into the document head.
 * 
 * Creates a <style> element with the rule `*[$cloak] { display:none !important; }`
 * and prepends it to document.head. Runs once at module import time.
 */
function setupCloakStyle(){
	styleReady = document.createElement('style');
	styleReady.setAttribute('type','text/css');
	styleReady.appendChild(document.createTextNode(`*[\\$cloak] { display:none !important; }`));
	document.head.prepend(styleReady);
}

/**
 * Remove the cloak CSS style element from the document.
 * 
 * Called once on DOM complete via the onDOMReady callback from constructor.
 * Cleans up the injected <style> element to free the document head.
 */
function removeCloak(){
	if(styleReady){ styleReady.parentNode?.removeChild(styleReady); styleReady=null; }
}
setupCloakStyle();

/**
 * Minimal $cloak plugin - hides elements until DOM is ready, then reveals them.
 * 
 * This is the lightweight counterpart to pluginCloak. It only supports the default
 * `$cloak` attribute (no options, no events, no DOM swap). On connect, elements with
 * $cloak attribute get an onElementLoaded callback that removes the attribute. On
 * DOM complete, the injected CSS rule is removed from the document head entirely.
 * 
 * @class pluginCloakSimple
 */
export class pluginCloakSimple {
	
	/** @returns {string} The name of the plugin. */
	get name(){ return 'cloak'; }
	
	/**
	 * Plugin constructor.
	 * 
	 * Stores the ScopeDom reference and instance, then registers the removeCloak
	 * function as a DOM-complete callback so the injected CSS rule is cleaned up.
	 * 
	 * @param {ScopeDom} ScopeDom The ScopeDom class reference
	 * @param {ScopeDom} instance The active ScopeDom instance
	 */
	constructor(ScopeDom,instance){
		this.ScopeDom = ScopeDom;
		this.instance = instance;
		instance.onDOMReady(removeCloak);
	}
	
	/**
	 * onConnect hook - handle elements with $cloak attribute.
	 * 
	 * If the element has the $cloak attribute and the style element exists, registers
	 * an onElementLoaded callback that removes the $cloak attribute once the element
	 * is connected to the live DOM tree. This reveals the element by removing the
	 * CSS-hidden attribute marker.
	 * 
	 * @param {object} plugInfo Plugin info object with element property
	 */
	onConnect(plugInfo){
		let { element } = plugInfo;
		if(styleReady && element?.hasAttribute?.('$cloak')){
			this.instance.onElementLoaded(element,function onElementLoadedPluginCloakSimple(){ if(styleReady) element.removeAttribute('$cloak'); });
		}
	}
	
}

/** Auto-register: prefer ScopeDom.pluginAdd, else fallback to the ScopeDomPlugins discovery object. */
let win = typeof window!=='undefined' && window;
if(win) win.ScopeDom?.pluginAdd?.(pluginCloakSimple) || ((win.ScopeDomPlugins=win.ScopeDomPlugins||{}).pluginCloakSimple=pluginCloakSimple);
