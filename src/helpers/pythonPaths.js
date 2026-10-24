const path = require("path");

// 嵌入式Python在各平台的目录结构不同：
// macOS/Linux: python/bin/python3.11, python/lib/python3.11/site-packages
// Windows:     python/python.exe,     python/Lib/site-packages
const isWindows = process.platform === "win32";

function getExecutable(pythonHome) {
  return isWindows
    ? path.join(pythonHome, "python.exe")
    : path.join(pythonHome, "bin", "python3.11");
}

function getSitePackages(pythonHome) {
  return isWindows
    ? path.join(pythonHome, "Lib", "site-packages")
    : path.join(pythonHome, "lib", "python3.11", "site-packages");
}

function getLibDir(pythonHome) {
  return isWindows ? path.join(pythonHome, "DLLs") : path.join(pythonHome, "lib");
}

module.exports = { isWindows, getExecutable, getSitePackages, getLibDir };
