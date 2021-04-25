import { Command ,flags as oFlags } from '@oclif/command'
import path from 'path'

import { relativePath ,relPathJson ,tsCompilerConfig ,tsConfigDeclarationDir ,tsConfigFilePath } from '../utils'
import { preprocessSvelte } from '../file-manager'

class Svelte2Dts extends Command {
  static description = 'Generate d.ts files from svelte files'

  static usage = '[OPTIONS...] SOURCE_DIR_1 [SOURCE_DIR_2...]'

  static examples = [
    '$ svelte2dts --overwrite --runOnTs --declarationDir ./types ./src'
    ,'$ svelte2dts --dryRun ./src'
  ]

  static flags: oFlags.Input<any> = {
    // add --version flag to show CLI version
    version: oFlags.version({ 'char': 'v' })
    ,help: oFlags.help({ 'char': 'h' })

    ,overwrite: oFlags.boolean({
      'default': false
      ,'allowNo': true
      ,'description': 'Overwrite existing files'
    })
    ,dryRun: oFlags.boolean({
      'default': false
      ,'char': 'n'
      ,'description': 'Dry Run'
    })
    ,strict: oFlags.boolean({
      'description': `Generate strict types. ${
        tsCompilerConfig.strict === undefined
          ? 'You could also set compilerOptions.strict in your tsconfig.json'
          : 'Default uses compilerOptions.strict from your tsconfig.json'
      }`
      ,'allowNo': true
      ,parse(input) {
        tsCompilerConfig.strict = input
        return input
      }
      ,'default': tsCompilerConfig.strict ?? false
    })
    ,extensions: oFlags.string({
      'default': ['.svelte']
      ,'multiple': true
      ,'hidden': true
      ,'description': 'List of valid svelte file extension for pure svelte files'
    })
    ,declarationDir: oFlags.string({
      'description': `Where we should write the d.ts files. ${
        tsCompilerConfig.declarationDir === undefined
          ? 'You could also set compilerOptions.declarationDir in your tsconfig.json'
          : 'Default uses compilerOptions.declarationDir from your tsconfig.json'
      }`
      ,'default': tsConfigDeclarationDir as string
      ,parse(input) {
        const resolved = path.resolve(input)
        tsCompilerConfig.declarationDir = resolved
        return resolved
      }
      ,'required': tsConfigDeclarationDir === undefined
    })
    ,runOnTs: oFlags.boolean({
      'default': false
      ,'allowNo': true
      ,'description': 'Create d.ts files for all ts files. If false, we will only generate d.ts files for svelte files'
    })
  }

  static strict = false

  static args = []

  dryRun = false

  // eslint-disable-next-line @typescript-eslint/require-await
  async run() {
    const { flags ,argv } = this.parse(Svelte2Dts)
    const { dryRun ,overwrite ,runOnTs } = flags
    const srcDirs = argv
    const { declarationDir } = flags

    if (dryRun) {
      this.log('Dry run enabled, will not change anything!')
      this.dryRun = dryRun
    }

    if (tsConfigFilePath !== undefined) {
      this.log(`Using tsconfig ${relPathJson(tsConfigFilePath)}`)
    }
    this.log(`Generating declarations for svelte files ${
      JSON.stringify(srcDirs.map(relativePath))
    } -> ${
      relPathJson(declarationDir)
    }.${dryRun ? ' (dry run)' : ''}`)

    tsCompilerConfig.emitDeclarationOnly = true

    preprocessSvelte({
      includeGlobs: srcDirs
      ,runOnTs
      ,svelteExtensions: flags.extensions
      ,dryRun
      ,overwrite
      ,autoGenerate: true
      ,runOnJs: tsCompilerConfig.allowJs ?? false
      ,compilerOptions: tsCompilerConfig
    })
  }
}

export = Svelte2Dts
