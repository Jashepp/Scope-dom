"use strict";
/** @typedef {import('../scopedom.js').default} ScopeDom */

/**
 * Plugin for expression piping: adds `|` pipe syntax to expressions.
 * 
 * An expression-modifier plugin (it works only via the `onExpression` hook -
 * no `onConnect`, no `onDisconnect`, no element state). It rewrites the expression
 * string in-place, before execExpression compiles it, so DOM scanning is unchanged.
 * 
 * Enables pipe syntax in expressions (eg, `count | $format.number`):
 *   a | b                      = b(a)
 *   a | b :arg1 :arg2          = b(a, arg1, arg2)   (`:` splits arguments)
 *   a | b | c                  = c(b(a))            (left-to-right chaining)
 *   data | (v => v * 2)        = (v => v * 2)(data) (pipe into an arrow function)
 * 
 * It rewrites a piped expression into a nested method-call chain. Boundary
 * detection runs two passes: a fast pass for simple pipes (matching a single `|`
 * but not `||`), then a JS-aware full pass that ignores `|` inside string and
 * template literals, regex literals and comments.
 * 
 * @class pluginPipeExp
 */
export class pluginPipeExp {
	
	/**
	 * Plugin name identifier.
	 * @returns {string} Always `'pipe-expression'`
	 */
	get name(){ return 'pipe-expression'; }
	static get name(){ return 'pipe-expression'; }
	
	/** @type {ScopeDom} ScopeDom class */
	ScopeDom;
	/** @type {ScopeDom} ScopeDom instance */
	instance;
	
	/**
	 * @param {Object} ScopeDom The ScopeDom class
	 * @param {Object} instance The ScopeDom instance
	 */
	constructor(ScopeDom,instance){
		this.ScopeDom = ScopeDom;
		this.instance = instance;
	}
	
	/**
	 * Called when an expression is encountered.
	 * Parses pipe syntax and transforms the expression in-place.
	 * 
	 * When an expression contains the pipe `|` character:
	 * 1. Identifies pipe boundaries in the expression (fast pass for simple pipes, full pass for complex).
	 * 2. Parses each piped segment as a method call with optional arguments (using `:` as the argument separator).
	 * 3. Transforms the expression into a nested method call chain and modifies `expressionObj.expression` in-place.
	 * 
	 * For example, the expression `data | $format.number:2 | $display.bold` is transformed into:
	 * `$display.bold($format.number(data,2))`
	 * 
	 * This plugin modifies `expressionObj.expression` in-place before the expression is compiled by execExpression.
	 * 
	 * @param {Object} expInfo The expression info object (contains expressionObj.expression which is mutated)
	 */
	onExpression(expInfo){
		let { instance, element, elementScopeCtrl, expressionObj } = expInfo;
		let { expression, mainScopes, otherScopes, options } = expressionObj;
		let hasPipe = expression.includes('|');
		if(hasPipe){
			let positions = this.#getPipeBoundaries(expression);
			let finalStack = [];
			if(positions?.size>0){
				let stack = this.#getStackFromPositions(expression,positions);
				finalStack.push(stack[0])
				// Parse methods & arguments
				for(let i=1,l=stack.length; i<l; i++){
					let exp = stack[i], hasParts = exp.includes(':'), newExp = exp;
					let innerFn = exp, innerArgs = "";
					if(hasParts){
						let innerPositions = this.#jsExpressionBoundariesFullPass(exp,":");
						if(innerPositions?.size>0){
							let stack = this.#getStackFromPositions(exp,innerPositions);
							for(let j=0,k=stack.length; j<k; j++){
								let innerExp = stack[j];
								if(j===0) innerFn = innerExp;
								else if(j===1) innerArgs = innerExp;
								else innerArgs += ","+innerExp;
							}
						}
					}
					finalStack.push([innerFn,innerArgs]);
				}
				// Combine into final expression
				expressionObj.expression = this.#reduceFinalStack(finalStack);
			}
		}
	}
	
