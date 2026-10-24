const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function prepareEnvironment(environment, cargoBin, delimiter = path.delimiter) {
  const env = { ...environment };
  // A copied env object is case-sensitive even though Windows environment keys are not.
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = `${cargoBin}${delimiter}${env[pathKey] || ''}`;
  return env;
}

module.exports = { prepareEnvironment };
if (require.main === module) {
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  const env = fs.existsSync(cargoBin) ? prepareEnvironment(process.env, cargoBin) : process.env;
  const result = spawnSync(process.execPath, [require.resolve('@tauri-apps/cli/tauri.js'), ...process.argv.slice(2)], {
    stdio: 'inherit', env, windowsHide: true,
  });
  if (result.error) process.stderr.write(`Unable to start Tauri: ${result.error.message}\n`);
  process.exit(result.status ?? 1);
}
