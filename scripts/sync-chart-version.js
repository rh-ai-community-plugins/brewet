const { version } = require('../package.json');
const fs = require('fs');

/**
 * Verifies that a replace() operation actually changed the string.
 * Exits with an error if the string is unchanged, preventing silent version desync.
 * @param {string} before - String before replace()
 * @param {string} after - String after replace()
 * @param {string} description - Human-readable description for the error message
 */
function verifyReplace(before, after, description) {
  if (before === after) {
    console.error(`ERROR: Failed to update ${description} — pattern did not match`);
    process.exit(1);
  }
}

const chartPath = 'chart/Chart.yaml';
let chart = fs.readFileSync(chartPath, 'utf8');

let before = chart;
chart = chart.replace(/^version:.*/m, `version: ${version}`);
verifyReplace(before, chart, `version in ${chartPath}`);

before = chart;
chart = chart.replace(/^appVersion:.*/m, `appVersion: "${version}"`);
verifyReplace(before, chart, `appVersion in ${chartPath}`);

fs.writeFileSync(chartPath, chart);

const bffPkgPath = 'bff/package.json';
const bffPkg = JSON.parse(fs.readFileSync(bffPkgPath, 'utf8'));
bffPkg.version = version;
fs.writeFileSync(bffPkgPath, JSON.stringify(bffPkg, null, 2) + '\n');

const sbPkgPath = 'storage-backend/package.json';
const sbPkg = JSON.parse(fs.readFileSync(sbPkgPath, 'utf8'));
sbPkg.version = version;
fs.writeFileSync(sbPkgPath, JSON.stringify(sbPkg, null, 2) + '\n');

const k8sResPath = 'src/app/utils/k8sResources.ts';
let k8sRes = fs.readFileSync(k8sResPath, 'utf8');

before = k8sRes;
k8sRes = k8sRes.replace(/(brewet-storage-backend:)[^']+/, `$1${version}`);
verifyReplace(before, k8sRes, `storage-backend image tag in ${k8sResPath}`);

fs.writeFileSync(k8sResPath, k8sRes);

const envDevPath = '.env.development';
let envDev = fs.readFileSync(envDevPath, 'utf8');

before = envDev;
envDev = envDev.replace(
  /(STORAGE_BACKEND_IMAGE=quay\.io\/rh-ai-community-plugins\/brewet-storage-backend:)\S+/,
  `$1${version}`,
);
verifyReplace(before, envDev, `STORAGE_BACKEND_IMAGE tag in ${envDevPath}`);

fs.writeFileSync(envDevPath, envDev);

const valuesPath = 'chart/values.yaml';
let values = fs.readFileSync(valuesPath, 'utf8');

before = values;
values = values.replace(
  /(^image:\s*\n(?:\s*#[^\n]*\n)*\s+repository:[^\n]*\n(?:\s*#[^\n]*\n)*\s+tag:)\s*"[^"]*"/m,
  `$1 "${version}"`,
);
verifyReplace(before, values, `image.tag in ${valuesPath}`);

before = values;
values = values.replace(
  /(^bff:[\s\S]*?  image:\n(?:\s*#[^\n]*\n)*    repository:[^\n]*\n(?:\s*#[^\n]*\n)*    tag:)\s*"[^"]*"/m,
  `$1 "${version}"`,
);
verifyReplace(before, values, `bff.image.tag in ${valuesPath}`);

before = values;
values = values.replace(
  /(^storageBackend:[\s\S]*?  image:\n(?:\s*#[^\n]*\n)*    repository:[^\n]*\n(?:\s*#[^\n]*\n)*    tag:)\s*"[^"]*"/m,
  `$1 "${version}"`,
);
verifyReplace(before, values, `storageBackend.image.tag in ${valuesPath}`);

fs.writeFileSync(valuesPath, values);

const pluginPath = 'plugin.yaml';
let plugin = fs.readFileSync(pluginPath, 'utf8');

before = plugin;
plugin = plugin.replace(/^version:.*/m, `version: ${version}`);
verifyReplace(before, plugin, `version in ${pluginPath}`);

// Use the 'gm' flags to update all tag fields (image.tag and bff_image.tag)
before = plugin;
plugin = plugin.replace(/^(\s+tag:)\s.*$/gm, `$1 "${version}"`);
verifyReplace(before, plugin, `tag fields in ${pluginPath}`);

fs.writeFileSync(pluginPath, plugin);

const versionFlag = /--version \S+/g;
for (const docPath of ['README.md', 'docs/development/BUILD_AND_PUSH.md', 'docs/deployment/OPENSHIFT_DEPLOY.md']) {
  const content = fs.readFileSync(docPath, 'utf8');
  const updated = content.replace(versionFlag, `--version ${version}`);
  if (updated !== content) {
    fs.writeFileSync(docPath, updated);
  }
}
