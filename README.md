# ScopeDom

**ScopeDom is a Reactive DOM Orchestrator.**

No Virtual DOM. No build step. Standard HTML attributes (`$on-click`, `$if`, `$repeat`) and text interpolation (`{{expression}}`) become reactive through native Web APIs — Proxies, WeakMaps, and MutationObservers. It works the moment the script tag loads.

---
### ⚡ The Core Philosophy

- **The DOM is the Source of Truth** — No Virtual DOM layer. Your HTML is your application state.
- **No Build Step** — Plain JavaScript and HTML. No compiler. No transpiler. No bundler configuration.
- **Declarative Reactivity** — Expressions on real HTML elements and text. `$on-click`, `$if`, `$repeat`, `{{value}}`.
- **Hierarchical Scopes** — `$scope` declares variable boundaries that walk up the DOM tree. Child elements inherit from their ancestors.
- **Immediate Observation** — Uses MutationObserver to scan and connect elements as they're added to the DOM. No DOMContentLoaded wait.

_Pronounced similarly to "Kingdom"_

---
### ✨ Key Features

- **Deep Reactivity** — Objects, arrays, Maps, and Sets become reactive automatically. Infinite proxy depth with WeakRef cleanup prevents memory leaks.
- **Hierarchical Scoping** — Scope variables and methods cascade down the DOM tree. Both the `$scope` attribute and plugins create scoped contexts that child elements inherit from.
- **Zero Build** — Plain HTML + JS. No compiler, no transpiler. Works from a single `<script>` tag.
- **Plugin System** — Auto-registering hooks, custom attributes (`$cloak`, `$if`, `$repeat`, `$parse`), and reusable `<template>` fragments with identity-based DOM reconciliation.

---
### 🚀 Quick Start

```html
<!-- The data-scopedom-init attribute auto-activates the engine -->
<script src="scopedom.umd.js" data-scopedom-init></script>
<!-- Optional: Enable {{expression}} syntax via the parse plugin -->
<script src="parse.umd.js"></script>

<!-- The $scope attribute defines encapsulated scope variables -->
<div $scope="{ count: 0 }">
	<!-- Use $parse:text to enable interpolation within text nodes -->
	<p $parse:text>Count is: {{count}}</p>
	<!-- Increment count on click event -->
	<button $on-click="count++">Increment</button>
</div>
```

WIP

---
### 📋 Documentation & Guides
*Find everything you need to master ScopeDom:*

WIP

---
### 🛠 Project Status

| Feature | Status |
| :--- | :--- |
| **Core Engine** | 🧪 Experimental / PoC |
| **Core Plugins** | 🧪 Experimental |
| **Commercial Use** | ❌ Not Ready |
| **Hobbyist Use** | 🧪 Experimental |
| **Unit Tests** | 🚧 In Progress |

*ScopeDom is currently in an experimental / proof-of-concept stage. It is intended for research and hobbyist use and is not yet ready for production environments.*

---
### 📦 Functionality & Plugins

#### Signal Reactivity

- `signalProxyAll=true` (default) — auto-reactive objects, arrays, Maps and Sets.
- Infinite proxy depth — nested values get their own `signalProxy` with WeakRef cleanup.
- Method wrappers (`push` / `pop` / `splice`) trigger updates on mutation.
- Disable auto-proxification: `ScopeDom.init({ signalProxyAll: false })`.

- **Auto-reactive push:** `cart.push({ name:'Milk', qty:2 });` — reactivity fires automatically, no `$update()` call needed. Every `Array.prototype` mutator is wrapped to auto-trigger `changed()`. Push, pop, splice become reactive triggers for free.
- **Deep nesting:** `settings.user.pref.theme = 'light';` — one `proxySignal()` wraps the entire tree, no declarations per level. Every nested access creates its own signal on demand, so deeply nested objects get full reactivity with a single wrapping call.

#### Expression Helpers & Scoping

- `$this` (element), `$parent`, `$previous`, `$next` — DOM navigation.
- `$("#nav")` (document) / `$$(".title")` (element) — query selectors.
- `$scope` / `$scopeParent` / `$scopeTop` — scope chain access.
- `$on` / `$off` / `$emit` — event dispatch on scope or element.

- **Scope inheritance:** `<div $scope="{ user:{ name:'Alice Johnson' } }"><span $scope="{ firstName:user.name.split(' ')[0] }">{{firstName}}</span></div>`. Child scope inherits `user` from parent via the scope chain, then computes local `firstName`. Scope-walk-up means parent data flows down automatically — child locals stay isolated, no prop-drilling or `$scopeParent` qualification needed.

#### Performance

- `:raf` expression option batches DOM writes to 60fps.
- Compiled expressions cached per source element via WeakMap.
- DOM caches use WeakMap / WeakSet — no leaks in long-running apps.

- **`:raf` keystroke debounce:** `<input $on-input:raf="filter($this.value)" placeholder="Type to search...">` — rapid keystrokes collapse into one 60fps update, no layout thrashing. `:raf` defers events into a single requestAnimationFrame on every update.

#### Plugins

- `$cloak` — CSS cloak with anchor comment swapping.
- `$if` — Conditional rendering with match-case and sibling chains.
- `$parse` — Text interpolation (`{{expression}}`) and attribute binding.
- `$repeat` — Data-driven element repetition with identity-based DOM reconciliation.
- `pipeExp` — Pipes (`item | $name(value)`) transpiled to function calls.
- Register via `window.ScopeDomPlugins` or `ScopeDom.pluginAdd(instance, PluginClass)`.

- **`$cloak` app loading:** `<div $cloak:dom="plugins('parse','if','repeat')">App content</div>`. Eliminates FOUC — CSS hides the element until plugins boot, then swaps it in with anchor comments, so users never see raw or unstyled DOM.
- **`$repeat` template:** `<template $repeat="items" $repeat:item="row"><div>{{row.name}}</div></template>`. List rendering with identity-based DOM caching — ScopeDom uses `moveBefore` to reorder, reuses cached nodes, and only re-outputs removed/added items to keep scroll and focus intact.
- **`pipeExp` inline:** `{{ item.price | $fmt.currency }}` or `{{ dateDue | $utils.formatDate }}`. Developer-defined scope variables (`$fmt`, `$utils`, etc.) are callable via pipe syntax — bring your own helpers (underscore, moment, custom utilities) and use them in templates without manual function calls. ScopeDom doesn't provide built-in transform functions; the pipe is just syntactic bridge for whatever helpers you define in scope.

---
### 🤝 Contribution

To submit a contribution, please create an issue or a pull request on the [GitHub repository][github-url].

**Note:** Please ensure you run all existing tests after making any changes. All help, from code to documentation improvements, is greatly appreciated!

---
### ⚖️ License

Copyright (c) 2026 Jason Sheppard [@Jashepp](https://github.com/Jashepp).

*All rights reserved. Licensing will transition to an open-source model once the project reaches a stable milestone.*

---
### 🔗 Links

**Github Repository**: [https://github.com/Jashepp/ScopeDom][github-url]

[github-url]: https://github.com/Jashepp/ScopeDom
[github-releases]: https://github.com/Jashepp/ScopeDom/releases
[github-tags]: https://github.com/Jashepp/ScopeDom/tags
