
import {
	resolvedPromise, originalDefer,
} from "./utils.js";

// Defer / Queue Task Variables
/** @type {boolean} Whether defer/microtask queue is currently scheduled */
let isDeferQueued = false;
/** @type {Set<Function>} Tasks queued for defer/microtask execution */
let deferList = new Set();

// Queue Compute Variables
/** @type {boolean} Whether compute queue is currently scheduled */
let isComputeQueued = false;
/** @type {boolean} Whether the next compute queue run should defer through the microtask layer */
let deferCompute = false;
/** @type {Set<Function>} Compute functions queued for after-RAF execution */
let computeList = new Set();

// Queue Render Animation Variables
/** @type {boolean} Whether currently inside an animation frame (DOM writes only allowed here) */
let isDuringRAF = false;
/** @type {boolean} Whether a requestAnimationFrame callback has been scheduled */
let isRAFScheduled = false;
/** @type {Set<Function>} Batched RAF callbacks */
let rafList = new Set();
/** @type {Map<any,Map<any,Function>>} Once-animation callbacks keyed by obj+key */
let rafOnceList = new Map();

/**
 * Timing - batching, queuing, and animation frame utilities for DOM updates.
 * 
 * The timing class provides the scheduling infrastructure that ScopeDom uses to batch
 * DOM updates efficiently, preventing unnecessary layout thrashing and redundant work.
 * It operates on three concentric timing layers:
 * 
 * 1. Defer/Microtasks (#deferTask): Batched microtasks executed after the current turn.
 * 
 * 2. Compute Queue (queueCompute): Heavy computation queued after animation frames.
 *    Computation is processed via setTimeout (macrotask) after RAF to avoid blocking
 *    rendering, orchestrated by #handleQueue.
 * 
 * 3. Render/RAF Queue (queueRender / requestAnimation): DOM updates batched in the
 *    animation frame via the native requestAnimationFrame batching mechanism.
 * 
 * @class timing
 */
export class timing {
	
	/**
	 * Defer / Queue a microtask (batched with deduplication).
	 * 
	 * Adds the function to the defer queue and schedules execution via originalDefer.
	 * Deduplicates within the same microtask turn via isDeferQueued flag.
	 * @param {Function} fn Function or task to queue for deferred execution
	 */
	static deferTask(fn){
		deferList.add(fn);
		if(isDeferQueued) return;
		isDeferQueued = true;
		originalDefer(timing.#handleDeferredQueue);
	}
	
	/**
	 * Execute all queued defer/microtasks, then reset the queue.
	 * 
	 * Tasks added to deferList by `deferTask` are drained in order, then the list is cleared.
	 * Deduplicated via `isDeferQueued` to prevent stacking up within the same turn.
	 * 
	 * @private
	 */
	static #handleDeferredQueue(){
		isDeferQueued = false;
		if(deferList.size===0) return;
		let list = Array.from(deferList); deferList.clear();
		for(let cb of list) try{ cb(); }catch(err){ console.error(err); }
	}
	
	// - - - - - - - - - - - - - - - - - - - - - - - - - - - -
	
	/**
	 * Flag to force the next compute queue run to defer through the microtask layer
	 * instead of running via setTimeout 0 or direct.
	 * 
	 * Called by callers that need computation to batch with the defer task queue
	 * (eg, during onReady lifecycle or plugin-init sequences). Resets to false
	 * after #handleQueue completes.
	 */
	static deferNextCompute(){
		deferCompute = true;
	}
	
