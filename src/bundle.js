
/**
 * Bundle entry point - provides the complete ScopeDom package with 5 core plugins.
 *
 * This file re-exports the core ScopeDom class and registers 5 core plugins:
 * - pluginCloak: Visually hides elements until processed by ScopeDom
 * - pluginIf: Conditional element rendering based on expression state
 * - pluginParse: Parses and renders template content into the DOM
 * - pluginRepeat: Renders repeated DOM elements from array/map data
 * - pluginPipeExp: Expression piping for composing transformations
 */

import ScopeDom from "./scopedom.js";

import { pluginCloak } from "./plugins/cloak.js";
import { pluginIf } from "./plugins/if.js";
import { pluginParse } from "./plugins/parse.js";
import { pluginRepeat } from "./plugins/repeat.js";
import { pluginPipeExp } from "./plugins/pipe-expression.js";

/**
 * Attach the core plugins as static members on the ScopeDom class (e.g. ScopeDom.pluginCloak).
 *
 * Actual runtime registration (hook wiring) is per-plugin, via each plugin's `pluginAdd` call.
 */
Object.assign(ScopeDom,{
	pluginCloak,
	pluginIf,
	pluginParse,
	pluginRepeat,
	pluginPipeExp,
});

export default ScopeDom;
