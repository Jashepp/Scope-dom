
/**
 * Scope system re-exports for controller and element controllers.
 * 
 * This file provides a flat, convenient export set for the entire scope subsystem.
 * Rather than importing from individual files (core.js, element.js, expression.js),
 * consumers of this module get all scope-related classes in a single import.
 * 
 * @see scopeInstance - Wrapper/mixin class for scope instances
 * @see scopeBase - Base class for scope objects
 * @see scopeControllerContext - The execution context for scope controllers
 * @see scopeController - The main scope controller (root node of the scope hierarchy)
 * @see scopeElementContext - The execution context for element controllers
 * @see scopeElementController - The element controller (leaf node of the scope hierarchy)
 * @see scopeExpression - Expression execution and building helper
 */

import { scopeInstance, scopeBase, scopeControllerContext, scopeController } from "./scope/core.js";
import { scopeElementContext, scopeElementController } from "./scope/element.js";
import { scopeExpression } from "./scope/expression.js";

export {
	scopeInstance, scopeBase, scopeControllerContext, scopeController,
	scopeElementContext, scopeElementController,
	scopeExpression,
};
