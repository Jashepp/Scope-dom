
let isWatch = process.env.ROLLUP_WATCH==='true' || process.env.npm_lifecycle_event?.indexOf('watch')!==-1;

let defaults = {
	treeshake: false,
	cache: true,
	input: {},
	output: {
		sourcemap: true,
		format: "iife",
	},
	watch: !!isWatch,
};
let pluginUMD = { format:"umd", name:"scopeDomPlugins", extend:true, exports:"named" };
let pluginESM = { format:"es" };

let config = [
	// Core UMD
	{ input:"./src/scopedom.js", output:{ file:"./dist/scopedom.umd.js", format:"umd", name:"scopeDom", extend:true, exports:"default" } },
	// Core Module
	{ input:"./src/scopedom.js", output:{ file:"./dist/scopedom.js", format:"es" } },
	// Plugin cloak
	{ input:"./src/plugins/cloak.js", output:{ file:"./dist/plugins/cloak.umd.js", ...pluginUMD } },
	{ input:"./src/plugins/cloak.js", output:{ file:"./dist/plugins/cloak.js", ...pluginESM } },
	// Plugin parse
	{ input:"./src/plugins/parse.js", output:{ file:"./dist/plugins/parse.umd.js", ...pluginUMD } },
	{ input:"./src/plugins/parse.js", output:{ file:"./dist/plugins/parse.js", ...pluginESM } },
	// Plugin if
	{ input:"./src/plugins/if.js", output:{ file:"./dist/plugins/if.umd.js", ...pluginUMD } },
	{ input:"./src/plugins/if.js", output:{ file:"./dist/plugins/if.js", ...pluginESM } },
	// Plugin repeat
	{ input:"./src/plugins/repeat.js", output:{ file:"./dist/plugins/repeat.umd.js", ...pluginUMD } },
	{ input:"./src/plugins/repeat.js", output:{ file:"./dist/plugins/repeat.js", ...pluginESM } },
];

for(let fileConfig of config){
	Object.assign({},defaults,fileConfig);
	if(fileConfig.output) fileConfig.output = Object.assign({},defaults.output,fileConfig.output);
}

export default config;
