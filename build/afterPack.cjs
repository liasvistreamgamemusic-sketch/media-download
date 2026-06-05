// electron-builder afterPack フック。
// macOS arm64 は有効な署名が無いとアプリが起動しない（kernel が拒否）。
// 有償証明書が無いため ad-hoc 署名（codesign -s -）を施す。これにより
// 利用者は quarantine 解除（右クリック→開く / xattr -dr）のみで起動できる。
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = context.packager.appInfo.productFilename
  const appPath = join(context.appOutDir, `${appName}.app`)
  console.log(`  • ad-hoc signing  ${appPath}`)
  execFileSync('codesign', ['--deep', '--force', '--sign', '-', appPath], { stdio: 'inherit' })
}
