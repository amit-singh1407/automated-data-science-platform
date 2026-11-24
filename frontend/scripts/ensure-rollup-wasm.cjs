const fs = require('node:fs');
const path = require('node:path');

const nativeLoaderPath = require.resolve('rollup/dist/native.js');
const source = fs.readFileSync(nativeLoaderPath, 'utf8');
const nativeModuleDeclaration =
	'const nativeModule = requireWithFriendlyError(\n' +
	'\texistsSync(path.join(__dirname, localName)) ? localName : `@rollup/rollup-${packageBase}`\n' +
	');';
const fallbackDeclaration =
	'let nativeModule;\n' +
	'try {\n' +
		`${nativeModuleDeclaration.replace('const nativeModule', 'nativeModule')}\n` +
		'} catch (error) {\n' +
		"\tif (process.platform === 'win32' && error?.code === 'ERR_DLOPEN_FAILED') {\n" +
		"\t\tnativeModule = require('@rollup/wasm-node/dist/native.js');\n" +
		'\t} else {\n' +
		'\t\tthrow error;\n' +
		'\t}\n' +
		'}';

if (source.includes("nativeModule = require('@rollup/wasm-node/dist/native.js')")) {
	process.exit(0);
}

if (!source.includes(nativeModuleDeclaration)) {
	throw new Error(`Could not find the expected Rollup native loader in ${nativeLoaderPath}`);
}

fs.writeFileSync(nativeLoaderPath, source.replace(nativeModuleDeclaration, fallbackDeclaration));
console.log('Configured Rollup to fall back to WASM when its native addon is blocked.');