	/**
	 * Add a function to the compute list and schedule its execution.
	 * 
	 * Computes run after animation frames (via setTimeout 0) by default, or via
	 * the defer/microtask queue if isDeferQueued or deferCompute is true. Multiple
	 * queueCompute calls deduplicate via isComputeQueued flag - only one
	 * #handleQueue execution is scheduled regardless of how many fns are added.
	 * 
	 * @param {Function} [fn] Compute function to add to the queue
	 */
	static queueCompute(fn){
		if(fn) computeList.add(fn);
		if(isComputeQueued) return;
		isComputeQueued = true;
		if(isDeferQueued || deferCompute) originalDefer(timing.#handleQueue);
		// setTimeout (macrotask) is used as a fallback when no defer/microtask is queued; runs compute after the current turn
		else setTimeout(timing.#handleQueue,0);
	}
	
	/**
	 * Orchestrator that executes queued computations.
	 * 
	 * Schedules an animation frame (if not already), runs the compute queue once,
	 * then loops up to 3 times handling any deferred tasks that may add new compute
	 * entries. Resets isComputeQueued and deferCompute after all work is drained.
	 * 
	 * @private
	 * @returns {Promise<void>} Resolved after all compute/defer work is drained
	 */
	static async #handleQueue(){
		if(!isRAFScheduled) timing.requestAnimation();
		timing.#handleComputeQueue();
		// deferList is checked to purposefuly delay until next microtask
		for(let i=0; i<3 && (deferList.size>0 || computeList.size>0); i++) await timing.#handleComputeQueue();
		isComputeQueued = false;
		deferCompute = false;
	}
	
	/**
	 * Run queued computation functions, then reset the queue.
	 * 
	 * Functions added to computeList by `queueCompute` are drained in order.
	 * 
	 * @private
	 * @see queueCompute timing.queueCompute
	 */
	static #handleComputeQueue(){
		if(computeList.size===0) return;
		let list = Array.from(computeList); computeList.clear();
		for(let cb of list) try{ cb(); }catch(err){ console.error(err); }
	}
	
	// - - - - - - - - - - - - - - - - - - - - - - - - - - - -
	
	/**
	 * Couple a compute function with a render function - compute first, render next RAF.
	 * 
	 * Creates a state object holding both functions and a ranCompute/ranRender flag.
	 * Schedules #handleOnCompute (which runs via the compute queue). The compute step
	 * auto-schedules #handleOnRender via requestAnimation on the next RAF, which then
	 * executes the render function with the compute result as its argument.
	 * 
	 * @param {Function} [computeFn=null] Function that computes the new state
	 * @param {Function} [renderFn=null] Function that applies the computed state to the DOM
	 */
	static queueComputeThenRender(computeFn=null,renderFn=null){
		let state = {
			computeFn, renderFn, result:null,
			ranCompute:false, ranRender:false, schRender:false,
		};
		timing.queueCompute(timing.#handleOnCompute.bind(null,state));
	}
	
	/**
	 * Convenience: queue only a render function via the compute-then-render pipeline.
	 * 
	 * Delegates to queueComputeThenRender(null, fn) - the compute step is skipped,
	 * and only the render function executes on the next animation frame.
	 * 
	 * @param {Function} fn Render function to execute
	 */
	static queueRender(fn){
		timing.queueComputeThenRender(null,fn);
	}
	
	/**
	 * Compute step in the queueComputeThenRender coupling.
	 * 
	 * Auto-schedules the render function via requestAnimation if not yet scheduled.
	 * Guards against re-entry with ranCompute/ranRender flags. Executes computeFn
	 * and stores the result in state.result unless already done.
	 * 
	 * @private
	 * @param {object} state Coupled compute/render state holder
	 */
	static #handleOnCompute(state){
		if(!state.schRender && state.renderFn) state.schRender = timing.requestAnimation(timing.#handleOnRender.bind(null,state)), true;
		if(state.ranRender || state.ranCompute || !state.computeFn) return;
		state.ranCompute = true;
		try{ state.result = state.computeFn(); }catch(err){ console.error(err); }
	}
	
	/**
	 * Render step in the queueComputeThenRender coupling.
	 * 
	 * Executes renderFn with the compute result (state.result). If the render function
	 * was scheduled before the compute ran, it re-runs the compute synchronously.
	 * Guards against re-entry with ranRender flag.
	 * 
	 * @private
	 * @param {object} state Coupled compute/render state holder
	 */
	static #handleOnRender(state){
		if(state.ranRender) return;
		if(!state.ranCompute && state.computeFn) timing.#handleOnCompute(state);
		state.ranRender = true;
		try{ state.renderFn(state.result); }catch(err){ console.error(err); }
	}
	
	// - - - - - - - - - - - - - - - - - - - - - - - - - - - -
	