	/**
	 * Reduces a stack of method/argument pairs into a chained method call expression.
	 * 
	 * Transforms a stack like `[["data"],["$format","2"]]` into `"$format(data,2)"`.
	 * 
	 * @private
	 * @param {Array<string | [string, string]>} stack - Stack where [0] is the bare base-expression string and each (i>=1) is a [method, args] pair
	 * @returns {string} The reduced expression string
	 */
	#reduceFinalStack(stack){
		let strStart = '', strEnd = '';
		for(let i=1,l=stack.length; i<l; i++){
			let [ method, args ] = stack[i];
			strStart = `${method}(${strStart}`;
			strEnd = `${strEnd}${args?','+args:''})`;
		}
		return `${strStart}(${stack[0]})${strEnd}`;
	}
	
	/**
	 * Builds a stack of expression segments from pipe boundary positions.
	 * 
	 * @private
	 * @param {string} exp The expression string
	 * @param {Set<number>} positions Set of pipe character positions
	 * @returns {string[]} Array of expression segments
	 */
	#getStackFromPositions(exp,positions){
		let stack = [], lastPos = 0;
		for(let pos of positions.values()){
			let str = exp.substring(lastPos,pos).trim();
			if(str.length>0) stack.push(str);
			lastPos = pos+1;
		}
		stack.push(exp.substring(lastPos).trim());
		return stack;
	}
	
	/**
	 * Determines pipe boundaries in an expression.
	 * 
	 * Uses pipeBoundariesFastPass for simple expressions, jsExpressionBoundariesFullPass for complex ones.
	 * 
	 * @private
	 * @param {string} expr The expression string
	 * @returns {Set<number>} Set of pipe boundary positions
	 */
	#getPipeBoundaries(expr){
		let hasForwardSlash = expr.includes('/');
		let hasSingleQuote = expr.includes('"');
		let hasDoubleQuote = expr.includes("'");
		let hasTplLiteral = expr.includes('`');
		// Fast Pass
		if (!hasForwardSlash && !hasSingleQuote && !hasDoubleQuote && !hasTplLiteral) return this.#pipeBoundariesFastPass(expr);
		// Full Pass
		return this.#jsExpressionBoundariesFullPass(expr,"|");
	}
	
	/**
	 * Fast simple pass for pipe boundary detection.
	 * 
	 * Used for simple expressions without strings, quotes, or template literals.
	 * 
	 * @private
	 * @param {string} expr The expression string
	 * @returns {Set<number>} Set of pipe boundary positions
	 */
	#pipeBoundariesFastPass(expr){
		let positions = new Set();
		for(let i=0,l=expr.length; i<l; i++) if(expr[i]==="|" && expr[i-1]!=="|" && expr[i+1]!=="|") positions.add(i);
		return positions;
	}
	
	/**
	 * Full-pass JS-aware parser for boundary character detection.
	 * 
	 * Properly handles:
	 * - String literals (single and double quotes)
	 * - Template literals with nested expressions
	 * - Regular expressions
	 * - Single-line and multi-line comments
	 * - Escaped characters
	 * 
	 * For example: "`text ${`more ${`etc`} text`}` | $display.bold"
	 * 
	 * @private
	 * @param {string} expr The expression string
	 * @param {string} [specialChar='|'] The special character to detect
	 * @returns {Set<number>} Set of special character positions outside string/regex/comment regions
	 */
	#jsExpressionBoundariesFullPass(expr,specialChar="|"){
		let positions = new Set();
		let type = 0; // 1=string, 2=tplLiteral, 4=regex, 5=commentDS, 6=commentML
		let stringChar=null, stack=[], stateTpl={ closureCount:0, bracketCount:0 };
		stack.push({ ...stateTpl });
		for(let i=0,l=expr.length; i<l; i++){
			let char=expr[i], prev=expr[i-1], next=expr[i+1], state=stack[stack.length-1];
			// Template Literal Expression End
			if(stack.length>1 && type===0 && state.closureCount===0 && state.bracketCount===0 && char=="}" && prev!=="\\"){
				type = 2;
				stack.pop();
				continue;
			}
			// Type Switch
			switch(type){
				case 1: // String End - close string when matching quote found (skip escaped)
					if(char==stringChar && prev!=="\\") type = 0;
				break;
				case 2:
					// Template Literal Expression Handle - ${ enters an expression context (nested scope)
					if(char=="$" && next==="{" && prev!=="\\"){
						i++;
						type = 0;
						stack.push({ ...stateTpl }); // Push nested state to track ${...} nesting
					}
					// Template Literal End - closing ` exits template mode back to default
					else if(char=="`" && prev!=="\\") type = 0;
				break;
				case 4: // Regex End - closing / exits regex mode (skip escaped)
					if(char==="/" && prev!=="\\") type = 0;
				break;
				case 5: // Comment Double Slash - exits when newline found
					if(char==="\n") type = 0;
				break;
				case 6: // Comment Multi Line - exits when */ sequence found
					if(char==="/" && prev==="*") type = 0;
				break;
				default: // Character Switch - detect what kind of JS syntax the char starts
					switch(char){
						case '"': case "'": // String Start - begin string tracking with this char as quote
							if(prev!=="\\"){
								type = 1;
								stringChar = char;
							}
						break;
						case "`": // Template Literal Start
							if(prev!=="\\") type = 2;
						break;
						case "/": // Regex Start - only if not preceded by / (not line comment) and isRegexPos confirms regex context
							if(prev!=="/" && next!=="/" && next!=="*" && this.#isRegexPos(expr,i)) type = 4;
						break;
						case "/":
							// Comment Double Slash
							if(next==="/") type = 5;
							// Comment Multi Line
							else if(next==="*") type = 6;
						break;
						case "{": // Closure Start
							if(prev!=="\\") state.closureCount++;
						break;
						case "}": // Closure End
							if(prev!=="\\") state.closureCount--;
						break;
						case "(": // Bracket Start
							if(prev!=="\\") state.bracketCount++;
						break;
						case ")": // Bracket End
							if(prev!=="\\") state.bracketCount--;
						break;
						case specialChar: // Special Character
							if(state.closureCount===0 && state.bracketCount===0 && stack.length===1){
								if(specialChar==="|" && prev!=="|" && next!=="|") positions.add(i);
								else if(specialChar!=="|") positions.add(i);
							}
						default:
						break;
					}
				break;
			}
		}
		if(type===1) throw new SyntaxError("SyntaxError: Unfinished String");
		if(type===2) throw new SyntaxError("SyntaxError: Unfinished Template Literal");
		if(stack.length>1) throw new SyntaxError("SyntaxError: Unfinished Template Literal Expression");
		if(stack[0]?.closureCount>0) throw new SyntaxError("SyntaxError: Unfinished Closure");
		if(stack[0]?.bracketCount>0) throw new SyntaxError("SyntaxError: Unfinished Brackets");
		return positions;
	}
	
	/**
	 * Distinguishes between '/' as regex delimiter and '/' as division operator.
	 * 
	 * Checks context before and after the '/' to determine if it's regex:
	 * - Before: Must be preceded by regex-friendly characters (operators, punctuation)
	 * - After: Must match regex closing pattern (eg, `/pattern/g` or /pattern/.test(str))
	 * 
	 * @private
	 * @param {string} expr The full expression string
	 * @param {number} index The index of the '/' character to check
	 * @returns {boolean} True if the '/' is part of a regex literal
	 */
	#isRegexPos(expr,index){
		let str = expr.substring(0,index+1);
		let before = index===0 || /([\,\.\[\(\{\}\;\:\-\+\=\&\|\?]|\*\/|\/\/.*?\n|^)\s*?\/$/.test(str);
		if(!before) return false;
		let str2 = expr.substring(index);
		let after = /^\/[^\n]*?[^\\]\/[a-z]?\s*?[\,\.\;\)\]\[\}]/.test(str2);
		return after;
	}
	
}

/** Auto-register: prefer ScopeDom.pluginAdd, else fallback to the ScopeDomPlugins discovery object. */
let win = typeof window!=='undefined' && window;
if(win) win.ScopeDom?.pluginAdd?.(pluginPipeExp) || ((win.ScopeDomPlugins=win.ScopeDomPlugins||{}).pluginPipeExp=pluginPipeExp);
