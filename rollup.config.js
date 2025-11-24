
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

let config = [
	// Core UMD
	{ input:"./src/scopedom.js", output:{ file:"./dist/scopedom.umd.js", format:"umd", name:"scopeDom" } },
	// Core Module
	{ input:"./src/scopedom.js", output:{ file:"./dist/scopedom.esm.js", format:"es" } },
	// Plugins
	{ input:"./src/plugins/attrib-cloak.js", output:{ file:"./dist/plugins/attrib-cloak.js" } },
	{ input:"./src/plugins/attrib-if.js", output:{ file:"./dist/plugins/attrib-if.js" } },
	{ input:"./src/plugins/attrib-parse.js", output:{ file:"./dist/plugins/attrib-parse.js" } },
	{ input:"./src/plugins/attrib-repeat.js", output:{ file:"./dist/plugins/attrib-repeat.js" } },
];

for(let fileConfig of config){
	Object.assign({},defaults,fileConfig);
	if(fileConfig.output) fileConfig.output = Object.assign({},defaults.output,fileConfig.output);
}

export default config;