	/**
	 * Whether currently inside an animation frame.
	 * 
	 * DOM writes are only allowed when this is true. Gated by #scheduledRAF.
	 * 
	 * @returns {boolean} True if currently inside a RAF frame
	 */
	static get isDuringRAF(){ return isDuringRAF; };
	
	/**
	 * Whether a requestAnimationFrame has been scheduled for the current cycle.
	 * 
	 * Prevents duplicate scheduling of RAF callbacks within the same cycle.
	 * 
	 * @returns {boolean} True if RAF has been scheduled
	 */
	static get isRAFScheduled(){ return isRAFScheduled; };
	
	/**
	 * Await a promise, then run the result/error through requestAnimationFrame.
	 * 
	 * Chains the promise `.then` callback and `.catch` error handler through `timing.requestAnimation`
	 * so they batch with the RAF cycle.
	 * 
	 * @param {Promise} p Promise to wait for
	 * @param {Function} fn Function to run on fulfillment, called with the resolved value
	 * @param {Function} [fnErr=undefined] Function to run on rejection; defaults to console.error
	 * @returns {Promise<any>} The chained promise (resolves with the callback result)
	 */
	static promiseToRAF(p,fn,fnErr){
		return p.then((r)=>timing.requestAnimation(()=>fn(r)),(err)=>timing.requestAnimation(fnErr?fnErr:()=>console.error(err)));
	}
	
	/**
	 * Batched version of {@link requestAnimationFrame}
	 * 
	 * @param {Function} fn Function to run on animation frame
	 */
	static requestAnimation(fn){
		if(fn) rafList.add(fn);
		if(!isRAFScheduled) isRAFScheduled = requestAnimationFrame(timing.#scheduledRAF),true;
	}
	
	/**
	 * Schedule a single callback on {@link requestAnimationFrame}, deduplicated by object+key.
	 * 
	 * When `useLast=true` (default), only the last callback for a given obj+key combination is retained and executed -
	 * subsequent calls replace earlier callbacks for the same key. When `useLast=false`, the first callback is retained
	 * and later ones are not added.
	 * 
	 * @param {any} obj Unique object identifier (eg, HTMLElement)
	 * @param {any|string} key Unique key within the object's context (eg, event name string)
	 * @param {Function} fn Function to run once on the next animation frame
	 * @param {boolean} [useLast=true] If true, only the last callback per obj+key runs; if false, only the first
	 * @returns {boolean} True if this is a fresh (first-time) registration; false if the obj+key was already registered
	 */
	static onceAnimation(obj,key,fn,useLast=true){
		if(obj===void 0 || obj===null) obj = timing.onceAnimation;
		if(key===void 0 || key===null) key = 0;
		let list = rafOnceList.get(obj);
		if(!list) rafOnceList.set(obj,(list=new Map()));
		let hasFn = list.has(key);
		if(useLast && hasFn) list.set(key,fn);
		else if(!hasFn) list.set(key,fn);
		if(!isRAFScheduled) isRAFScheduled = requestAnimationFrame(timing.#scheduledRAF),true;
		return !hasFn;
	}
	
	/**
	 * Execute all queued RAF callbacks (batched + onceAnimation), then reset.
	 * 
	 * Runs after requestAnimationFrame fires. Drains rafList (batched) and
	 * rafOnceList (onceAnimation), then schedules #endRAF via defer.
	 * Guards `isDuringRAF` so DOM writes only happen within this callback.
	 * 
	 * @private
	 */
	static #scheduledRAF(){
		isDuringRAF = true;
		let list = Array.from(rafList); rafList.clear();
		let list2 = Array.from(rafOnceList.values()); rafOnceList.clear();
		for(let cb of list) try{ cb(); }catch(err){ console.error(err); }
		for(let s of list2) for(let [k,cb] of s) try{ cb(); }catch(err){ console.error(err); }
		isRAFScheduled = false;
		originalDefer(timing.#endRAF);
	}
	
	/**
	 * Reset `isDuringRAF` flag, ending animation frame state.
	 * 
	 * Called via deferTask after RAF execution is complete.
	 * 
	 * @private
	 */
	static #endRAF(){ isDuringRAF=false; }
	
	
}
